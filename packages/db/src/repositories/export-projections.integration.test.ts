import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createPrismaClient } from "../client.js";
import { ExportProjectionRepository, SnapshotRepository } from "./export-projections.js";
import { ObservationRepository } from "./observation-records.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;
const revision = "a".repeat(40);

describeDatabase("frozen platform snapshots and projections", () => {
  const prisma = createPrismaClient(databaseUrl!);
  const projections = new ExportProjectionRepository(prisma, { canPublish: true });
  const snapshots = new SnapshotRepository(prisma);
  const observations = new ObservationRepository(prisma);
  let organizationId: string; let runId: string;

  beforeEach(async () => {
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "projection_executions", "platform_snapshots", "export_projection_definitions", "diagnostic_rule_definitions", "collector_definitions", "observation_definitions", "evidence_artifacts", "crawl_runs", "sites", "organizations" CASCADE');
    organizationId = randomUUID(); runId = randomUUID(); const siteId = randomUUID();
    await prisma.organization.create({ data: { id: organizationId, name: "Owner" } });
    await prisma.site.create({ data: { id: siteId, organizationId, name: "Site", origin: "https://example.test" } });
    await prisma.crawlRun.create({ data: { id: runId, organizationId, siteId, trigger: "MANUAL", idempotencyKey: randomUUID(), status: "COMPLETED", startedAt: new Date("2026-11-21T00:00:00.000Z"), finishedAt: new Date("2026-11-21T00:00:01.000Z"), scope: {}, limits: {}, producerVersion: revision, discoveredCount: 0, attemptedCount: 0, collectedCount: 0, failedCount: 0, unattemptedCount: 0, stopReason: "completed" } });
  });
  afterAll(async () => prisma.$disconnect());

  const definition = (key = "platform.neutral-json") => ({ key, version: "1.0.0", format: "neutral-json", mediaType: "application/json", acceptedObservationDefinitions: [], acceptedDiagnosticRules: [] });

  it("publishes immutable projection definitions", async () => {
    await projections.publishProjection(definition()); await projections.publishProjection(definition());
    await expect(projections.publishProjection({ ...definition(), mediaType: "text/plain" })).rejects.toThrow("definition conflict");
    await expect(new ExportProjectionRepository(prisma).publishProjection(definition())).rejects.toThrow("publication authority");
    await expect(projections.publishProjection({ ...definition("invalid.dependencies"), acceptedObservationDefinitions: [{ key: "missing.observation", version: "1.0.0" }] })).rejects.toThrow("projection dependency not found");
  });

  it("freezes one deterministic tenant-owned snapshot and prevents overwrite", async () => {
    await snapshots.recordParityCheckpoint(organizationId, runId, { checkpoint: { observations: 0 }, parityDigest: "d".repeat(64) });
    await snapshots.switchToGeneralizedReads(organizationId, runId);
    const first = await snapshots.freezePlatformSnapshot(organizationId, runId);
    const second = await snapshots.freezePlatformSnapshot(organizationId, runId);
    expect(second.id).toBe(first.id); expect(second.sha256).toBe(first.sha256); expect(first.producerRevision).toBe(revision);
    await expect(snapshots.loadSnapshot(randomUUID(), first.id)).rejects.toThrow("snapshot not found");
    await expect(prisma.platformSnapshot.update({ where: { id: first.id }, data: { sha256: "b".repeat(64) } })).rejects.toThrow();
    await expect(prisma.platformSnapshot.delete({ where: { id: first.id } })).rejects.toThrow();
    await expect(observations.appendSubject(organizationId, { id: "late-subject", runId, kind: "run", identity: { runId } })).rejects.toThrow("frozen");
  });

  it("rejects inconsistent coverage, dirty revisions, active executions, and unavailable artifacts", async () => {
    await prisma.crawlRun.update({ where: { id: runId }, data: { attemptedCount: 1 } });
    await expect(snapshots.freezePlatformSnapshot(organizationId, runId)).rejects.toThrow("coverage");
    await prisma.crawlRun.update({ where: { id: runId }, data: { attemptedCount: 0, producerVersion: "dirty" } });
    await expect(snapshots.freezePlatformSnapshot(organizationId, runId)).rejects.toThrow("producer revision");
    await prisma.crawlRun.update({ where: { id: runId }, data: { producerVersion: revision } });
    await snapshots.recordParityCheckpoint(organizationId, runId, { checkpoint: { observations: 0 }, parityDigest: "d".repeat(64) });
    await snapshots.switchToGeneralizedReads(organizationId, runId);
    await prisma.evidenceArtifact.create({ data: { organizationId, crawlRunId: runId, sha256: "c".repeat(64), byteLength: 1, mediaType: "text/plain", locator: "sha256/cc/c", sensitivity: "public", retentionClass: "evidence", availability: "unavailable" } });
    await expect(snapshots.freezePlatformSnapshot(organizationId, runId)).rejects.toThrow("artifact unavailable");
  });

  it("requires verified parity and a generalized read switch before freeze", async () => {
    await expect(snapshots.freezePlatformSnapshot(organizationId, runId)).rejects.toThrow("migration parity");
    await snapshots.recordParityCheckpoint(organizationId, runId, { checkpoint: { observations: 0 }, parityDigest: "d".repeat(64) });
    await expect(snapshots.freezePlatformSnapshot(organizationId, runId)).rejects.toThrow("read authority");
    await snapshots.switchToGeneralizedReads(organizationId, runId);
    await expect(snapshots.freezePlatformSnapshot(organizationId, runId)).resolves.toMatchObject({ crawlRunId: runId });
  });

  it("never promotes a historically legacy-frozen run", async () => {
    await prisma.crawlRun.update({ where: { id: runId }, data: { frozenAt: new Date("2026-11-21T00:00:02.000Z") } });
    await expect(snapshots.recordParityCheckpoint(organizationId, runId, { checkpoint: {}, parityDigest: "d".repeat(64) })).rejects.toThrow("legacy-frozen");
  });

  it("freezes a nonempty typed snapshot without losing dates, byte counts, renderer provenance, or dependencies", async () => {
    const pageId = "page-typed";
    const observationDefinition = await prisma.observationDefinition.create({ data: {
      key: "page.snapshot", version: "1.0.0", schema: {}, schemaSha256: "1".repeat(64), scopes: ["page"], statuses: ["observed"], sensitivity: "public", retentionClass: "evidence",
    } });
    const collector = await prisma.collectorDefinition.create({ data: {
      key: "renderer.synthetic", version: "1.0.0", configurationSchema: {}, configurationSchemaSha256: "2".repeat(64), executionMode: "renderer",
      capabilities: { create: { observationDefinitionId: observationDefinition.id, position: 0 } },
    } });
    const rule = await prisma.diagnosticRuleDefinition.create({ data: {
      key: "seo.snapshot", version: "1.0.0", policyVersion: "2026-11", configurationSchema: {}, configurationSchemaSha256: "3".repeat(64), outcomes: ["pass"], supportsUnavailableInputs: false,
      inputs: { create: { observationDefinitionId: observationDefinition.id, position: 0, scopes: ["page"], required: true } },
    } });
    await prisma.evidencePage.create({ data: {
      id: pageId, crawlRunId: runId, position: 0, depth: 0, discoveredUrl: "https://example.test/fa", requestedUrl: "https://example.test/fa", normalizedUrl: "https://example.test/fa", finalUrl: "https://example.test/fa", canonicalUrls: ["https://example.test/fa"],
      transactions: { create: { id: "transaction-typed", position: 0, method: "GET", requestUrl: "https://example.test/fa", responseUrl: "https://example.test/fa", statusCode: 200, startedAt: new Date("2026-11-21T00:00:00.200Z"), finishedAt: new Date("2026-11-21T00:00:00.700Z"), transferredBytes: 123n, decodedBytes: 456n,
        headers: { create: { position: 0, name: "set-cookie", values: { create: [{ position: 0, value: "a=1" }, { position: 1, value: "b=2" }] } } } } },
    } });
    await prisma.observationSubject.create({ data: { id: "subject-typed", organizationId, crawlRunId: runId, position: 0, kind: "page", identity: { pageId } } });
    await prisma.observationExecution.create({ data: {
      id: "execution-typed", organizationId, crawlRunId: runId, collectorDefinitionId: collector.id, stableKey: "typed", attempt: 0, trigger: "synthetic", configuration: {}, status: "completed", startedAt: new Date("2026-11-21T00:00:00.100Z"), finishedAt: new Date("2026-11-21T00:00:00.900Z"),
      rendererSession: { create: { engine: "synthetic", engineVersion: "1.0.0", viewportWidth: 1280, viewportHeight: 720, deviceScaleFactor: 1, locale: "fa-IR", userAgent: "WebsiteBotScroll/Test", timingPolicy: { wait: "network-idle" } } },
    } });
    await prisma.platformObservation.create({ data: {
      id: "observation-typed", organizationId, crawlRunId: runId, subjectId: "subject-typed", executionId: "execution-typed", observationDefinitionId: observationDefinition.id, sequence: 0, status: "observed", payload: { title: "عنوان فارسی" }, reasons: [], provenance: { collector: "renderer.synthetic", version: "1.0.0", transaction_ids: ["transaction-typed"] }, collectedAt: new Date("2026-11-21T00:00:00.800Z"),
    } });
    await prisma.diagnosticExecution.create({ data: { id: "diagnostic-typed", organizationId, crawlRunId: runId, ruleDefinitionId: rule.id, stableKey: "title", attempt: 0, configuration: {}, status: "completed", startedAt: new Date("2026-11-21T00:00:01.000Z"), finishedAt: new Date("2026-11-21T00:00:01.100Z") } });
    await prisma.diagnosticResult.create({ data: {
      id: "result-typed", organizationId, crawlRunId: runId, executionId: "diagnostic-typed", subjectId: "subject-typed", sequence: 0, outcome: "pass", messageData: { title: "عنوان فارسی" }, limitations: [], collectedAt: new Date("2026-11-21T00:00:01.050Z"), inputs: { create: { observationId: "observation-typed", position: 0 } },
    } });
    await prisma.crawlRun.update({ where: { id: runId }, data: { discoveredCount: 1, attemptedCount: 1, collectedCount: 1, unattemptedCount: 0 } });
    await snapshots.recordParityCheckpoint(organizationId, runId, { checkpoint: { observations: 1 }, parityDigest: "d".repeat(64) });
    await snapshots.switchToGeneralizedReads(organizationId, runId);

    const snapshot = await snapshots.freezePlatformSnapshot(organizationId, runId);
    const payload = snapshot.payload as any;
    expect(payload.evidencePages[0].transactions[0]).toMatchObject({ transferredBytes: 123, decodedBytes: 456 });
    expect(payload.evidencePages[0].transactions[0].headers[0].values.map(({ value }: { value: string }) => value)).toEqual(["a=1", "b=2"]);
    expect(payload.observationExecutions[0]).toMatchObject({ startedAt: "2026-11-21T00:00:00.100Z", finishedAt: "2026-11-21T00:00:00.900Z", collector: { key: "renderer.synthetic", version: "1.0.0" }, rendererSession: { engine: "synthetic", locale: "fa-IR" } });
    expect(payload.observations[0]).toMatchObject({ collectedAt: "2026-11-21T00:00:00.800Z", payload: { title: "عنوان فارسی" } });
    expect(payload.diagnosticResults[0].inputs).toEqual([{ observationId: "observation-typed", position: 0 }]);
  });

  it("runs deterministic projection retries against the identical snapshot", async () => {
    await projections.publishProjection(definition()); await projections.publishProjection(definition("contract.canonical-json"));
    await snapshots.recordParityCheckpoint(organizationId, runId, { checkpoint: { observations: 0 }, parityDigest: "d".repeat(64) });
    await snapshots.switchToGeneralizedReads(organizationId, runId);
    const snapshot = await snapshots.freezePlatformSnapshot(organizationId, runId);
    const bytes = Buffer.from("{\"ok\":true}\n"); const sha256 = createHash("sha256").update(bytes).digest("hex");
    const first = await projections.runProjection(organizationId, snapshot.id, { id: "projection-1", key: "platform.neutral-json", version: "1.0.0", stableKey: "neutral", attempt: 0, bytes, sha256 });
    const repeated = await projections.runProjection(organizationId, snapshot.id, { id: "projection-1", key: "platform.neutral-json", version: "1.0.0", stableKey: "neutral", attempt: 0, bytes, sha256 });
    const canonical = await projections.runProjection(organizationId, snapshot.id, { id: "projection-2", key: "contract.canonical-json", version: "1.0.0", stableKey: "canonical", attempt: 0, bytes, sha256 });
    expect(repeated.outputArtifactId).toBe(first.outputArtifactId); expect(canonical.snapshotId).toBe(first.snapshotId);
    const changed = Buffer.from("changed"); const changedSha = createHash("sha256").update(changed).digest("hex");
    await expect(projections.runProjection(organizationId, snapshot.id, { id: "projection-1", key: "platform.neutral-json", version: "1.0.0", stableKey: "neutral", attempt: 0, bytes: changed, sha256: changedSha })).rejects.toThrow("immutable projection execution conflict");
  });
});
