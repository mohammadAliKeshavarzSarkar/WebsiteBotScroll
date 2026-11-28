import { Worker, type Job } from "bullmq";
import type { AppEnv } from "@website-bot-scroll/config";
import { createPrismaClient, type DatabaseClient } from "@website-bot-scroll/db";
import { EvidenceRepository } from "@website-bot-scroll/db/evidence";
import type { DnsResolver } from "@website-bot-scroll/crawler/network/resolve-public";
import type { HttpTransport } from "@website-bot-scroll/crawler/http/fetch-page";
import { runCrawlJobSchema, type RunCrawlJob } from "@website-bot-scroll/queue/contracts";
import { createCrawlQueueProducer, recoverPendingCrawls } from "@website-bot-scroll/queue/client";
import { CRAWL_QUEUE_NAME, RUN_CRAWL_JOB_NAME, crawlWorkerOptions } from "@website-bot-scroll/queue/worker-options";
import { executeAuthorizedCrawl, type CrawlDependencies } from "./jobs/run-crawl.js";
import { createDnsResolver, createNodeHttpTransport } from "./network.js";

type Closeable = { close(): Promise<void> };
type WorkerFactory = (name: string, processor: (job: { name: string; data: unknown }) => Promise<unknown>, options: Record<string, unknown>) => Closeable;
type Dependencies = {
  prisma?: DatabaseClient; evidence?: EvidenceRepository; resolver?: DnsResolver; transport?: HttpTransport;
  execute?: typeof executeAuthorizedCrawl;
  fail?: typeof failCrawlRun;
  createWorker?: WorkerFactory;
};

function redisConnection(redisUrl: string): Record<string, unknown> {
  const url = new URL(redisUrl);
  return { host: url.hostname, port: Number(url.port || 6379), maxRetriesPerRequest: null, ...(url.username ? { username: decodeURIComponent(url.username) } : {}), ...(url.password ? { password: decodeURIComponent(url.password) } : {}), ...(url.protocol === "rediss:" ? { tls: {} } : {}) };
}

export async function failCrawlRun(job: RunCrawlJob, _error: unknown, prisma: DatabaseClient): Promise<void> {
  await prisma.$transaction(async (transaction) => {
    const updated = await transaction.crawlRun.updateMany({
      where: { id: job.crawlRunId, organizationId: job.organizationId, siteId: job.siteId, status: { in: ["PENDING", "RUNNING"] } },
      data: { status: "FAILED", activeSiteKey: null, finishedAt: new Date() },
    });
    if (updated.count > 0) await transaction.crawlError.create({ data: {
      crawlRunId: job.crawlRunId, code: "worker_failed", message: "The crawl worker could not complete this run.", retryable: true,
    } });
  });
}

export async function recoverRunningCrawls(prisma: DatabaseClient, getJobState: (id: string) => Promise<string>): Promise<void> {
  const staleBefore = new Date(Date.now() - crawlWorkerOptions.lockDuration);
  const runs = await prisma.crawlRun.findMany({
    where: { status: "RUNNING", trigger: "MANUAL", activeSiteKey: { not: null }, updatedAt: { lt: staleBefore } },
    select: { id: true, startedAt: true, updatedAt: true, limits: true },
  });
  for (const run of runs) {
    const state = await getJobState(run.id);
    const limits = run.limits as { max_duration_ms?: number } | null;
    const deadline = (run.startedAt ?? run.updatedAt).getTime() + (limits?.max_duration_ms ?? 300_000);
    // A lost Redis job may still have a worker finishing an in-flight request.
    const orphaned = state === "unknown" && deadline < staleBefore.getTime();
    if (!orphaned && state !== "failed" && state !== "completed") continue;
    await prisma.$transaction(async (tx) => {
      const updated = await tx.crawlRun.updateMany({
        where: { id: run.id, status: "RUNNING", updatedAt: run.updatedAt },
        data: { status: "FAILED", activeSiteKey: null, finishedAt: new Date(), stopReason: "worker_error" },
      });
      if (updated.count) await tx.crawlError.create({ data: {
        crawlRunId: run.id, code: "crawl_interrupted", message: "This crawl was interrupted. You can start another crawl.", retryable: true,
      } });
    });
  }
}

export function createCrawlWorker(environment: AppEnv, provided: Dependencies = {}): Closeable {
  const prisma = provided.prisma ?? createPrismaClient(environment.DATABASE_URL);
  const evidence = provided.evidence ?? new EvidenceRepository(prisma);
  const resolver = provided.resolver ?? createDnsResolver();
  const transport = provided.transport ?? createNodeHttpTransport(environment.CRAWLER_CONTACT_URL);
  const execute = provided.execute ?? executeAuthorizedCrawl;
  const fail = provided.fail ?? failCrawlRun;
  const processor = async (raw: { name: string; data: unknown }) => {
    if (raw.name !== RUN_CRAWL_JOB_NAME) throw new Error(`Unsupported crawl job: ${raw.name}`);
    const job = runCrawlJobSchema.parse(raw.data);
    const crawlDependencies: CrawlDependencies = { prisma, evidence, resolver, transport };
    try { return await execute(job, crawlDependencies); }
    catch (error) { await fail(job, error, prisma); throw error; }
  };
  const createWorker = provided.createWorker ?? ((name, handler, options) => new Worker(name, (job: Job) => handler({ name: job.name, data: job.data }), options as never));
  const worker = createWorker(CRAWL_QUEUE_NAME, processor, { connection: redisConnection(environment.REDIS_URL), ...crawlWorkerOptions });
  if (provided.createWorker) return worker;

  const producer = createCrawlQueueProducer(environment.REDIS_URL);
  let recovery: Promise<void> | undefined;
  const recover = () => {
    recovery ??= recoverRunningCrawls(prisma, producer.getJobState)
      .then(() => recoverPendingCrawls({ prisma, producer }))
      .catch(() => { console.warn("Crawl queue recovery will retry on the next pass"); })
      .finally(() => { recovery = undefined; });
  };
  const timer = setInterval(recover, 30_000);
  timer.unref();
  recover();
  return { close: async () => {
    clearInterval(timer);
    await recovery;
    await Promise.all([worker.close(), producer.close()]);
  } };
}
