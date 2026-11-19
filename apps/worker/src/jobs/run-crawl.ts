import type { DatabaseClient } from "@website-bot-scroll/db";
import { EvidenceRepository } from "@website-bot-scroll/db/evidence";
import { createEvidenceId, defineObservation } from "@website-bot-scroll/domain/evidence";
import { fetchPage, type HttpTransport } from "@website-bot-scroll/crawler/http/fetch-page";
import type { DnsResolver } from "@website-bot-scroll/crawler/network/resolve-public";
import { extractHtmlObservations } from "@website-bot-scroll/crawler/extract/html-observations";
import { normalizeUrlIdentity } from "@website-bot-scroll/crawler/url/normalize";
import type { CrawlEvidenceEvent, EvidenceSink } from "@website-bot-scroll/crawler/evidence/events";
import { runCrawlJobSchema, terminalCrawlStatusSchema, type RunCrawlJob, type TerminalCrawlStatus } from "@website-bot-scroll/queue/contracts";

export interface CrawlDependencies {
  prisma: DatabaseClient;
  evidence: EvidenceRepository;
  resolver: DnsResolver;
  transport: HttpTransport;
  now?: () => Date;
}

export interface CrawlExecutionResult {
  crawlRunId: string;
  status: "COMPLETED" | "PARTIAL";
  coverage: { discovered: number; attempted: number; collected: number; failed: number; unattempted: number };
}

export async function processRunCrawl(rawJob: unknown, prisma: DatabaseClient): Promise<{ crawlRunId: string; resumed: boolean }> {
  const job = runCrawlJobSchema.parse(rawJob);
  const run = await prisma.crawlRun.findFirstOrThrow({ where: { id: job.crawlRunId, siteId: job.siteId, organizationId: job.organizationId, idempotencyKey: job.idempotencyKey } });
  const resumed = run.status !== "PENDING";
  if (run.status === "PENDING" || run.status === "RUNNING") {
    await prisma.crawlRun.update({
      where: { id: run.id },
      data: {
        status: "RUNNING",
        attemptCount: { increment: 1 },
        ...(run.startedAt ? {} : { startedAt: new Date() }),
      },
    });
  }
  return { crawlRunId: run.id, resumed };
}

export async function finishCrawlRun(crawlRunId: string, rawStatus: TerminalCrawlStatus, prisma: DatabaseClient): Promise<void> {
  const status = terminalCrawlStatusSchema.parse(rawStatus);
  await prisma.crawlRun.update({
    where: { id: crawlRunId },
    data: { status, activeSiteKey: null, finishedAt: new Date() },
  });
}

export async function executeAuthorizedCrawl(rawJob: RunCrawlJob, dependencies: CrawlDependencies): Promise<CrawlExecutionResult> {
  const job = runCrawlJobSchema.parse(rawJob);
  const stored = await dependencies.prisma.crawlRun.findFirstOrThrow({
    where: { id: job.crawlRunId, organizationId: job.organizationId, siteId: job.siteId, authorizationId: job.authorizationRef },
  });
  if (stored.frozenAt) {
    return {
      crawlRunId: stored.id,
      status: stored.status === "PARTIAL" ? "PARTIAL" : "COMPLETED",
      coverage: { discovered: stored.discoveredCount, attempted: stored.attemptedCount, collected: stored.collectedCount, failed: stored.failedCount, unattempted: stored.unattemptedCount ?? 0 },
    };
  }
  await processRunCrawl(job, dependencies.prisma);
  const scope = stored.scope as { seed_urls?: unknown; allowed_hosts?: unknown } | null;
  const seedUrls = Array.isArray(scope?.seed_urls) ? scope.seed_urls.filter((value): value is string => typeof value === "string") : [];
  const allowedHosts = new Set(Array.isArray(scope?.allowed_hosts) ? scope.allowed_hosts.filter((value): value is string => typeof value === "string") : []);
  if (seedUrls.length === 0 || allowedHosts.size === 0) throw new Error("authorized crawl scope is empty");

  const queue = seedUrls.map((url) => ({ url, depth: 0 }));
  const discovered = new Set(seedUrls);
  const processed = new Set(Array.isArray(stored.processedUrls) ? stored.processedUrls.filter((value): value is string => typeof value === "string") : []);
  let attempted = stored.attemptedCount;
  let collected = stored.collectedCount;
  let failed = stored.failedCount;
  let partial = false;
  const now = dependencies.now ?? (() => new Date());

  while (queue.length > 0 && attempted < job.limits.maxPages) {
    const next = queue.shift()!;
    if (processed.has(next.url)) continue;
    processed.add(next.url);
    attempted += 1;
    const identity = normalizeUrlIdentity(next.url, { removeTrackingParameters: true }, job.normalizationPolicyVersion);
    const pageId = createEvidenceId("page", [job.crawlRunId, identity.normalizedUrl]);
    const buffered: CrawlEvidenceEvent[] = [];
    const evidenceSink: EvidenceSink = { record: async (event) => { buffered.push(event); } };
    try {
      const result = await fetchPage({
        url: new URL(identity.normalizedUrl), resolver: dependencies.resolver, transport: dependencies.transport,
        maxOtherBytes: job.limits.maxResponseBytes, maxCompressedBytes: job.limits.maxResponseBytes,
        maxDecompressedBytes: job.limits.maxResponseBytes, evidenceSink,
        evidenceContext: { runId: job.crawlRunId, pageId }, now, sleep: async () => undefined,
      });
      await dependencies.evidence.appendPage(job.organizationId, job.crawlRunId, {
        id: pageId, position: collected, discoveredUrl: identity.discoveredUrl, requestedUrl: identity.requestedUrl,
        normalizedUrl: identity.normalizedUrl, finalUrl: result.url, canonicalUrls: [],
      });
      const transactions = buffered.filter((event): event is Extract<CrawlEvidenceEvent, { kind: "http_transaction" }> => event.kind === "http_transaction");
      for (const [position, event] of transactions.entries()) {
        await dependencies.evidence.appendTransaction(job.organizationId, job.crawlRunId, pageId, position, event.transaction);
      }
      for (const event of buffered.filter((item): item is Extract<CrawlEvidenceEvent, { kind: "collection_error" }> => item.kind === "collection_error")) {
        await dependencies.evidence.appendError(job.organizationId, job.crawlRunId, {
          id: createEvidenceId("error", [job.crawlRunId, pageId, event.stage, event.occurredAt]), stage: event.stage,
          code: event.code, message: event.message, occurredAt: event.occurredAt, retryable: event.retryable, pageId,
        });
      }
      const httpStatus = result.kind === "html" || result.kind === "non-html" || result.kind === "rate-limited" ? "observed" : "partial";
      await dependencies.evidence.appendObservation(job.organizationId, job.crawlRunId, pageId, defineObservation({
        id: createEvidenceId("observation", [job.crawlRunId, pageId, "http"]), method: "http", status: httpStatus,
        value: { transactions: transactions.map(({ transaction }) => transaction.id), final_transaction_id: transactions.at(-1)?.transaction.id },
        reasons: [], provenance: { collector: "http", version: job.producerVersion, collectedAt: now().toISOString() },
      }));
      if (result.kind === "html") {
        const observations = extractHtmlObservations({
          runId: job.crawlRunId, pageId, pageUrl: result.url, html: result.body, collectedAt: now().toISOString(),
          extractorVersion: job.extractorVersion, hashMethodVersion: "sha256-visible-text/1",
        });
        for (const observation of observations) await dependencies.evidence.appendObservation(job.organizationId, job.crawlRunId, pageId, observation);
        const links = observations.find(({ method }) => method === "links")?.value;
        if (next.depth < job.limits.maxDepth && Array.isArray(links)) {
          for (const link of links) {
            if (link && typeof link === "object" && "target_url" in link && typeof link.target_url === "string") {
              const target = new URL(link.target_url);
              if (allowedHosts.has(target.hostname) && !discovered.has(target.href)) { discovered.add(target.href); queue.push({ url: target.href, depth: next.depth + 1 }); }
            }
          }
        }
      }
      collected += 1;
    } catch (error) {
      failed += 1;
      partial = true;
      await dependencies.evidence.appendError(job.organizationId, job.crawlRunId, {
        id: createEvidenceId("error", [job.crawlRunId, next.url, String(attempted)]), stage: "crawl",
        code: "network_error", message: error instanceof Error ? error.message : "Crawl failed", occurredAt: now().toISOString(), retryable: false,
      });
    }
    await dependencies.prisma.crawlRun.update({
      where: { id: job.crawlRunId },
      data: { processedUrls: [...processed], discoveredCount: discovered.size, attemptedCount: attempted, collectedCount: collected, failedCount: failed, unattemptedCount: discovered.size - attempted },
    });
  }

  const unattempted = discovered.size - attempted;
  const pageLimited = queue.length > 0 || unattempted > 0;
  if (pageLimited) {
    partial = true;
    await dependencies.evidence.appendLimitation(job.organizationId, job.crawlRunId, {
      id: createEvidenceId("limitation", [job.crawlRunId, "page_limit_reached"]),
      code: "page_limit_reached", message: "The bounded crawl stopped at its configured page limit.",
    });
  }
  const coverage = { discovered: discovered.size, attempted, collected, failed, unattempted };
  await dependencies.evidence.updateCoverage(job.organizationId, job.crawlRunId, { ...coverage, stopReason: pageLimited ? "page_limit_reached" : "frontier_exhausted" });
  const status = partial ? "PARTIAL" : "COMPLETED";
  await finishCrawlRun(job.crawlRunId, status, dependencies.prisma);
  await dependencies.evidence.freezeRun(job.organizationId, job.crawlRunId);
  return { crawlRunId: job.crawlRunId, status, coverage };
}
