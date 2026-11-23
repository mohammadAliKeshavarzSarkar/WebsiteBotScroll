import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createPrismaClient } from "../client.js";
import { DefinitionRepository } from "./definitions.js";
import { DiagnosticRepository } from "./diagnostics.js";
import { ObservationRepository } from "./observation-records.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

describeDatabase("DiagnosticRepository", () => {
  const prisma = createPrismaClient(databaseUrl!);
  const definitions = new DefinitionRepository(prisma, { canPublish: true });
  const observations = new ObservationRepository(prisma);
  const diagnostics = new DiagnosticRepository(prisma, { canPublish: true });
  let organizationId: string; let runId: string; let siteId: string;

  const rule = (supportsUnavailableInputs = false) => ({
    key: "seo.title.consistency", version: "1.0.0", policyVersion: "2026-11",
    configurationSchema: { type: "object", additionalProperties: false },
    acceptedInputs: [{ observationKey: "page.metadata", observationVersion: "1.0.0", scopes: ["page", "cross_page"] as const, required: true }],
    outcomes: ["pass", "fail", "unknown"], supportsUnavailableInputs,
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "diagnostic_result_inputs", "diagnostic_results", "diagnostic_executions", "diagnostic_rule_inputs", "diagnostic_rule_definitions", "renderer_sessions", "platform_observations", "observation_executions", "observation_subject_members", "observation_subjects", "collector_capabilities", "collector_definitions", "observation_definitions", "crawl_runs", "sites", "organizations" CASCADE');
    organizationId = randomUUID(); runId = randomUUID(); siteId = randomUUID();
    await prisma.organization.create({ data: { id: organizationId, name: "Owner" } });
    await prisma.site.create({ data: { id: siteId, organizationId, name: "Site", origin: "https://example.test" } });
    await prisma.crawlRun.create({ data: { id: runId, organizationId, siteId, trigger: "MANUAL", idempotencyKey: randomUUID(), status: "RUNNING", scope: {}, limits: {} } });
    await definitions.publishObservationDefinition({ key: "page.metadata", version: "1.0.0", schema: {}, scopes: ["page"], statuses: ["observed", "not_collected"], sensitivity: "public", retentionClass: "evidence" });
    await definitions.publishCollectorDefinition({ key: "collector.html", version: "1.0.0", configurationSchema: {}, capabilities: [{ observationKey: "page.metadata", observationVersion: "1.0.0" }], executionMode: "worker" });
  });
  afterAll(async () => prisma.$disconnect());

  async function addPage(pageId: string, position: number) {
    await prisma.evidencePage.create({ data: { id: pageId, crawlRunId: runId, position, depth: 0, discoveredUrl: `https://example.test/${pageId}`, requestedUrl: `https://example.test/${pageId}`, normalizedUrl: `https://example.test/${pageId}`, finalUrl: `https://example.test/${pageId}`, canonicalUrls: [] } });
    await observations.appendSubject(organizationId, { id: `subject-${pageId}`, runId, kind: "page", identity: { pageId } });
  }
  async function addObservation(id: string, pageId: string, status: "observed" | "not_collected", sequence: number) {
    const executionId = `collection-${pageId}`;
    await observations.startExecution(organizationId, { id: executionId, runId, collectorKey: "collector.html", collectorVersion: "1.0.0", stableKey: executionId, attempt: 0, trigger: "collection", configuration: {}, startedAt: "2026-11-21T00:00:00.000Z" });
    await observations.appendObservation(organizationId, { id, runId, subjectId: `subject-${pageId}`, executionId, definitionKey: "page.metadata", definitionVersion: "1.0.0", sequence, status, payload: status === "observed" ? { title: pageId } : null, reasons: status === "observed" ? [] : ["blocked"], provenance: {}, collectedAt: "2026-11-21T00:00:01.000Z" });
  }
  async function startDiagnostic(id = "diagnostic-1", attempt = 0) {
    await diagnostics.startExecution(organizationId, { id, runId, ruleKey: "seo.title.consistency", ruleVersion: "1.0.0", stableKey: "title-consistency", attempt, configuration: {}, startedAt: `2026-11-21T00:00:0${attempt + 2}.000Z` });
  }

  it("publishes immutable rule versions with accepted observation inputs", async () => {
    await diagnostics.publishRule(rule());
    await diagnostics.publishRule(rule());
    await expect(diagnostics.publishRule({ ...rule(), outcomes: ["pass", "fail"] })).rejects.toThrow("definition conflict");
    await expect(new DiagnosticRepository(prisma, { canPublish: false }).publishRule(rule())).rejects.toThrow("publication authority");
  });

  it("persists deterministic results with ordered evidence dependencies", async () => {
    await addPage("page-1", 0); await addObservation("observation-1", "page-1", "observed", 0);
    await diagnostics.publishRule(rule()); await startDiagnostic();
    const result = { id: "result-1", runId, executionId: "diagnostic-1", subjectId: "subject-page-1", sequence: 0, outcome: "pass", messageData: { count: 1 }, limitations: [], inputObservationIds: ["observation-1"], collectedAt: "2026-11-21T00:00:03.000Z" };
    await diagnostics.appendResult(organizationId, result); await diagnostics.appendResult(organizationId, result);
    await expect(diagnostics.appendResult(organizationId, { ...result, outcome: "fail" })).rejects.toThrow("immutable diagnostic result conflict");
    const snapshot = await diagnostics.loadRunDiagnostics(organizationId, runId);
    expect(snapshot.results.at(0)!.inputs.map(({ observationId, position }) => ({ observationId, position }))).toEqual([{ observationId: "observation-1", position: 0 }]);
  });

  it("rejects unavailable required inputs unless the pinned rule supports them", async () => {
    await addPage("page-1", 0); await addObservation("observation-1", "page-1", "not_collected", 0);
    await diagnostics.publishRule(rule()); await startDiagnostic();
    const result = { id: "result-1", runId, executionId: "diagnostic-1", subjectId: "subject-page-1", sequence: 0, outcome: "unknown", messageData: {}, limitations: ["required_input_unavailable"], inputObservationIds: ["observation-1"], collectedAt: "2026-11-21T00:00:03.000Z" };
    await expect(diagnostics.appendResult(organizationId, result)).rejects.toThrow("required diagnostic input unavailable");

    await diagnostics.publishRule({ ...rule(true), version: "1.1.0" });
    await diagnostics.startExecution(organizationId, { id: "diagnostic-supported", runId, ruleKey: "seo.title.consistency", ruleVersion: "1.1.0", stableKey: "title-consistency-supported", attempt: 0, configuration: {}, startedAt: "2026-11-21T00:00:04.000Z" });
    await diagnostics.appendResult(organizationId, { ...result, id: "result-supported", executionId: "diagnostic-supported" });
  });

  it("allows explicit cross-page relevance and rejects unrelated or dangling observations", async () => {
    await addPage("page-1", 0); await addPage("page-2", 1); await addPage("page-3", 2);
    await addObservation("observation-1", "page-1", "observed", 0); await addObservation("observation-2", "page-2", "observed", 0);
    await addObservation("observation-3", "page-3", "observed", 0);
    await observations.appendSubject(organizationId, { id: "subject-cross", runId, kind: "cross_page", identity: { rule: "titles" }, members: ["subject-page-1", "subject-page-2"] });
    await diagnostics.publishRule(rule()); await startDiagnostic();
    const base = { id: "result-cross", runId, executionId: "diagnostic-1", subjectId: "subject-cross", sequence: 0, outcome: "fail", messageData: {}, limitations: [], collectedAt: "2026-11-21T00:00:03.000Z" };
    await diagnostics.appendResult(organizationId, { ...base, inputObservationIds: ["observation-2", "observation-1"] });
    await expect(diagnostics.appendResult(organizationId, { ...base, id: "result-dangling", sequence: 1, inputObservationIds: ["missing"] })).rejects.toThrow("diagnostic input observation not found");
    await expect(diagnostics.appendResult(organizationId, { ...base, id: "result-unrelated", sequence: 1, inputObservationIds: ["observation-3"] })).rejects.toThrow("diagnostic input subject is not relevant");
  });

  it("isolates tenants and retry attempts", async () => {
    await diagnostics.publishRule(rule()); await startDiagnostic();
    await diagnostics.finishExecution(organizationId, { executionId: "diagnostic-1", status: "failed", finishedAt: "2026-11-21T00:00:04.000Z", error: { code: "rule_failed" } });
    await startDiagnostic("diagnostic-2", 1);
    await expect(diagnostics.loadRunDiagnostics(randomUUID(), runId)).rejects.toThrow("crawl run not found");
    const snapshot = await diagnostics.loadRunDiagnostics(organizationId, runId);
    expect(snapshot.executions.map(({ attempt, status }) => ({ attempt, status }))).toEqual([{ attempt: 0, status: "failed" }, { attempt: 1, status: "running" }]);
  });

  it("rejects diagnostic execution and results after the run is frozen", async () => {
    await diagnostics.publishRule(rule());
    await prisma.crawlRun.update({ where: { id: runId }, data: { frozenAt: new Date("2026-11-21T00:00:05.000Z") } });
    await expect(startDiagnostic()).rejects.toThrow("frozen");
  });
});
