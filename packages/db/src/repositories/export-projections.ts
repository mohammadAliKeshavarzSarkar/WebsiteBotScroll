import { createHash } from "node:crypto";
import { defineExportProjection, type ExportProjectionDefinitionInput } from "@website-bot-scroll/domain/export-projection";
import type { ArtifactStore } from "@website-bot-scroll/domain/evidence-artifact";
import { PLATFORM_LIMITS } from "@website-bot-scroll/domain/observation-platform";
import { Prisma } from "../../generated/prisma/client.js";
import type { DatabaseClient } from "../client.js";

const json = (value: unknown): Prisma.InputJsonValue => value as Prisma.InputJsonValue;
const safeInteger = (value: bigint): number => {
  const converted = Number(value);
  if (!Number.isSafeInteger(converted)) throw new Error("snapshot integer exceeds the safe range");
  return converted;
};
const stable = (value: unknown): unknown => value instanceof Date ? value.toISOString() : typeof value === "bigint" ? safeInteger(value) : Array.isArray(value) ? value.map(stable) : value !== null && typeof value === "object"
  ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stable(item)])) : value;
const same = (a: unknown, b: unknown) => JSON.stringify(stable(a)) === JSON.stringify(stable(b));
const buildSnapshotBytes = (snapshot: unknown) => { const bytes = Buffer.from(`${JSON.stringify(stable(snapshot))}\n`, "utf8"); return { bytes, sha256: createHash("sha256").update(bytes).digest("hex") }; };
const parityDigest = (rows: Array<{ key: string; status: string; payload: unknown; reasons: unknown; provenance: unknown }>) => {
  // Several pages can share a definition key. Break ties using the complete
  // canonical row so the digest is independent of database retrieval order.
  const canonical = rows.map((row) => ({ key: row.key, encoded: JSON.stringify(stable(row)) }));
  canonical.sort((left, right) => {
    if (left.key !== right.key) return left.key < right.key ? -1 : 1;
    return left.encoded < right.encoded ? -1 : left.encoded > right.encoded ? 1 : 0;
  });
  return createHash("sha256").update(`[${canonical.map(({ encoded }) => encoded).join(",")}]`, "utf8").digest("hex");
};
const readParity = async (tx: Prisma.TransactionClient, runId: string) => {
  const [legacy, generalized] = await Promise.all([
    tx.evidenceObservation.findMany({ where: { page: { crawlRunId: runId } }, include: { page: true } }),
    tx.platformObservation.findMany({ where: { crawlRunId: runId }, include: { definition: true } }),
  ]);
  const legacyDigest = parityDigest(legacy.map((row) => ({ key: `page.${row.method}`, status: row.status, payload: row.value, reasons: row.reasons, provenance: row.provenance })));
  const generalizedDigest = parityDigest(generalized.map((row) => ({ key: row.definition.key, status: row.status, payload: row.payload, reasons: row.reasons, provenance: row.provenance })));
  return { legacyDigest, generalizedDigest, legacyCount: legacy.length, generalizedCount: generalized.length };
};

export class SnapshotRepository {
  constructor(private readonly prisma: DatabaseClient) {}

  async inspectObservationParity(organizationId: string, runId: string) {
    const run = await this.prisma.crawlRun.findFirst({ where: { id: runId, organizationId }, select: { id: true } });
    if (!run) throw new Error("crawl run not found");
    return readParity(this.prisma as unknown as Prisma.TransactionClient, runId);
  }

  async recordParityCheckpoint(organizationId: string, runId: string, input: { checkpoint: unknown; parityDigest: string }) {
    if (!/^[a-f0-9]{64}$/.test(input.parityDigest)) throw new Error("parity digest is invalid");
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "crawl_runs" WHERE "id" = ${runId}::uuid AND "organization_id" = ${organizationId}::uuid FOR UPDATE`;
      const run = await tx.crawlRun.findFirst({ where: { id: runId, organizationId } });
      if (!run) throw new Error("crawl run not found");
      if (run.frozenAt) throw new Error("legacy-frozen crawl run cannot be promoted");
      const parity = await readParity(tx, runId);
      if (parity.legacyDigest !== parity.generalizedDigest || input.parityDigest !== parity.legacyDigest) throw new Error("persisted observation parity mismatch");
      const existing = await tx.platformMigrationState.findUnique({ where: { crawlRunId: runId } });
      const comparable = { checkpoint: { ...(input.checkpoint as Record<string, unknown>), ...parity }, parityDigest: input.parityDigest };
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
      const parity = await readParity(tx, runId);
      if (parity.legacyDigest !== state.parityDigest || parity.generalizedDigest !== state.parityDigest) throw new Error("migration parity checkpoint is stale");
      if (state.readAuthority === "generalized") return state;
      return tx.platformMigrationState.update({ where: { crawlRunId: runId }, data: { readAuthority: "generalized", switchedAt: new Date() } });
    });
  }

  async finalizePlatformCrawl(organizationId: string, runId: string, status: "COMPLETED" | "PARTIAL") {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "crawl_runs" WHERE "id" = ${runId}::uuid AND "organization_id" = ${organizationId}::uuid FOR UPDATE`;
      const existing = await tx.platformSnapshot.findFirst({ where: { crawlRunId: runId, organizationId } });
      if (existing) return existing;
      const updated = await tx.crawlRun.updateMany({
        where: { id: runId, organizationId, status: "RUNNING", frozenAt: null },
        data: { status, finishedAt: new Date(), activeSiteKey: null },
      });
      if (!updated.count) throw new Error("crawl run is not active");
      const parity = await readParity(tx, runId);
      if (parity.legacyDigest !== parity.generalizedDigest) throw new Error("persisted observation parity mismatch");
      const now = new Date();
      await tx.platformMigrationState.create({ data: {
        organizationId, crawlRunId: runId, readAuthority: "generalized",
        checkpoint: json({ legacyCount: parity.legacyCount, generalizedCount: parity.generalizedCount }),
        parityDigest: parity.legacyDigest, parityVerifiedAt: now, switchedAt: now,
      } });
      return this.freezeSnapshot(tx, organizationId, runId);
    }, { timeout: 30_000 });
  }

  async freezePlatformSnapshot(organizationId: string, runId: string) {
    return this.prisma.$transaction(async (tx) => this.freezeSnapshot(tx, organizationId, runId));
  }

  private async freezeSnapshot(tx: Prisma.TransactionClient, organizationId: string, runId: string) {
      await tx.$queryRaw`SELECT "id" FROM "crawl_runs" WHERE "id" = ${runId}::uuid AND "organization_id" = ${organizationId}::uuid FOR UPDATE`;
      const existing = await tx.platformSnapshot.findFirst({ where: { crawlRunId: runId, organizationId } });
      if (existing) return existing;
      const run = await tx.crawlRun.findFirst({ where: { id: runId, organizationId }, include: { authorization: true, _count: { select: { evidencePages: true } } } });
      if (!run) throw new Error("crawl run not found");
      if (run.frozenAt) throw new Error("legacy-frozen crawl run cannot be exported through the generalized platform");
      if (!["COMPLETED", "PARTIAL", "FAILED", "CANCELLED"].includes(run.status) || !run.finishedAt) throw new Error("crawl run must be terminal");
      if (run.trigger !== "MANUAL") throw new Error("only manual crawl runs are export eligible");
      if (!run.authorization || run.authorization.revokedAt || !same(run.scope, run.authorization.scope)) throw new Error("authorization scope mismatch");
      if (run.collectedCount + run.failedCount !== run.attemptedCount || run.attemptedCount > run.discoveredCount || run.unattemptedCount !== run.discoveredCount - run.attemptedCount) throw new Error("coverage is inconsistent");
      if (run._count.evidencePages !== run.collectedCount) throw new Error("coverage is inconsistent");
      if (!run.producerVersion || !/^[a-f0-9]{40}$/.test(run.producerVersion)) throw new Error("exact producer revision is required");
      const migration = await tx.platformMigrationState.findUnique({ where: { crawlRunId: runId } });
      if (!migration?.parityVerifiedAt) throw new Error("migration parity checkpoint is required");
      if (migration.readAuthority !== "generalized" || !migration.switchedAt) throw new Error("generalized read authority is required");
      const parity = await readParity(tx, runId);
      if (parity.legacyDigest !== migration.parityDigest || parity.generalizedDigest !== migration.parityDigest) throw new Error("migration parity checkpoint is stale");
      const [activeObservation, activeDiagnostic, unavailableArtifact, subjects, observationExecutions, observations, diagnosticExecutions, diagnosticResults, artifacts, evidencePages, evidenceLimitations, evidenceErrors] = await Promise.all([
        tx.observationExecution.findFirst({ where: { crawlRunId: runId, status: { in: ["pending", "running"] } } }),
        tx.diagnosticExecution.findFirst({ where: { crawlRunId: runId, status: { in: ["pending", "running"] } } }),
        tx.evidenceArtifact.findFirst({ where: { crawlRunId: runId, availability: { not: "available" } } }),
        tx.observationSubject.findMany({ where: { crawlRunId: runId }, orderBy: { position: "asc" }, include: { members: { orderBy: { position: "asc" } } } }),
        tx.observationExecution.findMany({ where: { crawlRunId: runId }, orderBy: [{ stableKey: "asc" }, { attempt: "asc" }], include: { collector: true, rendererSession: true } }),
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
      const pageById = new Map(evidencePages.map((page) => [page.id, page]));
      const subjectPage = new Map(subjects.map((subject) => [subject.id, (subject.identity as { pageId?: unknown } | null)?.pageId]));
      for (const observation of observations) {
        if (observation.definition.key !== "page.http") continue;
        const pageId = subjectPage.get(observation.subjectId);
        const page = typeof pageId === "string" ? pageById.get(pageId) : undefined;
        const value = observation.payload as { transactions?: unknown; final_transaction_id?: unknown } | null;
        const references = value?.transactions;
        if (!page || !Array.isArray(references) || references.some((reference) => typeof reference !== "string")) throw new Error("HTTP transaction dependency closure failed");
        const transactionIds = new Set(page.transactions.map(({ id }) => id));
        if (references.some((reference) => !transactionIds.has(reference)) || (value?.final_transaction_id != null && (typeof value.final_transaction_id !== "string" || !transactionIds.has(value.final_transaction_id)))) throw new Error("HTTP transaction dependency closure failed");
      }
      const payload = {
        run: { id: run.id, organizationId, siteId: run.siteId, authorizationRef: run.authorizationId, trigger: run.trigger.toLowerCase(), status: run.status.toLowerCase(), startedAt: run.startedAt?.toISOString(), finishedAt: run.finishedAt.toISOString(), scope: run.scope, limits: run.limits, producerRevision: run.producerVersion, normalizationPolicyVersion: run.normalizationPolicyVersion, extractorVersion: run.extractorVersion, stopReason: run.stopReason, coverage: { discovered: run.discoveredCount, attempted: run.attemptedCount, collected: run.collectedCount, failed: run.failedCount, unattempted: run.unattemptedCount } },
        subjects: subjects.map((subject) => ({ id: subject.id, organizationId: subject.organizationId, crawlRunId: subject.crawlRunId, position: subject.position, kind: subject.kind, identity: subject.identity, members: subject.members.map(({ memberSubjectId, position }) => ({ memberSubjectId, position })) })),
        observationExecutions: observationExecutions.map((execution) => ({
          id: execution.id, organizationId: execution.organizationId, crawlRunId: execution.crawlRunId, parentExecutionId: execution.parentExecutionId, stableKey: execution.stableKey, attempt: execution.attempt, trigger: execution.trigger, configuration: execution.configuration, status: execution.status, startedAt: execution.startedAt.toISOString(), finishedAt: execution.finishedAt?.toISOString() ?? null, error: execution.error,
          collector: { key: execution.collector.key, version: execution.collector.version, executionMode: execution.collector.executionMode },
          rendererSession: execution.rendererSession ? { engine: execution.rendererSession.engine, engineVersion: execution.rendererSession.engineVersion, viewportWidth: execution.rendererSession.viewportWidth, viewportHeight: execution.rendererSession.viewportHeight, deviceScaleFactor: execution.rendererSession.deviceScaleFactor, locale: execution.rendererSession.locale, userAgent: execution.rendererSession.userAgent, timingPolicy: execution.rendererSession.timingPolicy } : null,
        })),
        observations: observations.map((observation) => ({ id: observation.id, organizationId: observation.organizationId, crawlRunId: observation.crawlRunId, subjectId: observation.subjectId, executionId: observation.executionId, sequence: observation.sequence, status: observation.status, payload: observation.payload, reasons: observation.reasons, provenance: observation.provenance, collectedAt: observation.collectedAt.toISOString(), definition: { key: observation.definition.key, version: observation.definition.version }, artifacts: observation.artifacts.map(({ artifactId, position, role }) => ({ artifactId, position, role })) })),
        diagnosticExecutions: diagnosticExecutions.map((execution) => ({ id: execution.id, organizationId: execution.organizationId, crawlRunId: execution.crawlRunId, stableKey: execution.stableKey, attempt: execution.attempt, configuration: execution.configuration, status: execution.status, startedAt: execution.startedAt.toISOString(), finishedAt: execution.finishedAt?.toISOString() ?? null, error: execution.error, rule: { key: execution.rule.key, version: execution.rule.version, policyVersion: execution.rule.policyVersion } })),
        diagnosticResults: diagnosticResults.map((result) => ({ id: result.id, organizationId: result.organizationId, crawlRunId: result.crawlRunId, executionId: result.executionId, subjectId: result.subjectId, sequence: result.sequence, outcome: result.outcome, messageData: result.messageData, limitations: result.limitations, collectedAt: result.collectedAt.toISOString(), inputs: result.inputs.map(({ observationId, position }) => ({ observationId, position })) })),
        artifacts: artifacts.map((artifact) => ({ id: artifact.id, organizationId: artifact.organizationId, crawlRunId: artifact.crawlRunId, sha256: artifact.sha256, byteLength: artifact.byteLength, mediaType: artifact.mediaType, locator: artifact.locator, sensitivity: artifact.sensitivity, retentionClass: artifact.retentionClass, availability: artifact.availability, pinnedAt: artifact.pinnedAt?.toISOString() ?? null, createdAt: artifact.createdAt.toISOString() })),
        evidencePages: evidencePages.map((page) => ({ id: page.id, crawlRunId: page.crawlRunId, position: page.position, depth: page.depth, discoveredUrl: page.discoveredUrl, requestedUrl: page.requestedUrl, normalizedUrl: page.normalizedUrl, finalUrl: page.finalUrl, canonicalUrls: page.canonicalUrls, transactions: page.transactions.map((transaction) => ({ id: transaction.id, pageId: transaction.pageId, position: transaction.position, requestUrl: transaction.requestUrl, responseUrl: transaction.responseUrl, method: transaction.method, statusCode: transaction.statusCode, startedAt: transaction.startedAt.toISOString(), finishedAt: transaction.finishedAt.toISOString(), transferredBytes: safeInteger(transaction.transferredBytes), decodedBytes: safeInteger(transaction.decodedBytes), redirectTo: transaction.redirectTo, headers: transaction.headers.map((header) => ({ id: header.id, position: header.position, name: header.name, values: header.values.map(({ position, value }) => ({ position, value })) })) })) })),
        evidenceLimitations: evidenceLimitations.map(({ id, crawlRunId, pageId, code, message, createdAt }) => ({ id, crawlRunId, pageId, code, message, createdAt: createdAt.toISOString() })),
        evidenceErrors: evidenceErrors.map(({ id, crawlRunId, pageId, observationId, stage, code, message, occurredAt, retryable }) => ({ id, crawlRunId, pageId, observationId, stage, code, message, occurredAt: occurredAt.toISOString(), retryable })),
      };
      const built = buildSnapshotBytes(payload);
      const snapshot = await tx.platformSnapshot.create({ data: { organizationId, crawlRunId: runId, producerRevision: run.producerVersion, sha256: built.sha256, payload: json(JSON.parse(built.bytes.toString("utf8"))) } });
      await tx.crawlRun.update({ where: { id: runId }, data: { frozenAt: snapshot.frozenAt } });
      return snapshot;
  }

  async loadSnapshot(organizationId: string, snapshotId: string) {
    const snapshot = await this.prisma.platformSnapshot.findFirst({ where: { id: snapshotId, organizationId } });
    if (!snapshot) throw new Error("snapshot not found");
    return snapshot;
  }
}

export class ExportProjectionRepository {
  constructor(private readonly prisma: DatabaseClient, private readonly access: { canPublish: boolean } = { canPublish: false }, private readonly artifactStore?: ArtifactStore) {}

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
    if (!this.artifactStore) throw new Error("projection artifact store is required");
    const payload = snapshot.payload as { observations?: Array<{ definition?: { key?: unknown; version?: unknown } }>; diagnosticExecutions?: Array<{ rule?: { key?: unknown; version?: unknown } }> };
    const observationDependencies = new Set((projection.acceptedObservationDefinitions as Array<{ key: string; version: string }>).map(({ key, version }) => `${key}@${version}`));
    const diagnosticDependencies = new Set((projection.acceptedDiagnosticRules as Array<{ key: string; version: string }>).map(({ key, version }) => `${key}@${version}`));
    if ((payload.observations ?? []).some(({ definition }) => !definition || !observationDependencies.has(`${String(definition.key)}@${String(definition.version)}`))
      || (payload.diagnosticExecutions ?? []).some(({ rule }) => !rule || !diagnosticDependencies.has(`${String(rule.key)}@${String(rule.version)}`))) throw new Error("projection dependency is not declared");
    const actualHash = createHash("sha256").update(input.bytes).digest("hex");
    if (actualHash !== input.sha256) throw new Error("projection output checksum mismatch");
    const descriptor = await this.artifactStore.put(input.bytes, { maxBytes: PLATFORM_LIMITS.maxArtifactBytes, allowedMediaTypes: [projection.mediaType], allowedSensitivities: ["internal"], allowedRetentionClasses: ["export"], mediaType: projection.mediaType, sensitivity: "internal", retentionClass: "export" });
    if (descriptor.sha256 !== input.sha256 || descriptor.byteLength !== input.bytes.byteLength) throw new Error("projection artifact persistence mismatch");
    const existing = await this.prisma.projectionExecution.findUnique({ where: { id: input.id } });
    if (existing) {
      if (existing.organizationId !== organizationId || existing.snapshotId !== snapshotId || existing.projectionDefinitionId !== projection.id || existing.stableKey !== input.stableKey || existing.attempt !== input.attempt || existing.outputSha256 !== input.sha256 || !existing.outputArtifactId) throw new Error("immutable projection execution conflict");
      const existingArtifact = await this.prisma.evidenceArtifact.findUnique({ where: { id: existing.outputArtifactId } });
      if (!existingArtifact || existingArtifact.organizationId !== organizationId || existingArtifact.crawlRunId !== snapshot.crawlRunId || existingArtifact.sha256 !== input.sha256 || existingArtifact.byteLength !== descriptor.byteLength || existingArtifact.mediaType !== descriptor.mediaType || existingArtifact.locator !== descriptor.locator || existingArtifact.sensitivity !== descriptor.sensitivity || existingArtifact.retentionClass !== descriptor.retentionClass || existingArtifact.availability !== "available") throw new Error("projection artifact metadata conflict");
      return existing;
    }
    return this.prisma.$transaction(async (tx) => {
      const latest = await tx.projectionExecution.findFirst({ where: { snapshotId, stableKey: input.stableKey }, orderBy: { attempt: "desc" } });
      if (input.attempt !== (latest ? latest.attempt + 1 : 0)) throw new Error("projection attempt sequence invalid");
      const run = await tx.crawlRun.findUnique({ where: { id: snapshot.crawlRunId } });
      if (!run) throw new Error("crawl run not found");
      let artifact = await tx.evidenceArtifact.findUnique({ where: { crawlRunId_sha256: { crawlRunId: snapshot.crawlRunId, sha256: input.sha256 } } });
      if (artifact) {
        if (artifact.organizationId !== organizationId || artifact.byteLength !== descriptor.byteLength || artifact.mediaType !== descriptor.mediaType || artifact.locator !== descriptor.locator || artifact.sensitivity !== descriptor.sensitivity || artifact.retentionClass !== descriptor.retentionClass || artifact.availability !== "available") throw new Error("projection artifact metadata conflict");
      } else {
        artifact = await tx.evidenceArtifact.create({ data: { organizationId, crawlRunId: snapshot.crawlRunId, ...descriptor, pinnedAt: snapshot.frozenAt } });
      }
      return tx.projectionExecution.create({ data: { id: input.id, organizationId, snapshotId, projectionDefinitionId: projection.id, stableKey: input.stableKey, attempt: input.attempt, status: "completed", outputArtifactId: artifact.id, outputSha256: input.sha256 } });
    });
  }
}
