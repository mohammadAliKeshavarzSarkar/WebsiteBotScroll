import { createHash } from "node:crypto";
import { defineExportProjection, type ExportProjectionDefinitionInput } from "@website-bot-scroll/domain/export-projection";
import { Prisma } from "../../generated/prisma/client.js";
import type { DatabaseClient } from "../client.js";

const json = (value: unknown): Prisma.InputJsonValue => value as Prisma.InputJsonValue;
const stable = (value: unknown): unknown => Array.isArray(value) ? value.map(stable) : value !== null && typeof value === "object"
  ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stable(item)])) : value;
const same = (a: unknown, b: unknown) => JSON.stringify(stable(a)) === JSON.stringify(stable(b));
const buildSnapshotBytes = (snapshot: unknown) => { const bytes = Buffer.from(`${JSON.stringify(stable(snapshot))}\n`, "utf8"); return { bytes, sha256: createHash("sha256").update(bytes).digest("hex") }; };

export class SnapshotRepository {
  constructor(private readonly prisma: DatabaseClient) {}

  async recordParityCheckpoint(organizationId: string, runId: string, input: { checkpoint: unknown; parityDigest: string }) {
    if (!/^[a-f0-9]{64}$/.test(input.parityDigest)) throw new Error("parity digest is invalid");
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "crawl_runs" WHERE "id" = ${runId}::uuid AND "organization_id" = ${organizationId}::uuid FOR UPDATE`;
      const run = await tx.crawlRun.findFirst({ where: { id: runId, organizationId } });
      if (!run) throw new Error("crawl run not found");
      if (run.frozenAt) throw new Error("legacy-frozen crawl run cannot be promoted");
      const existing = await tx.platformMigrationState.findUnique({ where: { crawlRunId: runId } });
      const comparable = { checkpoint: input.checkpoint, parityDigest: input.parityDigest };
      if (existing) {
        if (existing.organizationId !== organizationId || !same({ checkpoint: existing.checkpoint, parityDigest: existing.parityDigest }, comparable)) throw new Error("immutable migration parity conflict");
        return existing;
      }
      return tx.platformMigrationState.create({ data: { crawlRunId: runId, organizationId, checkpoint: json(input.checkpoint), parityDigest: input.parityDigest, parityVerifiedAt: new Date() } });
    });
  }

  async switchToGeneralizedReads(organizationId: string, runId: string) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "crawl_runs" WHERE "id" = ${runId}::uuid AND "organization_id" = ${organizationId}::uuid FOR UPDATE`;
      const run = await tx.crawlRun.findFirst({ where: { id: runId, organizationId } });
      if (!run) throw new Error("crawl run not found");
      if (run.frozenAt) throw new Error("legacy-frozen crawl run cannot be promoted");
      const state = await tx.platformMigrationState.findUnique({ where: { crawlRunId: runId } });
      if (!state?.parityVerifiedAt) throw new Error("migration parity checkpoint is required");
      if (state.readAuthority === "generalized") return state;
      return tx.platformMigrationState.update({ where: { crawlRunId: runId }, data: { readAuthority: "generalized", switchedAt: new Date() } });
    });
  }

  async freezePlatformSnapshot(organizationId: string, runId: string) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.platformSnapshot.findFirst({ where: { crawlRunId: runId, organizationId } });
      if (existing) return existing;
      await tx.$queryRaw`SELECT "id" FROM "crawl_runs" WHERE "id" = ${runId}::uuid AND "organization_id" = ${organizationId}::uuid FOR UPDATE`;
      const run = await tx.crawlRun.findFirst({ where: { id: runId, organizationId } });
      if (!run) throw new Error("crawl run not found");
      if (run.frozenAt) throw new Error("legacy-frozen crawl run cannot be exported through the generalized platform");
      if (!["COMPLETED", "PARTIAL", "FAILED", "CANCELLED"].includes(run.status) || !run.finishedAt) throw new Error("crawl run must be terminal");
      if (run.collectedCount + run.failedCount !== run.attemptedCount || run.attemptedCount > run.discoveredCount || run.unattemptedCount !== run.discoveredCount - run.attemptedCount) throw new Error("coverage is inconsistent");
      if (!run.producerVersion || !/^[a-f0-9]{40}$/.test(run.producerVersion)) throw new Error("exact producer revision is required");
      const migration = await tx.platformMigrationState.findUnique({ where: { crawlRunId: runId } });
      if (!migration?.parityVerifiedAt) throw new Error("migration parity checkpoint is required");
      if (migration.readAuthority !== "generalized" || !migration.switchedAt) throw new Error("generalized read authority is required");
      const [activeObservation, activeDiagnostic, unavailableArtifact, subjects, observationExecutions, observations, diagnosticExecutions, diagnosticResults, artifacts, evidencePages, evidenceLimitations, evidenceErrors] = await Promise.all([
        tx.observationExecution.findFirst({ where: { crawlRunId: runId, status: { in: ["pending", "running"] } } }),
        tx.diagnosticExecution.findFirst({ where: { crawlRunId: runId, status: { in: ["pending", "running"] } } }),
        tx.evidenceArtifact.findFirst({ where: { crawlRunId: runId, availability: { not: "available" } } }),
        tx.observationSubject.findMany({ where: { crawlRunId: runId }, orderBy: { position: "asc" }, include: { members: { orderBy: { position: "asc" } } } }),
        tx.observationExecution.findMany({ where: { crawlRunId: runId }, orderBy: [{ stableKey: "asc" }, { attempt: "asc" }] }),
        tx.platformObservation.findMany({ where: { crawlRunId: runId }, orderBy: [{ executionId: "asc" }, { sequence: "asc" }], include: { artifacts: { orderBy: { position: "asc" } }, definition: true } }),
        tx.diagnosticExecution.findMany({ where: { crawlRunId: runId }, orderBy: [{ stableKey: "asc" }, { attempt: "asc" }], include: { rule: true } }),
        tx.diagnosticResult.findMany({ where: { crawlRunId: runId }, orderBy: [{ executionId: "asc" }, { sequence: "asc" }], include: { inputs: { orderBy: { position: "asc" } } } }),
        tx.evidenceArtifact.findMany({ where: { crawlRunId: runId }, orderBy: { sha256: "asc" } }),
        tx.evidencePage.findMany({ where: { crawlRunId: runId }, orderBy: { position: "asc" }, include: { transactions: { orderBy: { position: "asc" }, include: { headers: { orderBy: { position: "asc" }, include: { values: { orderBy: { position: "asc" } } } } } } } }),
        tx.evidenceLimitation.findMany({ where: { crawlRunId: runId }, orderBy: { id: "asc" } }),
        tx.evidenceError.findMany({ where: { crawlRunId: runId }, orderBy: { id: "asc" } }),
      ]);
      if (activeObservation || activeDiagnostic) throw new Error("active execution prevents freeze");
      if (unavailableArtifact) throw new Error("artifact unavailable");
      const payload = { run: { id: run.id, organizationId, siteId: run.siteId, authorizationRef: run.authorizationId, trigger: run.trigger.toLowerCase(), status: run.status.toLowerCase(), startedAt: run.startedAt?.toISOString(), finishedAt: run.finishedAt.toISOString(), scope: run.scope, limits: run.limits, producerRevision: run.producerVersion, normalizationPolicyVersion: run.normalizationPolicyVersion, extractorVersion: run.extractorVersion, stopReason: run.stopReason, coverage: { discovered: run.discoveredCount, attempted: run.attemptedCount, collected: run.collectedCount, failed: run.failedCount, unattempted: run.unattemptedCount } }, subjects, observationExecutions, observations, diagnosticExecutions, diagnosticResults, artifacts, evidencePages, evidenceLimitations, evidenceErrors };
      const built = buildSnapshotBytes(payload);
      const snapshot = await tx.platformSnapshot.create({ data: { organizationId, crawlRunId: runId, producerRevision: run.producerVersion, sha256: built.sha256, payload: json(JSON.parse(built.bytes.toString("utf8"))) } });
      await tx.crawlRun.update({ where: { id: runId }, data: { frozenAt: snapshot.frozenAt } });
      return snapshot;
    });
  }

  async loadSnapshot(organizationId: string, snapshotId: string) {
    const snapshot = await this.prisma.platformSnapshot.findFirst({ where: { id: snapshotId, organizationId } });
    if (!snapshot) throw new Error("snapshot not found");
    return snapshot;
  }
}

export class ExportProjectionRepository {
  constructor(private readonly prisma: DatabaseClient, private readonly access: { canPublish: boolean } = { canPublish: false }) {}

  async publishProjection(input: ExportProjectionDefinitionInput) {
    if (!this.access.canPublish) throw new Error("projection publication authority required");
    const defined = defineExportProjection(input);
    const [observationDependencies, diagnosticDependencies] = await Promise.all([
      Promise.all(defined.acceptedObservationDefinitions.map(({ key, version }) => this.prisma.observationDefinition.findUnique({ where: { key_version: { key, version } } }))),
      Promise.all(defined.acceptedDiagnosticRules.map(({ key, version }) => this.prisma.diagnosticRuleDefinition.findUnique({ where: { key_version: { key, version } } }))),
    ]);
    if (observationDependencies.some((dependency) => !dependency || dependency.status !== "published") || diagnosticDependencies.some((dependency) => !dependency || dependency.status !== "published")) throw new Error("projection dependency not found");
    const existing = await this.prisma.exportProjectionDefinition.findUnique({ where: { key_version: { key: defined.key, version: defined.version } } });
    const comparable = { format: defined.format, mediaType: defined.mediaType, acceptedObservationDefinitions: defined.acceptedObservationDefinitions, acceptedDiagnosticRules: defined.acceptedDiagnosticRules, identitySha256: defined.identitySha256 };
    if (existing) {
      if (!same({ format: existing.format, mediaType: existing.mediaType, acceptedObservationDefinitions: existing.acceptedObservationDefinitions, acceptedDiagnosticRules: existing.acceptedDiagnosticRules, identitySha256: existing.identitySha256 }, comparable)) throw new Error("definition conflict");
      return existing;
    }
    return this.prisma.exportProjectionDefinition.create({ data: { key: defined.key, version: defined.version, ...comparable } });
  }

  async runProjection(organizationId: string, snapshotId: string, input: { id: string; key: string; version: string; stableKey: string; attempt: number; bytes: Uint8Array; sha256: string }) {
    const [snapshot, projection] = await Promise.all([
      this.prisma.platformSnapshot.findFirst({ where: { id: snapshotId, organizationId } }),
      this.prisma.exportProjectionDefinition.findUnique({ where: { key_version: { key: input.key, version: input.version } } }),
    ]);
    if (!snapshot) throw new Error("snapshot not found");
    if (!projection || projection.status !== "published") throw new Error("projection definition not found");
    const actualHash = createHash("sha256").update(input.bytes).digest("hex");
    if (actualHash !== input.sha256) throw new Error("projection output checksum mismatch");
    const existing = await this.prisma.projectionExecution.findUnique({ where: { id: input.id } });
    if (existing) {
      if (existing.organizationId !== organizationId || existing.snapshotId !== snapshotId || existing.projectionDefinitionId !== projection.id || existing.stableKey !== input.stableKey || existing.attempt !== input.attempt || existing.outputSha256 !== input.sha256) throw new Error("immutable projection execution conflict");
      return existing;
    }
    const latest = await this.prisma.projectionExecution.findFirst({ where: { snapshotId, stableKey: input.stableKey }, orderBy: { attempt: "desc" } });
    if (input.attempt !== (latest ? latest.attempt + 1 : 0)) throw new Error("projection attempt sequence invalid");
    const run = await this.prisma.crawlRun.findUnique({ where: { id: snapshot.crawlRunId } });
    const artifact = await this.prisma.evidenceArtifact.upsert({ where: { organizationId_sha256: { organizationId, sha256: input.sha256 } }, update: {}, create: { organizationId, crawlRunId: snapshot.crawlRunId, sha256: input.sha256, byteLength: input.bytes.byteLength, mediaType: projection.mediaType, locator: `sha256/${input.sha256.slice(0, 2)}/${input.sha256}`, sensitivity: "internal", retentionClass: "export", pinnedAt: snapshot.frozenAt } });
    if (!run) throw new Error("crawl run not found");
    return this.prisma.projectionExecution.create({ data: { id: input.id, organizationId, snapshotId, projectionDefinitionId: projection.id, stableKey: input.stableKey, attempt: input.attempt, status: "completed", outputArtifactId: artifact.id, outputSha256: input.sha256 } });
  }
}
