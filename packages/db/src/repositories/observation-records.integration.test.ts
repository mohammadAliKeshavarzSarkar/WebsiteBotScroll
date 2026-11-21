import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createPrismaClient } from "../client.js";
import { DefinitionRepository } from "./definitions.js";
import { ObservationRepository } from "./observation-records.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

describeDatabase("ObservationRepository", () => {
  const prisma = createPrismaClient(databaseUrl!);
  const definitions = new DefinitionRepository(prisma, { canPublish: true });
  const records = new ObservationRepository(prisma);
  let organizationId: string;
  let siteId: string;
  let runId: string;
  let pageId: string;

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE
      "platform_observations", "observation_subject_members", "observation_subjects", "observation_executions",
      "collector_capabilities", "collector_definitions", "observation_definitions",
      "evidence_pages", "crawl_runs", "export_authorizations", "sites", "organizations" CASCADE`);
    organizationId = randomUUID(); siteId = randomUUID(); runId = randomUUID(); pageId = `page-${randomUUID()}`;
    await prisma.organization.create({ data: { id: organizationId, name: "Owner" } });
    await prisma.site.create({ data: { id: siteId, organizationId, name: "Site", origin: "https://example.test" } });
    await prisma.crawlRun.create({ data: {
      id: runId, organizationId, siteId, trigger: "MANUAL", idempotencyKey: randomUUID(), status: "RUNNING",
      scope: { seed_urls: ["https://example.test/"], allowed_hosts: ["example.test"] }, limits: { max_pages: 5 },
    } });
    await prisma.evidencePage.create({ data: {
      id: pageId, crawlRunId: runId, position: 0, depth: 0, discoveredUrl: "https://example.test/",
      requestedUrl: "https://example.test/", normalizedUrl: "https://example.test/", finalUrl: "https://example.test/", canonicalUrls: [],
    } });
    await definitions.publishObservationDefinition({
      key: "page.metadata", version: "1.0.0",
      schema: { type: "object", properties: { title: { type: "string" } }, required: ["title"], additionalProperties: false },
      scopes: ["page"], statuses: ["observed", "partial", "not_collected", "failed"], sensitivity: "public", retentionClass: "evidence",
    });
    await definitions.publishCollectorDefinition({
      key: "crawler.html", version: "1.0.0", configurationSchema: { type: "object", additionalProperties: false },
      capabilities: [{ observationKey: "page.metadata", observationVersion: "1.0.0" }], executionMode: "worker",
    });
  });
  afterAll(async () => prisma.$disconnect());

  const start = () => records.startExecution(organizationId, {
    id: "execution-1", runId, collectorKey: "crawler.html", collectorVersion: "1.0.0", stableKey: "html-main", attempt: 0,
    trigger: "manual", configuration: {}, startedAt: "2026-11-19T08:00:00.000Z",
  });

  it("persists all subject kinds and ordered cross-page members", async () => {
    await records.appendSubject(organizationId, { id: "subject-run", runId, kind: "run", identity: { runId } });
    await records.appendSubject(organizationId, { id: "subject-site", runId, kind: "site", identity: { siteId } });
    await records.appendSubject(organizationId, { id: "subject-page", runId, kind: "page", identity: { pageId } });
    await records.appendSubject(organizationId, { id: "subject-resource", runId, kind: "resource", identity: { url: "https://example.test/app.css" } });
    await records.appendSubject(organizationId, { id: "subject-cross", runId, kind: "cross_page", identity: {}, members: ["subject-page", "subject-resource"] });
    const snapshot = await records.loadRunRecords(organizationId, runId);
    expect(snapshot.subjects.map(({ kind }) => kind)).toEqual(["run", "site", "page", "resource", "cross_page"]);
    expect(snapshot.subjects.at(-1)?.members.map(({ subjectId }) => subjectId)).toEqual(["subject-page", "subject-resource"]);
  });

  it("rejects resource hosts and page identities outside the owned run", async () => {
    await expect(records.appendSubject(organizationId, { id: "bad-resource", runId, kind: "resource", identity: { url: "https://outside.test/a.js" } })).rejects.toThrow("resource ownership");
    await expect(records.appendSubject(organizationId, { id: "bad-page", runId, kind: "page", identity: { pageId: "missing" } })).rejects.toThrow("page ownership");
  });

  it("enforces tenant ownership and parent execution lifecycle", async () => {
    await expect(records.startExecution(randomUUID(), { id: "bad", runId, collectorKey: "crawler.html", collectorVersion: "1.0.0", stableKey: "x", attempt: 0, trigger: "manual", configuration: {}, startedAt: "2026-11-19T08:00:00.000Z" })).rejects.toThrow("crawl run not found");
    await start();
    await records.startExecution(organizationId, { id: "execution-child", runId, parentExecutionId: "execution-1", collectorKey: "crawler.html", collectorVersion: "1.0.0", stableKey: "child", attempt: 0, trigger: "derived", configuration: {}, startedAt: "2026-11-19T08:00:01.000Z" });
    await expect(records.finishExecution(organizationId, { executionId: "execution-1", status: "completed", finishedAt: "2026-11-19T08:00:02.000Z" })).rejects.toThrow("child execution");
    await records.finishExecution(organizationId, { executionId: "execution-child", status: "completed", finishedAt: "2026-11-19T08:00:02.000Z" });
    await records.finishExecution(organizationId, { executionId: "execution-1", status: "completed", finishedAt: "2026-11-19T08:00:03.000Z" });
  });

  it("validates definition scope, collector capability, payload, and immutable retry", async () => {
    await records.appendSubject(organizationId, { id: "subject-page", runId, kind: "page", identity: { pageId } });
    await start();
    const input = { id: "observation-1", runId, subjectId: "subject-page", executionId: "execution-1", definitionKey: "page.metadata", definitionVersion: "1.0.0", sequence: 0, status: "observed" as const, payload: { title: "عنوان" }, reasons: [], provenance: { collector: "crawler.html", version: "1.0.0" }, collectedAt: "2026-11-19T08:00:01.000Z" };
    await records.appendObservation(organizationId, input);
    await records.appendObservation(organizationId, input);
    expect(await prisma.platformObservation.count()).toBe(1);
    await expect(records.appendObservation(organizationId, { ...input, payload: { title: 42 } })).rejects.toThrow("payload validation");
    await expect(records.appendObservation(organizationId, { ...input, payload: { title: "changed" } })).rejects.toThrow("immutable observation conflict");
  });

  it("rejects unknown definitions and invalid attempt transitions", async () => {
    await expect(records.startExecution(organizationId, { id: "execution-bad", runId, collectorKey: "missing", collectorVersion: "1.0.0", stableKey: "missing", attempt: 0, trigger: "manual", configuration: {}, startedAt: "2026-11-19T08:00:00.000Z" })).rejects.toThrow("collector definition");
    await start();
    await expect(records.startExecution(organizationId, { id: "execution-retry", runId, collectorKey: "crawler.html", collectorVersion: "1.0.0", stableKey: "html-main", attempt: 2, trigger: "retry", configuration: {}, startedAt: "2026-11-19T08:00:01.000Z" })).rejects.toThrow("attempt sequence");
  });
});
