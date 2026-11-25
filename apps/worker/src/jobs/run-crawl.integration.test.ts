import { randomUUID } from "node:crypto";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { enqueueCrawl, recoverPendingCrawls, CrawlOverlapError, type QueueProducer } from "@website-bot-scroll/queue/client";
import { createPrismaClient } from "@website-bot-scroll/db";
import { EvidenceRepository } from "@website-bot-scroll/db/evidence";
import { FilesystemArtifactStore } from "@website-bot-scroll/db/artifacts";
import { ExportProjectionRepository } from "@website-bot-scroll/db/export-projections";
import { exportFrozenSnapshot } from "@website-bot-scroll/evidence-producer/export-run";
import { verifyExchangePair } from "@website-bot-scroll/evidence-producer/verify-exchange";
import type { DnsResolver } from "@website-bot-scroll/crawler/network/resolve-public";
import type { HttpTransport } from "@website-bot-scroll/crawler/http/fetch-page";
import { computeObservationParityDigest } from "@website-bot-scroll/crawler/evidence/platform-sink";
import { PLATFORM_OBSERVATION_DEFINITIONS } from "@website-bot-scroll/crawler/evidence/definitions";
import { processPage } from "./process-page.js";
import { executeAuthorizedCrawl, finishCrawlRun, processRunCrawl } from "./run-crawl.js";
import { createCrawlWorker } from "../crawl-worker.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

describeDatabase("idempotent crawl orchestration", () => {
  const prisma = createPrismaClient(databaseUrl!);
  const producer: QueueProducer = { add: vi.fn().mockResolvedValue(undefined) };
  let organizationId: string;
  let userId: string;
  let siteId: string;
  let authorizationRef: string;
  const evidenceControl = () => ({
    authorizationRef,
    limits: { maxPages: 2, maxDepth: 1, maxDurationMs: 10_000, maxResponseBytes: 1_000_000 },
    producerVersion: "a".repeat(40), normalizationPolicyVersion: "normalize/1", extractorVersion: "extract/1",
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "crawl_runs", "export_projection_definitions", "diagnostic_rule_definitions", "collector_definitions", "observation_definitions" CASCADE');
    await prisma.crawlError.deleteMany();
    await prisma.crawlRun.deleteMany();
    await prisma.collectorDefinition.deleteMany();
    await prisma.observationDefinition.deleteMany();
    await prisma.site.deleteMany();
    await prisma.organization.deleteMany();
    organizationId = randomUUID();
    userId = randomUUID();
    siteId = randomUUID();
    authorizationRef = `auth-${randomUUID()}`;
    await prisma.organization.create({ data: { id: organizationId, name: "Owner" } });
    await prisma.user.create({ data: { id: userId, organizationId, email: `${userId}@example.test`, passwordHash: "test" } });
    await prisma.site.create({ data: { id: siteId, organizationId, name: "Example", origin: "https://example.com" } });
    await prisma.exportAuthorization.create({ data: {
      id: authorizationRef, organizationId, siteId, description: "Owner-declared crawl authorization",
      scope: { seed_urls: ["https://example.com/"], allowed_hosts: ["example.com"], include_patterns: [], exclude_patterns: [] },
    } });
  });

  afterAll(async () => prisma.$disconnect());

  it("enqueues one run per idempotency key and prevents site overlap", async () => {
    const input = { organizationId, siteId, requestedByUserId: userId, ...evidenceControl(), trigger: "MANUAL" as const, idempotencyKey: "manual-1" };
    const first = await enqueueCrawl(input, { prisma, producer });
    const duplicate = await enqueueCrawl(input, { prisma, producer });
    expect(duplicate).toBe(first);
    expect(await prisma.crawlRun.count()).toBe(1);
    expect(await prisma.auditEvent.findFirst({ where: { targetId: first } })).toMatchObject({ organizationId, userId, siteId, action: "site.crawl_requested" });
    expect(producer.add).toHaveBeenCalledTimes(2);
    await expect(enqueueCrawl({ ...input, idempotencyKey: "manual-2" }, { prisma, producer })).rejects.toBeInstanceOf(CrawlOverlapError);
  });

  it("removes a just-created pending run after queue publication fails so a retry can start", async () => {
    const recovering: QueueProducer = { add: vi.fn().mockRejectedValueOnce(new Error("redis unavailable")).mockResolvedValueOnce(undefined) };
    const input = { organizationId, siteId, ...evidenceControl(), trigger: "MANUAL" as const, idempotencyKey: "recover-1" };
    await expect(enqueueCrawl(input, { prisma, producer: recovering })).rejects.toThrow("redis unavailable");
    expect(await prisma.crawlRun.count()).toBe(0);
    const crawlRunId = await enqueueCrawl(input, { prisma, producer: recovering });
    expect(crawlRunId).toBeTruthy();
    expect(await prisma.crawlRun.count()).toBe(1);
    expect(recovering.add).toHaveBeenCalledTimes(2);
  });

  it("keeps a previously stored idempotent run replayable when republication fails", async () => {
    const input = { organizationId, siteId, ...evidenceControl(), trigger: "MANUAL" as const, idempotencyKey: "stored-1" };
    const crawlRunId = await enqueueCrawl(input, { prisma, producer });
    const recovering: QueueProducer = { add: vi.fn().mockRejectedValueOnce(new Error("redis unavailable")).mockResolvedValueOnce(undefined) };
    await expect(enqueueCrawl(input, { prisma, producer: recovering })).rejects.toThrow("redis unavailable");
    expect((await prisma.crawlRun.findUniqueOrThrow({ where: { id: crawlRunId } })).activeSiteKey).toBe(siteId);
    await expect(enqueueCrawl(input, { prisma, producer: recovering })).resolves.toBe(crawlRunId);
  });

  it("publishes a pending run from PostgreSQL after the original publisher disappears", async () => {
    const input = { organizationId, siteId, ...evidenceControl(), trigger: "MANUAL" as const, idempotencyKey: "stranded" };
    const crawlRunId = await enqueueCrawl(input, { prisma, producer });
    const jobs: Array<{ id: string; runId: string }> = [];
    const recoveryProducer: QueueProducer = { add: async (_name, data, options) => { jobs.push({ id: options.jobId, runId: data.crawlRunId }); } };
    await prisma.crawlRun.update({ where: { id: crawlRunId }, data: { createdAt: new Date(0) } });
    await recoverPendingCrawls({ prisma, producer: recoveryProducer });
    expect(jobs).toEqual([{ id: crawlRunId, runId: crawlRunId }]);
  });

  const simulateHttp = (response: (url: URL) => Promise<{ status: number; html: string }>): HttpTransport => ({
    request: async ({ url }) => {
      const { status, html } = url.pathname === "/robots.txt" ? { status: 404, html: "" } : await response(url);
      return { status, headers: { "content-type": "text/html" }, body: { async *[Symbol.asyncIterator]() { yield new TextEncoder().encode(html); } } };
    },
  });
  const publicResolver: DnsResolver = { resolve: async () => ["93.184.216.34"] };
  const createJob = async (idempotencyKey: string) => {
    const input = { organizationId, siteId, ...evidenceControl(), trigger: "MANUAL" as const, idempotencyKey };
    return { ...input, crawlRunId: await enqueueCrawl(input, { prisma, producer }) };
  };

  it.skipIf(!process.env.TEST_REDIS_URL)("recovers a stranded run through a real worker and Redis", async () => {
    const job = await createJob("real-redis-recovery");
    await prisma.crawlRun.update({ where: { id: job.crawlRunId }, data: { createdAt: new Date(0) } });
    const worker = createCrawlWorker({
      DATABASE_URL: databaseUrl!, REDIS_URL: process.env.TEST_REDIS_URL!, AUTH_SECRET: "a".repeat(32),
      APP_BASE_URL: "http://localhost:3000", CRAWLER_CONTACT_URL: "https://example.com/contact",
      BOOTSTRAP_OWNER_EMAIL: "owner@example.com", BOOTSTRAP_OWNER_PASSWORD: "correct-horse-battery-staple",
    }, { prisma, resolver: publicResolver, transport: simulateHttp(async () => ({ status: 200, html: "<html></html>" })) });
    try {
      await vi.waitFor(async () => {
        expect(await prisma.crawlRun.findUniqueOrThrow({ where: { id: job.crawlRunId } })).toMatchObject({
          status: "COMPLETED", attemptCount: 1, activeSiteKey: null, frozenAt: expect.any(Date),
        });
      }, { timeout: 10_000, interval: 100 });
    } finally {
      await worker.close();
    }
  }, 15_000);

  it("commits discovered children with the seed evidence before fetching the next page", async () => {
    const job = await createJob("atomic-frontier");
    const observed: unknown[] = [];
    const transport = simulateHttp(async (url) => {
      if (url.pathname === "/") return { status: 200, html: '<html><a href="/child">Child</a></html>' };
      observed.push(await prisma.crawlRun.findUniqueOrThrow({
        where: { id: job.crawlRunId }, select: { frontier: true, processedUrls: true, collectedCount: true },
      }));
      return { status: 200, html: "<html></html>" };
    });
    await executeAuthorizedCrawl(job, { prisma, evidence: new EvidenceRepository(prisma), resolver: publicResolver, transport });
    expect(observed).toEqual([{
      frontier: { pending: [{ url: "https://example.com/child", depth: 1 }], skipped: [], robotsLimited: false },
      processedUrls: ["https://example.com/"], collectedCount: 1,
    }]);
  });

  it("resumes the saved frontier after the seed was processed", async () => {
    const job = await createJob("resume-frontier");
    await prisma.crawlRun.update({ where: { id: job.crawlRunId }, data: {
      status: "RUNNING", startedAt: new Date(), processedUrls: ["https://example.com/"],
      frontier: { pending: [{ url: "https://example.com/child", depth: 1 }], robotsLimited: false },
      discoveredCount: 2, attemptedCount: 1, failedCount: 1, unattemptedCount: 1,
    } });
    const transport = simulateHttp(async (url) => ({ status: url.pathname === "/child" ? 200 : 500, html: "<html></html>" }));
    const result = await executeAuthorizedCrawl(job, { prisma, evidence: new EvidenceRepository(prisma), resolver: publicResolver, transport });
    expect(result).toMatchObject({ status: "PARTIAL", coverage: { discovered: 2, attempted: 2, collected: 1, failed: 1, unattempted: 0 } });
  });

  it("does not publish terminal success if saving the snapshot fails", async () => {
    const job = await createJob("freeze-rollback");
    const transport = simulateHttp(async () => {
      await prisma.exportAuthorization.update({ where: { id: authorizationRef }, data: { revokedAt: new Date() } });
      return { status: 200, html: "<html></html>" };
    });
    await expect(executeAuthorizedCrawl(job, { prisma, evidence: new EvidenceRepository(prisma), resolver: publicResolver, transport })).rejects.toThrow("authorization scope mismatch");
    expect(await prisma.crawlRun.findUniqueOrThrow({ where: { id: job.crawlRunId } })).toMatchObject({ status: "RUNNING", activeSiteKey: siteId, frozenAt: null });
    expect(await prisma.platformMigrationState.findUnique({ where: { crawlRunId: job.crawlRunId } })).toBeNull();
  });

  it.each([404, 429])("counts HTTP %s as an unavailable page without extracting its HTML", async (status) => {
    const job = await createJob(`response-${status}`);
    const transport = simulateHttp(async () => ({ status, html: '<html><a href="/error-link">Error</a></html>' }));
    const result = await executeAuthorizedCrawl(job, { prisma, evidence: new EvidenceRepository(prisma), resolver: publicResolver, transport });
    expect(result).toMatchObject({ status: "PARTIAL", coverage: { discovered: 1, attempted: 1, collected: 0, failed: 1 } });
    expect(await prisma.evidenceError.findFirst({ where: { crawlRunId: job.crawlRunId } })).toMatchObject({ code: `http_${status}` });
    expect(await prisma.evidencePage.count({ where: { crawlRunId: job.crawlRunId } })).toBe(0);
    expect(await prisma.platformSnapshot.count({ where: { crawlRunId: job.crawlRunId } })).toBe(1);
  });

  it("resumes duplicate worker delivery and checkpoints a page once", async () => {
    const crawlRunId = await enqueueCrawl({ organizationId, siteId, ...evidenceControl(), trigger: "MANUAL", idempotencyKey: "retry-1" }, { prisma, producer });
    const job = { organizationId, siteId, crawlRunId, ...evidenceControl(), trigger: "MANUAL" as const, idempotencyKey: "retry-1" };
    expect((await processRunCrawl(job, prisma)).resumed).toBe(false);
    expect((await processRunCrawl(job, prisma)).resumed).toBe(true);
    const page = { organizationId, siteId, crawlRunId, url: "https://example.com/a", depth: 1 };
    expect((await processPage(page, prisma)).duplicate).toBe(false);
    expect((await processPage(page, prisma)).duplicate).toBe(true);
    const stored = await prisma.crawlRun.findUniqueOrThrow({ where: { id: crawlRunId } });
    expect(stored.status).toBe("RUNNING");
    expect(stored.processedUrls).toEqual(["https://example.com/a"]);
  });

  it("releases the per-site lock only in a terminal state", async () => {
    const input = { organizationId, siteId, ...evidenceControl(), trigger: "MANUAL" as const, idempotencyKey: "first" };
    const crawlRunId = await enqueueCrawl(input, { prisma, producer });
    await finishCrawlRun(crawlRunId, "COMPLETED", prisma);
    const next = await enqueueCrawl({ ...input, idempotencyKey: "second" }, { prisma, producer });
    expect(next).not.toBe(crawlRunId);
    expect((await prisma.crawlRun.findUniqueOrThrow({ where: { id: crawlRunId } })).activeSiteKey).toBeNull();
  });

  it("collects, extracts, persists, and freezes an authorized HTML crawl", async () => {
    const exchangeAuthorizationRef = authorizationRef;
    const crawlRunId = randomUUID();
    const scope = { seed_urls: ["https://example.com/"], allowed_hosts: ["example.com"], include_patterns: [], exclude_patterns: [] };
    await prisma.crawlRun.create({ data: {
      id: crawlRunId, organizationId, siteId, authorizationId: exchangeAuthorizationRef, trigger: "MANUAL", idempotencyKey: "evidence-1",
      scope, limits: { max_pages: 1, max_depth: 0, max_duration_ms: 10_000, max_response_bytes: 1_000_000 },
      producerVersion: "a".repeat(40), normalizationPolicyVersion: "normalize/1", extractorVersion: "extract/1",
    } });
    await prisma.observationDefinition.createMany({ data: ["http", "metadata", "headings", "structured_data", "content", "links", "rendering"].map((method) => ({
      key: `page.${method}`, version: "1.0.0", schema: {}, schemaSha256: "0".repeat(64), scopes: ["page"], statuses: ["observed"], sensitivity: "public", retentionClass: "evidence",
    })) });
    const bytes = new TextEncoder().encode('<html lang="fa"><head><title>نمونه</title></head><body><h1>عنوان</h1></body></html>');
    const resolver: DnsResolver = { resolve: vi.fn().mockResolvedValue(["93.184.216.34"]) };
    const transport: HttpTransport = { request: vi.fn().mockResolvedValue({
      status: 200, headers: { "content-type": ["text/html"], link: ["</fa>; rel=alternate", "</en>; rel=alternate"] },
      body: { async *[Symbol.asyncIterator]() { yield bytes; } }, compressedBytes: bytes.byteLength,
    }) };
    const job = {
      organizationId, siteId, crawlRunId, trigger: "MANUAL" as const, idempotencyKey: "evidence-1", authorizationRef: exchangeAuthorizationRef,
      limits: { maxPages: 1, maxDepth: 0, maxDurationMs: 10_000, maxResponseBytes: 1_000_000 },
      producerVersion: "a".repeat(40), normalizationPolicyVersion: "normalize/1", extractorVersion: "extract/1",
    };

    await executeAuthorizedCrawl(job, { prisma, evidence: new EvidenceRepository(prisma), resolver, transport });

    const run = await prisma.crawlRun.findUniqueOrThrow({ where: { id: crawlRunId } });
    expect(run.frozenAt).not.toBeNull();
    expect(await prisma.platformSnapshot.findUnique({ where: { crawlRunId } })).not.toBeNull();
    expect(await prisma.platformMigrationState.findUnique({ where: { crawlRunId } })).toMatchObject({ readAuthority: "generalized" });
    expect(await prisma.evidenceTransaction.count({ where: { page: { crawlRunId } } })).toBe(1);
    expect(await prisma.evidenceObservation.count({ where: { page: { crawlRunId } } })).toBe(7);
    const legacy = await prisma.evidenceObservation.findMany({ where: { page: { crawlRunId } }, orderBy: { id: "asc" } });
    const platform = await prisma.platformObservation.findMany({ where: { crawlRunId }, orderBy: { sequence: "asc" }, include: { definition: true } });
    expect(await prisma.observationSubject.count({ where: { crawlRunId } })).toBe(1);
    expect(await prisma.observationExecution.findFirstOrThrow({ where: { crawlRunId } })).toMatchObject({ status: "completed", attempt: 0 });
    expect(platform).toHaveLength(7);
    expect(computeObservationParityDigest(legacy.map((row) => ({ method: row.method, status: row.status as never, value: row.value, reasons: row.reasons as string[], provenance: row.provenance as never, id: row.id }))))
      .toBe(computeObservationParityDigest(platform.map((row) => ({ id: row.id, runId: row.crawlRunId, subjectId: row.subjectId, executionId: row.executionId, definitionKey: row.definition.key, definitionVersion: row.definition.version, sequence: row.sequence, status: row.status as never, payload: row.payload, reasons: row.reasons as string[], provenance: row.provenance as never, collectedAt: row.collectedAt.toISOString() }))));
    const snapshot = await prisma.platformSnapshot.findUniqueOrThrow({ where: { crawlRunId } });
    const exchangeRoot = await mkdtemp(join(tmpdir(), "wbs-worker-exchange-"));
    const artifactStore = new FilesystemArtifactStore(await mkdtemp(join(tmpdir(), "wbs-worker-artifacts-")));
    const projections = new ExportProjectionRepository(prisma, { canPublish: true }, artifactStore);
    await projections.publishProjection({ key: "seo-crawl-evidence", version: "0.1.0", format: "seo-crawl-evidence/0.1.0", mediaType: "application/json", acceptedObservationDefinitions: PLATFORM_OBSERVATION_DEFINITIONS.map(({ key, version }) => ({ key, version })), acceptedDiagnosticRules: [] });
    const receipt = await exportFrozenSnapshot({ snapshot, destinationDirectory: exchangeRoot, evidenceFilename: `${crawlRunId}.evidence.json`, manifestFilename: `${crawlRunId}.manifest.json`, producerCommit: job.producerVersion });
    const evidenceBytes = await readFile(receipt.evidencePath);
    const projection = await projections.runProjection(organizationId, snapshot.id, { id: `projection-${crawlRunId}`, key: "seo-crawl-evidence", version: "0.1.0", stableKey: "canonical", attempt: 0, bytes: evidenceBytes, sha256: receipt.evidenceSha256 });
    await expect(verifyExchangePair({ evidencePath: receipt.evidencePath, manifestPath: receipt.manifestPath, expectedAuthorizationRef: exchangeAuthorizationRef })).resolves.toMatchObject({ runId: crawlRunId });
    expect(projection.outputArtifactId).toBeTruthy();
  });

  it("resumes after persisted transaction evidence without refetching or duplicating it", async () => {
    const crawlRunId = randomUUID();
    const pageUrl = "https://example.com/";
    const pageId = `page-${"b".repeat(64)}`;
    const job = {
      organizationId, siteId, crawlRunId, trigger: "MANUAL" as const, idempotencyKey: "interrupted-1", ...evidenceControl(),
    };
    await prisma.crawlRun.create({ data: {
      id: crawlRunId, organizationId, siteId, authorizationId: authorizationRef, trigger: "MANUAL", idempotencyKey: job.idempotencyKey,
      status: "RUNNING", startedAt: new Date("2026-11-19T00:00:00.000Z"), processedUrls: [pageUrl],
      scope: { seed_urls: [pageUrl], allowed_hosts: ["example.com"], include_patterns: [], exclude_patterns: [] },
      limits: { max_pages: 2, max_depth: 1, max_duration_ms: 10_000, max_response_bytes: 1_000_000 },
      producerVersion: job.producerVersion, normalizationPolicyVersion: job.normalizationPolicyVersion, extractorVersion: job.extractorVersion,
      discoveredCount: 1, attemptedCount: 1, collectedCount: 1, failedCount: 0, unattemptedCount: 0,
    } });
    const repository = new EvidenceRepository(prisma);
    await repository.appendPage(organizationId, crawlRunId, {
      id: pageId, position: 0, depth: 0, discoveredUrl: pageUrl, requestedUrl: pageUrl, normalizedUrl: pageUrl, finalUrl: pageUrl, canonicalUrls: [],
    });
    await repository.appendTransaction(organizationId, crawlRunId, pageId, 0, {
      id: "tx-persisted", requestUrl: pageUrl, responseUrl: pageUrl, method: "GET", statusCode: 200,
      startedAt: "2026-11-19T00:00:00.000Z", finishedAt: "2026-11-19T00:00:00.100Z",
      headers: [{ name: "content-type", values: ["text/html"] }], transferredBytes: 10, decodedBytes: 10, redirectTo: null,
    });
    const transport: HttpTransport = { request: vi.fn() };
    const resolver: DnsResolver = { resolve: vi.fn() };

    await executeAuthorizedCrawl(job, { prisma, evidence: repository, resolver, transport });

    expect(transport.request).not.toHaveBeenCalled();
    expect(await prisma.evidenceTransaction.count({ where: { page: { crawlRunId } } })).toBe(1);
    expect((await repository.loadFrozenRun(organizationId, crawlRunId)).coverage.collected).toBe(1);
  });

  it("rejects a revoked authorization before network collection", async () => {
    const crawlRunId = randomUUID();
    const job = { organizationId, siteId, crawlRunId, trigger: "MANUAL" as const, idempotencyKey: "revoked-1", ...evidenceControl() };
    await prisma.crawlRun.create({ data: { id: crawlRunId, organizationId, siteId, authorizationId: authorizationRef, trigger: "MANUAL", idempotencyKey: job.idempotencyKey, activeSiteKey: siteId, scope: { seed_urls: ["https://example.com/"], allowed_hosts: ["example.com"], include_patterns: [], exclude_patterns: [] }, limits: { max_pages: 1, max_depth: 0, max_duration_ms: 10_000, max_response_bytes: 5_242_880 }, producerVersion: job.producerVersion, normalizationPolicyVersion: job.normalizationPolicyVersion, extractorVersion: job.extractorVersion } });
    await prisma.exportAuthorization.update({ where: { id: authorizationRef }, data: { revokedAt: new Date() } });
    const transport: HttpTransport = { request: vi.fn() };
    await expect(executeAuthorizedCrawl(job, { prisma, evidence: new EvidenceRepository(prisma), resolver: { resolve: vi.fn() }, transport })).rejects.toThrow("active owner declaration");
    expect(transport.request).not.toHaveBeenCalled();
  });

  it("honors robots.txt before collecting an authorized page", async () => {
    const crawlRunId = randomUUID();
    const job = { organizationId, siteId, crawlRunId, trigger: "MANUAL" as const, idempotencyKey: "robots-1", ...evidenceControl() };
    await prisma.crawlRun.create({ data: { id: crawlRunId, organizationId, siteId, authorizationId: authorizationRef, trigger: "MANUAL", idempotencyKey: job.idempotencyKey, activeSiteKey: siteId, scope: { seed_urls: ["https://example.com/"], allowed_hosts: ["example.com"], include_patterns: [], exclude_patterns: [] }, limits: { max_pages: 1, max_depth: 0, max_duration_ms: 10_000, max_response_bytes: 5_242_880 }, producerVersion: job.producerVersion, normalizationPolicyVersion: job.normalizationPolicyVersion, extractorVersion: job.extractorVersion } });
    const body = new TextEncoder().encode("User-agent: *\nDisallow: /");
    const transport: HttpTransport = { request: vi.fn().mockResolvedValue({ status: 200, headers: { "content-type": "text/plain" }, body: { async *[Symbol.asyncIterator]() { yield body; } } }) };
    const result = await executeAuthorizedCrawl(job, { prisma, evidence: new EvidenceRepository(prisma), resolver: { resolve: vi.fn().mockResolvedValue(["93.184.216.34"]) }, transport });
    expect(result.status).toBe("PARTIAL");
    expect(transport.request).toHaveBeenCalledTimes(1);
    expect(await prisma.evidenceLimitation.findFirst({ where: { crawlRunId, code: "robots_disallowed" } })).not.toBeNull();
  });

  it("stops a stalled page body at the run duration limit", async () => {
    const crawlRunId = randomUUID();
    const job = { organizationId, siteId, crawlRunId, trigger: "MANUAL" as const, idempotencyKey: "duration-1", ...evidenceControl(), limits: { ...evidenceControl().limits, maxDurationMs: 30 } };
    await prisma.crawlRun.create({ data: { id: crawlRunId, organizationId, siteId, authorizationId: authorizationRef, trigger: "MANUAL", idempotencyKey: job.idempotencyKey, activeSiteKey: siteId, scope: { seed_urls: ["https://example.com/"], allowed_hosts: ["example.com"], include_patterns: [], exclude_patterns: [] }, limits: { max_pages: 1, max_depth: 0, max_duration_ms: 30, max_response_bytes: 5_242_880 }, producerVersion: job.producerVersion, normalizationPolicyVersion: job.normalizationPolicyVersion, extractorVersion: job.extractorVersion } });
    const robots = new TextEncoder().encode("User-agent: *\nAllow: /");
    const transport: HttpTransport = { request: vi.fn()
      .mockResolvedValueOnce({ status: 200, headers: { "content-type": "text/plain" }, body: { async *[Symbol.asyncIterator]() { yield robots; } } })
      .mockResolvedValueOnce({ status: 200, headers: { "content-type": "text/html" }, body: { [Symbol.asyncIterator]() { return { next: () => new Promise<IteratorResult<Uint8Array>>(() => undefined) }; } } }) };
    const result = await executeAuthorizedCrawl(job, { prisma, evidence: new EvidenceRepository(prisma), resolver: { resolve: vi.fn().mockResolvedValue(["93.184.216.34"]) }, transport });
    expect(result.status).toBe("PARTIAL");
    expect((await prisma.crawlRun.findUniqueOrThrow({ where: { id: crawlRunId } })).stopReason).toBe("duration_limit_reached");
  });
});
