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
  reportTimings?: (timings: CrawlTimings) => void;
}

type CrawlTimings = {
  crawlRunId: string;
  delivery: number;
  queueWaitMs: number;
  deliveryMs: number;
  robotsMs: number;
  fetchMs: number;
  evidenceWriteMs: number;
  finalizationMs: number;
  attempted: number;
  collected: number;
  failed: number;
};

export interface CrawlExecutionResult {
  crawlRunId: string;
  status: "COMPLETED" | "PARTIAL";
  coverage: { discovered: number; attempted: number; collected: number; failed: number; unattempted: number };
}

export async function processRunCrawl(rawJob: unknown, prisma: DatabaseClient) {
  const job = runCrawlJobSchema.parse(rawJob);
  const run = await prisma.crawlRun.findFirstOrThrow({ where: { id: job.crawlRunId, siteId: job.siteId, organizationId: job.organizationId, idempotencyKey: job.idempotencyKey } });
  const resumed = run.status !== "PENDING";
  const startedAt = run.startedAt ?? new Date();
  await prisma.crawlRun.update({
    where: { id: run.id, status: { in: ["PENDING", "RUNNING"] } },
    data: { status: "RUNNING", attemptCount: { increment: 1 }, startedAt, stopReason: null },
  });
  return { crawlRunId: run.id, resumed, startedAt };
}

export async function finishCrawlRun(crawlRunId: string, rawStatus: TerminalCrawlStatus, prisma: DatabaseClient): Promise<void> {
  const status = terminalCrawlStatusSchema.parse(rawStatus);
  await prisma.crawlRun.update({
    where: { id: crawlRunId },
    data: { status, activeSiteKey: null, finishedAt: new Date() },
  });
}

export async function executeAuthorizedCrawl(rawJob: RunCrawlJob, dependencies: CrawlDependencies): Promise<CrawlExecutionResult> {
  const deliveryStarted = performance.now();
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
  const { startedAt } = await processRunCrawl(job, dependencies.prisma);
  const timings = { robotsMs: 0, fetchMs: 0, evidenceWriteMs: 0, finalizationMs: 0 };
  async function measure<T>(phase: keyof typeof timings, operation: () => Promise<T>): Promise<T> {
    const started = performance.now();
    try { return await operation(); }
    finally { timings[phase] += performance.now() - started; }
  }
  const scope = stored.scope as { seed_urls?: unknown; allowed_hosts?: unknown } | null;
  const seedUrls = Array.isArray(scope?.seed_urls) ? scope.seed_urls.filter((value): value is string => typeof value === "string") : [];
  const allowedHosts = new Set(Array.isArray(scope?.allowed_hosts) ? scope.allowed_hosts.filter((value): value is string => typeof value === "string") : []);
  if (seedUrls.length === 0 || allowedHosts.size === 0) throw new Error("authorized crawl scope is empty");

  const identify = (url: string) => normalizeUrlIdentity(url, { removeTrackingParameters: true }, job.normalizationPolicyVersion);
  const queue: Array<{ identity: ReturnType<typeof identify>; depth: number }> = [];
  const discovered = new Set<string>();
  const discover = (url: string, depth: number) => {
    const identity = identify(url);
    if (discovered.has(identity.normalizedUrl)) return;
    discovered.add(identity.normalizedUrl);
    queue.push({ identity, depth });
  };
  const checkpoint = Array.isArray(stored.frontier) ? null
    : stored.frontier as { pending?: Array<{ url: string; depth: number }>; skipped?: string[]; robotsLimited?: boolean } | null;
  for (const item of checkpoint?.pending ?? seedUrls.map((url) => ({ url, depth: 0 }))) discover(item.url, item.depth);
  const processed = new Set(Array.isArray(stored.processedUrls)
    ? stored.processedUrls.filter((value): value is string => typeof value === "string").map((url) => identify(url).normalizedUrl)
    : []);
  const skipped = new Set(checkpoint?.skipped ?? []);
  for (const url of processed) discovered.add(url);
  for (const url of skipped) discovered.add(url);
  let attempted = stored.attemptedCount;
  let collected = stored.collectedCount;
  let failed = stored.failedCount;
  let robotsLimited = checkpoint?.robotsLimited ?? false;
  const incompleteLegacyFrontier = !checkpoint && stored.discoveredCount > discovered.size;
  const discoveredCount = () => Math.max(stored.discoveredCount, discovered.size);
  let partial = failed > 0 || robotsLimited || incompleteLegacyFrontier;
  const now = dependencies.now ?? (() => new Date());
  const durationController = new AbortController();
  const deadline = startedAt.getTime() + job.limits.maxDurationMs;
  const remaining = Math.max(0, deadline - Date.now());
  if (remaining === 0) durationController.abort();
  const durationTimer = setTimeout(() => durationController.abort(), remaining);
  const expired = () => durationController.signal.aborted || Date.now() >= deadline;
  let durationLimited = false;
  const fetcher: SafeTextFetcher = { fetch: async (url, options = {}) => {
    let current = url;
    for (let redirects = 0; redirects <= 5; redirects += 1) {
      if (!allowedHosts.has(current.hostname.toLowerCase())) throw new Error(`Destination is outside the authorized host: ${current.hostname}`);
      const destination = await assertAllowedDestination(current, dependencies.resolver);
      durationController.signal.throwIfAborted();
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
  const saveProgress = (prisma: Pick<DatabaseClient, "crawlRun">, collectedCount = collected) => prisma.crawlRun.update({
    where: { id: job.crawlRunId, status: "RUNNING" },
    data: {
      frontier: { pending: queue.map(({ identity, depth }) => ({ url: identity.discoveredUrl, depth })), skipped: [...skipped], robotsLimited },
      processedUrls: [...processed], discoveredCount: discoveredCount(), attemptedCount: attempted,
      collectedCount, failedCount: failed, unattemptedCount: discoveredCount() - attempted,
    },
  });

  try {
  const robots = !expired() && queue.some(({ identity }) => !processed.has(identity.normalizedUrl) && !skipped.has(identity.normalizedUrl))
    ? await measure("robotsMs", () => loadRobots(registeredOrigin, fetcher, { cache: false, now: () => now().getTime() }))
    : null;
  while (queue.length > 0 && attempted < job.limits.maxPages) {
    const next = queue.shift()!;
    const { identity } = next;
    const url = identity.normalizedUrl;
    if (processed.has(url) || skipped.has(url)) continue;
    if (expired()) { durationLimited = true; break; }
    if (!robots) throw new Error("robots policy unavailable");
    if (!canCrawl(robots, new URL(url), "WebsiteBotScroll/1.0")) {
      partial = true;
      robotsLimited = true;
      skipped.add(url);
      await measure("evidenceWriteMs", () => dependencies.prisma.$transaction(async (transaction) => {
        const evidence = new EvidenceRepository(transaction as unknown as DatabaseClient);
        await evidence.appendLimitation(job.organizationId, job.crawlRunId, {
          id: createEvidenceId("limitation", [job.crawlRunId, "robots_disallowed", url]),
          code: "robots_disallowed", message: "robots.txt disallows collection of this URL.",
        });
        await saveProgress(transaction);
      }));
      continue;
    }
    processed.add(url);
    attempted += 1;
    const pageId = createEvidenceId("page", [job.crawlRunId, identity.normalizedUrl]);
    const buffered: CrawlEvidenceEvent[] = [];
    const evidenceSink: EvidenceSink = { record: async (event) => { buffered.push(event); } };
    let stage = "http_fetch";
    let httpFailure: number | undefined;
    try {
      const result = await measure("fetchMs", () => fetchPage({
        url: new URL(identity.normalizedUrl), resolver: dependencies.resolver, transport: dependencies.transport,
        maxOtherBytes: job.limits.maxResponseBytes, maxCompressedBytes: job.limits.maxResponseBytes,
        maxDecompressedBytes: job.limits.maxResponseBytes, evidenceSink,
        evidenceContext: { runId: job.crawlRunId, pageId }, now, sleep: async () => undefined, allowedHosts, signal: durationController.signal,
      }));
      if (result.status < 200 || result.status >= 300) {
        httpFailure = result.status;
        throw new Error(`Page returned HTTP ${result.status}`);
      }
      stage = "evidence_persistence";
      const transactions = buffered.filter((event): event is Extract<CrawlEvidenceEvent, { kind: "http_transaction" }> => event.kind === "http_transaction");
      const collectionErrors = buffered.filter((item): item is Extract<CrawlEvidenceEvent, { kind: "collection_error" }> => item.kind === "collection_error");
      const httpObservation = defineObservation({
        id: createEvidenceId("observation", [job.crawlRunId, pageId, "http"]), method: "http", status: "observed",
        value: { transactions: transactions.map(({ transaction }) => transaction.id), final_transaction_id: transactions.at(-1)?.transaction.id },
        reasons: [], provenance: { collector: "http", version: job.producerVersion, collectedAt: now().toISOString() },
      });
      const extractedObservations = result.kind === "html" ? extractHtmlObservations({
        runId: job.crawlRunId, pageId, pageUrl: result.url, html: result.body, collectedAt: now().toISOString(),
        extractorVersion: job.extractorVersion, hashMethodVersion: "sha256-visible-text/1",
      }) : [];
      const pageObservations = [httpObservation, ...extractedObservations];
      const platformBatch = buildPlatformPageBatch({ organizationId: job.organizationId, runId: job.crawlRunId, pageId, attempt: 0, observations: pageObservations });
      const children: string[] = [];
      const links = extractedObservations.find(({ method }) => method === "links")?.value;
      if (next.depth < job.limits.maxDepth && Array.isArray(links)) {
        for (const link of links) {
          if (!link || typeof link !== "object" || !("target_url" in link) || typeof link.target_url !== "string") continue;
          const target = new URL(link.target_url);
          if (allowedHosts.has(target.hostname)) children.push(target.href);
        }
      }
      const pendingBeforePage = queue.length;
      for (const child of children) discover(child, next.depth + 1);
      try {
      await measure("evidenceWriteMs", () => dependencies.prisma.$transaction(async (transaction) => {
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
        await saveProgress(transaction, collected + 1);
      }));
      } catch (error) {
        for (const item of queue.splice(pendingBeforePage)) discovered.delete(item.identity.normalizedUrl);
        throw error;
      }
      collected += 1;
    } catch (error) {
      failed += 1;
      partial = true;
      durationLimited = expired();
      const lastStatus = buffered.findLast((event) => event.kind === "http_transaction");
      if (stage === "http_fetch" && lastStatus?.kind === "http_transaction" && lastStatus.transaction.statusCode >= 400) {
        httpFailure ??= lastStatus.transaction.statusCode;
      }
      await measure("evidenceWriteMs", () => dependencies.prisma.$transaction(async (transaction) => {
        const evidence = new EvidenceRepository(transaction as unknown as DatabaseClient);
        await evidence.appendError(job.organizationId, job.crawlRunId, {
          id: createEvidenceId("error", [job.crawlRunId, url, String(attempted)]), stage,
          code: httpFailure !== undefined ? `http_${httpFailure}` : durationLimited ? "timeout"
            : stage === "http_fetch" ? "network_error" : "evidence_persistence_error",
          message: httpFailure !== undefined ? `Page returned HTTP ${httpFailure}`
            : error instanceof Error ? error.message : "Crawl failed",
          occurredAt: now().toISOString(), retryable: httpFailure === 429 || (httpFailure !== undefined && httpFailure >= 500),
        });
        await saveProgress(transaction);
      }));
      if (durationLimited) break;
    }
  }
  } finally { clearTimeout(durationTimer); }

  const unattempted = discoveredCount() - attempted;
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
  if (incompleteLegacyFrontier) {
    await dependencies.evidence.appendLimitation(job.organizationId, job.crawlRunId, {
      id: createEvidenceId("limitation", [job.crawlRunId, "frontier_checkpoint_missing"]),
      code: "frontier_checkpoint_missing", message: "The previous worker did not save all discovered URLs.",
    });
  }
  const coverage = { discovered: discoveredCount(), attempted, collected, failed, unattempted };
  await dependencies.evidence.updateCoverage(job.organizationId, job.crawlRunId, { ...coverage, stopReason: durationLimited ? "duration_limit_reached" : pageLimited ? "page_limit_reached" : incompleteLegacyFrontier ? "frontier_checkpoint_missing" : robotsLimited ? "robots_disallowed" : "frontier_exhausted" });
  const status = partial ? "PARTIAL" : "COMPLETED";
  const snapshots = new SnapshotRepository(dependencies.prisma);
  await measure("finalizationMs", () => snapshots.finalizePlatformCrawl(job.organizationId, job.crawlRunId, status));
  dependencies.reportTimings?.({
    crawlRunId: job.crawlRunId,
    delivery: stored.attemptCount + 1,
    queueWaitMs: Math.max(0, startedAt.getTime() - stored.createdAt.getTime()),
    deliveryMs: Math.round(performance.now() - deliveryStarted),
    robotsMs: Math.round(timings.robotsMs),
    fetchMs: Math.round(timings.fetchMs),
    evidenceWriteMs: Math.round(timings.evidenceWriteMs),
    finalizationMs: Math.round(timings.finalizationMs),
    attempted: attempted - stored.attemptedCount,
    collected: collected - stored.collectedCount,
    failed: failed - stored.failedCount,
  });
  return { crawlRunId: job.crawlRunId, status, coverage };
}
