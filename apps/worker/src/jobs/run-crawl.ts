import type { DatabaseClient } from "@website-bot-scroll/db";
import { EvidenceRepository } from "@website-bot-scroll/db/evidence";
import { DefinitionRepository } from "@website-bot-scroll/db/definitions";
import { ObservationRepository } from "@website-bot-scroll/db/observation-records";
import { SnapshotRepository } from "@website-bot-scroll/db/export-projections";
import { createEvidenceId, defineObservation } from "@website-bot-scroll/domain/evidence";
import { fetchPage, type HttpTransport } from "@website-bot-scroll/crawler/http/fetch-page";
import { assertAllowedDestination, type DnsResolver } from "@website-bot-scroll/crawler/network/resolve-public";
import { loadRobots, type SafeTextFetcher } from "@website-bot-scroll/crawler/robots/fetch-robots";
import { canCrawl } from "@website-bot-scroll/crawler/robots/policy";
import { extractHtmlObservations } from "@website-bot-scroll/crawler/extract/html-observations";
import { normalizeUrlIdentity } from "@website-bot-scroll/crawler/url/normalize";
import type { CrawlEvidenceEvent, EvidenceSink } from "@website-bot-scroll/crawler/evidence/events";
import { PLATFORM_CRAWLER_DEFINITION, PLATFORM_OBSERVATION_DEFINITIONS } from "@website-bot-scroll/crawler/evidence/definitions";
import { buildPlatformPageBatch } from "@website-bot-scroll/crawler/evidence/platform-sink";
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
    include: { authorization: true, site: true },
  });
  const registeredOrigin = new URL(stored.site.origin);
  const expectedScope = { seed_urls: [`${registeredOrigin.origin}/`], allowed_hosts: [registeredOrigin.hostname], include_patterns: [], exclude_patterns: [] };
  const hasExpectedScope = (value: unknown) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const scope = value as Record<string, unknown>;
    return Object.keys(scope).length === 4 && JSON.stringify(scope.seed_urls) === JSON.stringify(expectedScope.seed_urls)
      && JSON.stringify(scope.allowed_hosts) === JSON.stringify(expectedScope.allowed_hosts)
      && JSON.stringify(scope.include_patterns) === "[]" && JSON.stringify(scope.exclude_patterns) === "[]";
  };
  if (!stored.authorization || stored.authorization.revokedAt || stored.authorization.description !== "Owner-declared crawl authorization" || !hasExpectedScope(stored.authorization.scope) || !hasExpectedScope(stored.scope)) {
    throw new Error("Crawl requires an active owner declaration for the registered site origin");
  }
  if (stored.frozenAt) {
    return {
      crawlRunId: stored.id,
      status: stored.status === "PARTIAL" ? "PARTIAL" : "COMPLETED",
      coverage: { discovered: stored.discoveredCount, attempted: stored.attemptedCount, collected: stored.collectedCount, failed: stored.failedCount, unattempted: stored.unattemptedCount ?? 0 },
    };
  }
  if (stored.status !== "PENDING" && stored.status !== "RUNNING") throw new Error(`Crawl run is not executable from status ${stored.status}`);
  const definitions = new DefinitionRepository(dependencies.prisma, { canPublish: true });
  for (const definition of PLATFORM_OBSERVATION_DEFINITIONS) await definitions.publishObservationDefinition(definition);
  await definitions.publishCollectorDefinition(PLATFORM_CRAWLER_DEFINITION);
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
  let robotsLimited = false;
  const now = dependencies.now ?? (() => new Date());
  const durationController = new AbortController();
  const durationTimer = setTimeout(() => durationController.abort(), job.limits.maxDurationMs);
  const startedAt = Date.now();
  let durationLimited = false;
  const fetcher: SafeTextFetcher = { fetch: async (url, options = {}) => {
    let current = url;
    for (let redirects = 0; redirects <= 5; redirects += 1) {
      if (!allowedHosts.has(current.hostname.toLowerCase())) throw new Error(`Destination is outside the authorized host: ${current.hostname}`);
      const destination = await assertAllowedDestination(current, dependencies.resolver);
      const response = await dependencies.transport.request({ url: current, method: "GET", destination, headers: {}, signal: durationController.signal });
      if (response.status >= 300 && response.status < 400) {
        const location = Array.isArray(response.headers.location) ? response.headers.location[0] : response.headers.location;
        const redirectBody = response.body[Symbol.asyncIterator]();
        while (!(await redirectBody.next()).done) { /* drain */ }
        if (!location || redirects === 5) throw new Error("robots redirect limit exceeded");
        current = new URL(location, current);
        continue;
      }
      const chunks: Uint8Array[] = [];
      let size = 0;
      for await (const chunk of response.body) { size += chunk.byteLength; if (size > (options.maxBytes ?? 512_000)) throw new Error("robots.txt exceeds byte limit"); chunks.push(chunk); }
      const body = new Uint8Array(size); let offset = 0;
      for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
      return { status: response.status, body, finalUrl: current, ...(response.compressedBytes === undefined ? {} : { compressedBytes: response.compressedBytes }) };
    }
    throw new Error("robots redirect limit exceeded");
  } };
  const robots = await loadRobots(registeredOrigin, fetcher, { cache: false, now: () => now().getTime() });

  try {
  while (queue.length > 0 && attempted < job.limits.maxPages) {
    if (durationController.signal.aborted || Date.now() - startedAt >= job.limits.maxDurationMs) { durationLimited = true; break; }
    const next = queue.shift()!;
    if (processed.has(next.url)) continue;
    if (!canCrawl(robots, new URL(next.url), "WebsiteBotScroll/1.0")) { partial = true; robotsLimited = true; processed.add(next.url); await dependencies.evidence.appendLimitation(job.organizationId, job.crawlRunId, { id: createEvidenceId("limitation", [job.crawlRunId, "robots_disallowed", next.url]), code: "robots_disallowed", message: "robots.txt disallows collection of this URL." }); continue; }
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
        evidenceContext: { runId: job.crawlRunId, pageId }, now, sleep: async () => undefined, allowedHosts, signal: durationController.signal,
      });
      const transactions = buffered.filter((event): event is Extract<CrawlEvidenceEvent, { kind: "http_transaction" }> => event.kind === "http_transaction");
      const collectionErrors = buffered.filter((item): item is Extract<CrawlEvidenceEvent, { kind: "collection_error" }> => item.kind === "collection_error");
      const httpStatus = result.kind === "html" || result.kind === "non-html" || result.kind === "rate-limited" ? "observed" : "partial";
      const httpObservation = defineObservation({
        id: createEvidenceId("observation", [job.crawlRunId, pageId, "http"]), method: "http", status: httpStatus,
        value: { transactions: transactions.map(({ transaction }) => transaction.id), final_transaction_id: transactions.at(-1)?.transaction.id },
        reasons: httpStatus === "partial" ? [`http_${result.kind}`] : [], provenance: { collector: "http", version: job.producerVersion, collectedAt: now().toISOString() },
      });
      const extractedObservations = result.kind === "html" ? extractHtmlObservations({
        runId: job.crawlRunId, pageId, pageUrl: result.url, html: result.body, collectedAt: now().toISOString(),
        extractorVersion: job.extractorVersion, hashMethodVersion: "sha256-visible-text/1",
      }) : [];
      const pageObservations = [httpObservation, ...extractedObservations];
      const platformBatch = buildPlatformPageBatch({ organizationId: job.organizationId, runId: job.crawlRunId, pageId, attempt: 0, observations: pageObservations });
      await dependencies.prisma.$transaction(async (transaction) => {
        const client = transaction as unknown as DatabaseClient;
        const legacy = new EvidenceRepository(client);
        const platform = new ObservationRepository(client);
        await legacy.appendPage(job.organizationId, job.crawlRunId, {
          id: pageId, position: collected, depth: next.depth, discoveredUrl: identity.discoveredUrl, requestedUrl: identity.requestedUrl,
          normalizedUrl: identity.normalizedUrl, finalUrl: result.url, canonicalUrls: [],
        });
        for (const [position, event] of transactions.entries()) await legacy.appendTransaction(job.organizationId, job.crawlRunId, pageId, position, event.transaction);
        for (const event of collectionErrors) await legacy.appendError(job.organizationId, job.crawlRunId, {
          id: createEvidenceId("error", [job.crawlRunId, pageId, event.stage, event.occurredAt]), stage: event.stage,
          code: event.code, message: event.message, occurredAt: event.occurredAt, retryable: event.retryable, pageId,
        });
        for (const observation of pageObservations) await legacy.appendObservation(job.organizationId, job.crawlRunId, pageId, observation);
        await platform.appendSubject(job.organizationId, platformBatch.subject);
        await platform.startExecution(job.organizationId, platformBatch.execution);
        for (const observation of platformBatch.records) await platform.appendObservation(job.organizationId, observation);
        await platform.finishExecution(job.organizationId, { executionId: platformBatch.execution.id, status: "completed", finishedAt: now().toISOString() });
      });
      if (result.kind === "html") {
        const links = extractedObservations.find(({ method }) => method === "links")?.value;
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
      if (durationController.signal.aborted || Date.now() - startedAt >= job.limits.maxDurationMs) { durationLimited = true; partial = true; failed += 1; break; }
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
  } finally { clearTimeout(durationTimer); }

  const unattempted = discovered.size - attempted;
  const pageLimited = queue.length > 0 && attempted >= job.limits.maxPages;
  if (pageLimited) {
    partial = true;
    await dependencies.evidence.appendLimitation(job.organizationId, job.crawlRunId, {
      id: createEvidenceId("limitation", [job.crawlRunId, "page_limit_reached"]),
      code: "page_limit_reached", message: "The bounded crawl stopped at its configured page limit.",
    });
  }
  if (durationLimited) {
    partial = true;
    await dependencies.evidence.appendLimitation(job.organizationId, job.crawlRunId, { id: createEvidenceId("limitation", [job.crawlRunId, "duration_limit_reached"]), code: "duration_limit_reached", message: "The bounded crawl stopped at its configured duration limit." });
  }
  const coverage = { discovered: discovered.size, attempted, collected, failed, unattempted };
  await dependencies.evidence.updateCoverage(job.organizationId, job.crawlRunId, { ...coverage, stopReason: durationLimited ? "duration_limit_reached" : pageLimited ? "page_limit_reached" : robotsLimited ? "robots_disallowed" : "frontier_exhausted" });
  const status = partial ? "PARTIAL" : "COMPLETED";
  await finishCrawlRun(job.crawlRunId, status, dependencies.prisma);
  const snapshots = new SnapshotRepository(dependencies.prisma);
  const parity = await snapshots.inspectObservationParity(job.organizationId, job.crawlRunId);
  if (parity.legacyDigest !== parity.generalizedDigest) throw new Error("persisted observation parity mismatch");
  await snapshots.recordParityCheckpoint(job.organizationId, job.crawlRunId, { checkpoint: { legacyCount: parity.legacyCount, generalizedCount: parity.generalizedCount }, parityDigest: parity.legacyDigest });
  await snapshots.switchToGeneralizedReads(job.organizationId, job.crawlRunId);
  await snapshots.freezePlatformSnapshot(job.organizationId, job.crawlRunId);
  return { crawlRunId: job.crawlRunId, status, coverage };
}
