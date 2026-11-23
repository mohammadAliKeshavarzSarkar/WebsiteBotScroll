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
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "projection_executions", "platform_snapshots", "export_projection_definitions", "evidence_artifacts", "crawl_runs", "sites", "organizations" CASCADE');
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
