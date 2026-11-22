import { createHash } from "node:crypto";
import { defineExportProjection, type ExportProjectionDefinitionInput } from "@website-bot-scroll/domain/export-projection";
import { buildNeutralSnapshot } from "@website-bot-scroll/evidence-producer/platform-snapshot";
import { Prisma } from "../../generated/prisma/client.js";
import type { DatabaseClient } from "../client.js";

const json = (value: unknown): Prisma.InputJsonValue => value as Prisma.InputJsonValue;
const stable = (value: unknown): unknown => Array.isArray(value) ? value.map(stable) : value !== null && typeof value === "object"
  ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stable(item)])) : value;
const same = (a: unknown, b: unknown) => JSON.stringify(stable(a)) === JSON.stringify(stable(b));

export class SnapshotRepository {
  constructor(private readonly prisma: DatabaseClient) {}

  async freezePlatformSnapshot(organizationId: string, runId: string) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.platformSnapshot.findFirst({ where: { crawlRunId: runId, organizationId } });
      if (existing) return existing;
      const run = await tx.crawlRun.findFirst({ where: { id: runId, organizationId } });
      if (!run) throw new Error("crawl run not found");
      if (!["COMPLETED", "PARTIAL", "FAILED", "CANCELLED"].includes(run.status) || !run.finishedAt) throw new Error("crawl run must be terminal");
      if (run.collectedCount + run.failedCount !== run.attemptedCount || run.attemptedCount > run.discoveredCount || run.unattemptedCount !== run.discoveredCount - run.attemptedCount) throw new Error("coverage is inconsistent");
      if (!run.producerVersion || !/^[a-f0-9]{40}$/.test(run.producerVersion)) throw new Error("exact producer revision is required");
      const [activeObservation, activeDiagnostic, unavailableArtifact, subjects, observationExecutions, observations, diagnosticExecutions, diagnosticResults, artifacts] = await Promise.all([
        tx.observationExecution.findFirst({ where: { crawlRunId: runId, status: { in: ["pending", "running"] } } }),
        tx.diagnosticExecution.findFirst({ where: { crawlRunId: runId, status: { in: ["pending", "running"] } } }),
        tx.evidenceArtifact.findFirst({ where: { crawlRunId: runId, availability: { not: "available" } } }),
        tx.observationSubject.findMany({ where: { crawlRunId: runId }, orderBy: { position: "asc" }, include: { members: { orderBy: { position: "asc" } } } }),
        tx.observationExecution.findMany({ where: { crawlRunId: runId }, orderBy: [{ stableKey: "asc" }, { attempt: "asc" }] }),
        tx.platformObservation.findMany({ where: { crawlRunId: runId }, orderBy: [{ executionId: "asc" }, { sequence: "asc" }], include: { artifacts: { orderBy: { position: "asc" } }, definition: true } }),
        tx.diagnosticExecution.findMany({ where: { crawlRunId: runId }, orderBy: [{ stableKey: "asc" }, { attempt: "asc" }], include: { rule: true } }),
        tx.diagnosticResult.findMany({ where: { crawlRunId: runId }, orderBy: [{ executionId: "asc" }, { sequence: "asc" }], include: { inputs: { orderBy: { position: "asc" } } } }),
        tx.evidenceArtifact.findMany({ where: { crawlRunId: runId }, orderBy: { sha256: "asc" } }),
      ]);
      if (activeObservation || activeDiagnostic) throw new Error("active execution prevents freeze");
      if (unavailableArtifact) throw new Error("artifact unavailable");
      const payload = { run: { id: run.id, organizationId, siteId: run.siteId, status: run.status, producerRevision: run.producerVersion, coverage: { discovered: run.discoveredCount, attempted: run.attemptedCount, collected: run.collectedCount, failed: run.failedCount, unattempted: run.unattemptedCount } }, subjects, observationExecutions, observations, diagnosticExecutions, diagnosticResults, artifacts };
      const built = buildNeutralSnapshot(payload);
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
