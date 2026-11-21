import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { enqueueCrawl, CrawlOverlapError, type QueueProducer } from "@website-bot-scroll/queue/client";
import { createPrismaClient } from "@website-bot-scroll/db";
import { EvidenceRepository } from "@website-bot-scroll/db/evidence";
import type { DnsResolver } from "@website-bot-scroll/crawler/network/resolve-public";
import type { HttpTransport } from "@website-bot-scroll/crawler/http/fetch-page";
import { computeObservationParityDigest } from "@website-bot-scroll/crawler/evidence/platform-sink";
import { processPage } from "./process-page.js";
import { executeAuthorizedCrawl, finishCrawlRun, processRunCrawl } from "./run-crawl.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

describeDatabase("idempotent crawl orchestration", () => {
  const prisma = createPrismaClient(databaseUrl!);
  const producer: QueueProducer = { add: vi.fn().mockResolvedValue(undefined) };
  let organizationId: string;
  let siteId: string;
  let authorizationRef: string;
  const evidenceControl = () => ({
    authorizationRef,
    limits: { maxPages: 2, maxDepth: 1, maxDurationMs: 10_000, maxResponseBytes: 1_000_000 },
    producerVersion: "a".repeat(40), normalizationPolicyVersion: "normalize/1", extractorVersion: "extract/1",
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    await prisma.crawlError.deleteMany();
    await prisma.crawlRun.deleteMany();
    await prisma.collectorDefinition.deleteMany();
    await prisma.observationDefinition.deleteMany();
    await prisma.site.deleteMany();
    await prisma.organization.deleteMany();
    organizationId = randomUUID();
    siteId = randomUUID();
    authorizationRef = `auth-${randomUUID()}`;
    await prisma.organization.create({ data: { id: organizationId, name: "Owner" } });
    await prisma.site.create({ data: { id: siteId, organizationId, name: "Example", origin: "https://example.com" } });
    await prisma.exportAuthorization.create({ data: {
      id: authorizationRef, organizationId, siteId, description: "Worker test",
      scope: { seed_urls: ["https://example.com/"], allowed_hosts: ["example.com"] },
    } });
  });

  afterAll(async () => prisma.$disconnect());

  it("enqueues one run per idempotency key and prevents site overlap", async () => {
    const input = { organizationId, siteId, ...evidenceControl(), trigger: "MANUAL" as const, idempotencyKey: "manual-1" };
    const first = await enqueueCrawl(input, { prisma, producer });
    const duplicate = await enqueueCrawl(input, { prisma, producer });
    expect(duplicate).toBe(first);
    expect(await prisma.crawlRun.count()).toBe(1);
    expect(producer.add).toHaveBeenCalledTimes(2);
    await expect(enqueueCrawl({ ...input, idempotencyKey: "manual-2" }, { prisma, producer })).rejects.toBeInstanceOf(CrawlOverlapError);
  });

  it("republishes a stored run after a transient queue failure", async () => {
    const recovering: QueueProducer = { add: vi.fn().mockRejectedValueOnce(new Error("redis unavailable")).mockResolvedValueOnce(undefined) };
    const input = { organizationId, siteId, ...evidenceControl(), trigger: "MANUAL" as const, idempotencyKey: "recover-1" };
    await expect(enqueueCrawl(input, { prisma, producer: recovering })).rejects.toThrow("redis unavailable");
    const crawlRunId = await enqueueCrawl(input, { prisma, producer: recovering });
    expect(crawlRunId).toBeTruthy();
    expect(await prisma.crawlRun.count()).toBe(1);
    expect(recovering.add).toHaveBeenCalledTimes(2);
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
    const exchangeAuthorizationRef = `auth-${randomUUID()}`;
    const crawlRunId = randomUUID();
    const scope = { seed_urls: ["https://example.com/"], allowed_hosts: ["example.com"] };
    await prisma.exportAuthorization.create({ data: { id: exchangeAuthorizationRef, organizationId, siteId, description: "Synthetic", scope } });
    await prisma.crawlRun.create({ data: {
      id: crawlRunId, organizationId, siteId, authorizationId: exchangeAuthorizationRef, trigger: "MANUAL", idempotencyKey: "evidence-1",
      scope, limits: { max_pages: 1, max_depth: 0, max_duration_ms: 10_000, max_response_bytes: 1_000_000 },
      producerVersion: "a".repeat(40), normalizationPolicyVersion: "normalize/1", extractorVersion: "extract/1",
    } });
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

    const frozen = await new EvidenceRepository(prisma).loadFrozenRun(organizationId, crawlRunId);
    expect(frozen.coverage).toEqual({ discovered: 1, attempted: 1, collected: 1, failed: 0, unattempted: 0 });
    expect(frozen.pages).toHaveLength(1);
    expect(await prisma.evidenceTransaction.count({ where: { page: { crawlRunId } } })).toBe(1);
    expect(await prisma.evidenceObservation.count({ where: { page: { crawlRunId } } })).toBe(7);
    const legacy = await prisma.evidenceObservation.findMany({ where: { page: { crawlRunId } }, orderBy: { id: "asc" } });
    const platform = await prisma.platformObservation.findMany({ where: { crawlRunId }, orderBy: { sequence: "asc" }, include: { definition: true } });
    expect(await prisma.observationSubject.count({ where: { crawlRunId } })).toBe(1);
    expect(await prisma.observationExecution.findFirstOrThrow({ where: { crawlRunId } })).toMatchObject({ status: "completed", attempt: 0 });
    expect(platform).toHaveLength(7);
    expect(computeObservationParityDigest(legacy.map((row) => ({ method: row.method, status: row.status as never, value: row.value, reasons: row.reasons as string[], provenance: row.provenance as never, id: row.id }))))
      .toBe(computeObservationParityDigest(platform.map((row) => ({ id: row.id, runId: row.crawlRunId, subjectId: row.subjectId, executionId: row.executionId, definitionKey: row.definition.key, definitionVersion: row.definition.version, sequence: row.sequence, status: row.status as never, payload: row.payload, reasons: row.reasons as string[], provenance: row.provenance as never, collectedAt: row.collectedAt.toISOString() }))));
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
      scope: { seed_urls: [pageUrl], allowed_hosts: ["example.com"] },
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
});
