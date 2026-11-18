import type { DatabaseClient } from "@website-bot-scroll/db";
import { Queue } from "bullmq";

import { runCrawlJobSchema, type CrawlTrigger, type RunCrawlJob } from "./contracts.js";
import { CRAWL_QUEUE_NAME, crawlJobOptions, RUN_CRAWL_JOB_NAME } from "./worker-options.js";

export interface EnqueueCrawlInput { organizationId: string; siteId: string; trigger: CrawlTrigger; idempotencyKey: string }
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

async function publish(run: { id: string; organizationId: string; siteId: string; trigger: CrawlTrigger; idempotencyKey: string }, producer: QueueProducer): Promise<void> {
  const job = runCrawlJobSchema.parse({ organizationId: run.organizationId, siteId: run.siteId, crawlRunId: run.id, trigger: run.trigger, idempotencyKey: run.idempotencyKey });
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

  try {
    const run = await dependencies.prisma.crawlRun.create({ data: { ...input, activeSiteKey: input.siteId } });
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
