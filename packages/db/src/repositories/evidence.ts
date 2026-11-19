import type {
  EvidenceErrorInput,
  EvidenceLimitationInput,
  HttpTransactionInput,
  ObservationInput,
  PageIdentityInput,
} from "@website-bot-scroll/domain/evidence";
import { Prisma } from "../../generated/prisma/client.js";
import type { DatabaseClient } from "../client.js";

export interface EvidencePageInput extends PageIdentityInput {
  id: string;
  position: number;
}

export interface CoverageInput {
  discovered: number;
  attempted: number;
  collected: number;
  failed: number;
  unattempted?: number;
  stopReason: string;
}

export interface FrozenEvidenceRun {
  id: string;
  organizationId: string;
  siteId: string;
  authorizationId: string;
  trigger: string;
  status: string;
  startedAt: Date;
  finishedAt: Date;
  frozenAt: Date;
  scope: unknown;
  limits: unknown;
  producerVersion: string;
  normalizationPolicyVersion: string;
  extractorVersion: string;
  stopReason: string;
  coverage: { discovered: number; attempted: number; collected: number; failed: number; unattempted?: number };
  pages: unknown[];
  limitations: unknown[];
  errors: unknown[];
}

const normalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(normalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, normalize(item)]));
  }
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  return value;
};

const same = (left: unknown, right: unknown): boolean => JSON.stringify(normalize(left)) === JSON.stringify(normalize(right));
const conflict = (): never => { throw new Error("immutable evidence conflict"); };
const asJson = (value: unknown): Prisma.InputJsonValue => value as Prisma.InputJsonValue;

export class EvidenceRepository {
  constructor(private readonly prisma: DatabaseClient) {}

  private async requireRun(organizationId: string, runId: string) {
    const run = await this.prisma.crawlRun.findFirst({ where: { id: runId, organizationId } });
    if (!run) throw new Error("crawl run not found");
    if (run.frozenAt) throw new Error("crawl run evidence is frozen");
    return run;
  }

  async appendPage(organizationId: string, runId: string, input: EvidencePageInput): Promise<void> {
    await this.requireRun(organizationId, runId);
    const existing = await this.prisma.evidencePage.findUnique({ where: { id: input.id } });
    const comparable = {
      crawlRunId: runId,
      position: input.position,
      discoveredUrl: input.discoveredUrl,
      requestedUrl: input.requestedUrl,
      normalizedUrl: input.normalizedUrl,
      finalUrl: input.finalUrl,
      canonicalUrls: input.canonicalUrls,
    };
    if (existing) {
      if (!same({ ...existing, createdAt: undefined, id: undefined }, comparable)) conflict();
      return;
    }
    await this.prisma.evidencePage.create({ data: { id: input.id, ...comparable } });
  }

  private async requirePage(organizationId: string, runId: string, pageId: string) {
    await this.requireRun(organizationId, runId);
    const page = await this.prisma.evidencePage.findFirst({ where: { id: pageId, crawlRunId: runId } });
    if (!page) throw new Error("evidence page not found");
    return page;
  }

  async appendTransaction(organizationId: string, runId: string, pageId: string, position: number, input: HttpTransactionInput): Promise<void> {
    await this.requirePage(organizationId, runId, pageId);
    const existing = await this.prisma.evidenceTransaction.findUnique({
      where: { id: input.id },
      include: { headers: { orderBy: { position: "asc" }, include: { values: { orderBy: { position: "asc" } } } } },
    });
    const comparable = {
      pageId,
      position,
      requestUrl: input.requestUrl,
      responseUrl: input.responseUrl,
      method: input.method,
      statusCode: input.statusCode,
      startedAt: new Date(input.startedAt),
      finishedAt: new Date(input.finishedAt),
      transferredBytes: BigInt(input.transferredBytes),
      decodedBytes: BigInt(input.decodedBytes),
      redirectTo: input.redirectTo,
      headers: input.headers.map((header, headerPosition) => ({
        position: headerPosition,
        name: header.name,
        values: header.values.map((value, valuePosition) => ({ position: valuePosition, value })),
      })),
    };
    if (existing) {
      const actual = {
        pageId: existing.pageId, position: existing.position, requestUrl: existing.requestUrl,
        responseUrl: existing.responseUrl, method: existing.method, statusCode: existing.statusCode,
        startedAt: existing.startedAt, finishedAt: existing.finishedAt,
        transferredBytes: existing.transferredBytes, decodedBytes: existing.decodedBytes,
        redirectTo: existing.redirectTo,
        headers: existing.headers.map((header) => ({ position: header.position, name: header.name, values: header.values.map(({ position: valuePosition, value }) => ({ position: valuePosition, value })) })),
      };
      if (!same(actual, comparable)) conflict();
      return;
    }
    const { headers, ...transaction } = comparable;
    await this.prisma.evidenceTransaction.create({
      data: {
        id: input.id,
        ...transaction,
        headers: { create: headers.map((header) => ({ ...header, values: { create: header.values } })) },
      },
    });
  }

  async listTransactions(organizationId: string, runId: string, pageId: string) {
    await this.requirePage(organizationId, runId, pageId);
    const rows = await this.prisma.evidenceTransaction.findMany({
      where: { pageId }, orderBy: { position: "asc" },
      include: { headers: { orderBy: { position: "asc" }, include: { values: { orderBy: { position: "asc" } } } } },
    });
    return rows.map((row) => ({
      ...row,
      transferredBytes: Number(row.transferredBytes),
      decodedBytes: Number(row.decodedBytes),
      headers: row.headers.map((header) => ({ ...header, values: header.values.map(({ value }) => value) })),
    }));
  }

  async appendObservation(organizationId: string, runId: string, pageId: string, input: ObservationInput): Promise<void> {
    await this.requirePage(organizationId, runId, pageId);
    const existing = await this.prisma.evidenceObservation.findUnique({ where: { id: input.id } });
    const comparable = {
      pageId,
      method: input.method,
      status: input.status,
      value: input.value,
      reasons: input.reasons,
      provenance: input.provenance,
      fieldOverrides: input.fieldOverrides ?? null,
      rawHash: input.rawHash ?? null,
      normalizedHash: input.normalizedHash ?? null,
    };
    if (existing) {
      const actual = {
        pageId: existing.pageId, method: existing.method, status: existing.status, value: existing.value,
        reasons: existing.reasons, provenance: existing.provenance, fieldOverrides: existing.fieldOverrides,
        rawHash: existing.rawHash, normalizedHash: existing.normalizedHash,
      };
      if (!same(actual, comparable)) conflict();
      return;
    }
    await this.prisma.evidenceObservation.create({
      data: {
        id: input.id,
        ...comparable,
        value: input.value === null ? Prisma.JsonNull : input.value as Prisma.InputJsonValue,
        reasons: input.reasons,
        provenance: asJson(input.provenance),
        fieldOverrides: input.fieldOverrides ? asJson(input.fieldOverrides) : Prisma.JsonNull,
      },
    });
  }

  async appendError(organizationId: string, runId: string, input: EvidenceErrorInput): Promise<void> {
    await this.requireRun(organizationId, runId);
    const existing = await this.prisma.evidenceError.findUnique({ where: { id: input.id } });
    const data = {
      crawlRunId: runId, pageId: input.pageId ?? null, observationId: input.observationId ?? null,
      stage: input.stage, code: input.code, message: input.message, occurredAt: new Date(input.occurredAt), retryable: input.retryable,
    };
    if (existing) { if (!same({ ...existing, id: undefined }, data)) conflict(); return; }
    await this.prisma.evidenceError.create({ data: { id: input.id, ...data } });
  }

  async appendLimitation(organizationId: string, runId: string, input: EvidenceLimitationInput): Promise<void> {
    await this.requireRun(organizationId, runId);
    const existing = await this.prisma.evidenceLimitation.findUnique({ where: { id: input.id } });
    const data = { crawlRunId: runId, pageId: input.pageId ?? null, code: input.code, message: input.message };
    if (existing) { if (!same({ ...existing, id: undefined, createdAt: undefined }, data)) conflict(); return; }
    await this.prisma.evidenceLimitation.create({ data: { id: input.id, ...data } });
  }

  async updateCoverage(organizationId: string, runId: string, coverage: CoverageInput): Promise<void> {
    await this.requireRun(organizationId, runId);
    await this.prisma.crawlRun.update({
      where: { id: runId },
      data: {
        discoveredCount: coverage.discovered, attemptedCount: coverage.attempted,
        collectedCount: coverage.collected, failedCount: coverage.failed,
        ...(coverage.unattempted === undefined ? {} : { unattemptedCount: coverage.unattempted }),
        stopReason: coverage.stopReason,
      },
    });
  }

  async freezeRun(organizationId: string, runId: string): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      const run = await transaction.crawlRun.findFirst({
        where: { id: runId, organizationId }, include: { authorization: true, _count: { select: { evidencePages: true } } },
      });
      if (!run) throw new Error("crawl run not found");
      if (run.frozenAt) return;
      if (!new Set(["COMPLETED", "PARTIAL", "FAILED", "CANCELLED"]).has(run.status) || !run.finishedAt) throw new Error("crawl run must be terminal before freeze");
      if (run.trigger !== "MANUAL") throw new Error("only manual crawl runs are export eligible");
      if (!run.authorization || run.authorization.revokedAt || !same(run.scope, run.authorization.scope)) throw new Error("authorization scope mismatch");
      if (run.collectedCount + run.failedCount !== run.attemptedCount || run.attemptedCount > run.discoveredCount || run._count.evidencePages !== run.collectedCount) throw new Error("coverage is inconsistent");
      if (run.unattemptedCount !== null && run.unattemptedCount !== run.discoveredCount - run.attemptedCount) throw new Error("coverage is inconsistent");
      await transaction.crawlRun.update({ where: { id: run.id }, data: { frozenAt: new Date() } });
    });
  }

  async loadFrozenRun(organizationId: string, runId: string): Promise<FrozenEvidenceRun> {
    const run = await this.prisma.crawlRun.findFirst({
      where: { id: runId, organizationId, frozenAt: { not: null } },
      include: {
        evidencePages: {
          orderBy: { position: "asc" },
          include: {
            transactions: { orderBy: { position: "asc" }, include: { headers: { orderBy: { position: "asc" }, include: { values: { orderBy: { position: "asc" } } } } } },
            observations: { orderBy: { id: "asc" } },
          },
        },
        evidenceLimitations: { orderBy: { id: "asc" } },
        evidenceErrors: { orderBy: { id: "asc" } },
      },
    });
    if (!run || !run.authorizationId || !run.startedAt || !run.finishedAt || !run.frozenAt || !run.scope || !run.limits || !run.producerVersion || !run.normalizationPolicyVersion || !run.extractorVersion || !run.stopReason) {
      throw new Error("frozen crawl run not found");
    }
    return {
      id: run.id, organizationId: run.organizationId, siteId: run.siteId, authorizationId: run.authorizationId,
      trigger: run.trigger, status: run.status, startedAt: run.startedAt, finishedAt: run.finishedAt, frozenAt: run.frozenAt,
      scope: run.scope, limits: run.limits, producerVersion: run.producerVersion,
      normalizationPolicyVersion: run.normalizationPolicyVersion, extractorVersion: run.extractorVersion,
      stopReason: run.stopReason,
      coverage: {
        discovered: run.discoveredCount, attempted: run.attemptedCount, collected: run.collectedCount, failed: run.failedCount,
        ...(run.unattemptedCount === null ? {} : { unattempted: run.unattemptedCount }),
      },
      pages: run.evidencePages,
      limitations: run.evidenceLimitations,
      errors: run.evidenceErrors,
    };
  }
}
