import type { DatabaseClient } from "@website-bot-scroll/db";
import { Queue } from "bullmq";

import { crawlScopeSchema, runCrawlJobSchema, type CrawlTrigger, type RunCrawlJob } from "./contracts.js";
import { CRAWL_QUEUE_NAME, crawlJobOptions, RUN_CRAWL_JOB_NAME } from "./worker-options.js";

export type EnqueueCrawlInput = Omit<RunCrawlJob, "crawlRunId">;
export interface QueueProducer { add(name: string, data: RunCrawlJob, options: { jobId: string }): Promise<unknown> }
export interface CloseableQueueProducer extends QueueProducer { close(): Promise<void> }
export interface EnqueueDependencies { prisma: DatabaseClient; producer: QueueProducer }

export class CrawlOverlapError extends Error {
  constructor() { super("A crawl is already active for this site"); this.name = "CrawlOverlapError"; }
}

export function createCrawlQueueProducer(redisUrl: string): CloseableQueueProducer {
  const url = new URL(redisUrl);
  if (url.protocol !== "redis:" && url.protocol !== "rediss:") throw new TypeError("Redis URL must use redis:// or rediss://");
  const queue = new Queue<RunCrawlJob>(CRAWL_QUEUE_NAME, {
    connection: {
      host: url.hostname,
      port: Number(url.port || 6379),
      ...(url.username ? { username: decodeURIComponent(url.username) } : {}),
      ...(url.password ? { password: decodeURIComponent(url.password) } : {}),
      ...(url.protocol === "rediss:" ? { tls: {} } : {}),
    },
  });
  return {
    add: (name, data, options) => queue.add(name, data, { ...crawlJobOptions, ...options }),
    close: () => queue.close(),
  };
}

async function publish(run: { id: string; organizationId: string; siteId: string; trigger: CrawlTrigger; idempotencyKey: string; authorizationId: string | null; limits: unknown; producerVersion: string | null; normalizationPolicyVersion: string | null; extractorVersion: string | null }, producer: QueueProducer): Promise<void> {
  const limits = run.limits as { max_pages?: number; max_depth?: number; max_duration_ms?: number; max_response_bytes?: number } | null;
  const job = runCrawlJobSchema.parse({
    organizationId: run.organizationId, siteId: run.siteId, crawlRunId: run.id, trigger: run.trigger, idempotencyKey: run.idempotencyKey,
    authorizationRef: run.authorizationId,
    limits: { maxPages: limits?.max_pages, maxDepth: limits?.max_depth, maxDurationMs: limits?.max_duration_ms, maxResponseBytes: limits?.max_response_bytes },
    producerVersion: run.producerVersion, normalizationPolicyVersion: run.normalizationPolicyVersion, extractorVersion: run.extractorVersion,
  });
  await producer.add(RUN_CRAWL_JOB_NAME, job, { jobId: run.id });
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

export async function enqueueCrawl(input: EnqueueCrawlInput, dependencies: EnqueueDependencies): Promise<string> {
  const existing = await dependencies.prisma.crawlRun.findUnique({ where: { siteId_idempotencyKey: { siteId: input.siteId, idempotencyKey: input.idempotencyKey } } });
  if (existing) {
    await publish(existing, dependencies.producer);
    return existing.id;
  }
  const site = await dependencies.prisma.site.findFirst({ where: { id: input.siteId, organizationId: input.organizationId }, select: { id: true } });
  if (!site) throw new Error("Site does not belong to the organization");
  const authorization = await dependencies.prisma.exportAuthorization.findFirst({ where: { id: input.authorizationRef, siteId: input.siteId, organizationId: input.organizationId, revokedAt: null } });
  if (!authorization) throw new Error("Export authorization does not belong to the organization and site");
  const authorizationScope = crawlScopeSchema.parse(authorization.scope);

  try {
    const run = await dependencies.prisma.crawlRun.create({ data: {
      organizationId: input.organizationId, siteId: input.siteId, trigger: input.trigger, idempotencyKey: input.idempotencyKey,
      activeSiteKey: input.siteId, authorizationId: input.authorizationRef, scope: authorizationScope,
      limits: { max_pages: input.limits.maxPages, max_depth: input.limits.maxDepth, max_duration_ms: input.limits.maxDurationMs, max_response_bytes: input.limits.maxResponseBytes },
      producerVersion: input.producerVersion, normalizationPolicyVersion: input.normalizationPolicyVersion, extractorVersion: input.extractorVersion,
    } });
    await publish(run, dependencies.producer);
    return run.id;
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const duplicate = await dependencies.prisma.crawlRun.findUnique({ where: { siteId_idempotencyKey: { siteId: input.siteId, idempotencyKey: input.idempotencyKey } } });
    if (duplicate) {
      await publish(duplicate, dependencies.producer);
      return duplicate.id;
    }
    throw new CrawlOverlapError();
  }
}
