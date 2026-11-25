import { describe, expect, it, vi } from "vitest";
import { RUN_CRAWL_JOB_NAME } from "@website-bot-scroll/queue/worker-options";
import { createCrawlWorker, failCrawlRun } from "./crawl-worker.js";

const environment = { DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/test", REDIS_URL: "redis://localhost:6379", AUTH_SECRET: "a".repeat(32), APP_BASE_URL: "http://localhost:3000", CRAWLER_CONTACT_URL: "https://crawler.example/contact", BOOTSTRAP_OWNER_EMAIL: "owner@example.com", BOOTSTRAP_OWNER_PASSWORD: "correct-horse-battery-staple" };
const job = { organizationId: "11111111-1111-4111-8111-111111111111", siteId: "22222222-2222-4222-8222-222222222222", crawlRunId: "33333333-3333-4333-8333-333333333333", trigger: "MANUAL" as const, idempotencyKey: "key", authorizationRef: "auth-1", limits: { maxPages: 1, maxDepth: 0, maxDurationMs: 10_000, maxResponseBytes: 5_242_880 }, producerVersion: "a".repeat(40), normalizationPolicyVersion: "normalize/1", extractorVersion: "html/1" };

describe("crawl BullMQ worker", () => {
  it("dispatches only accepted run-crawl jobs and exposes close", async () => {
    let processor: ((job: { name: string; data: unknown }) => Promise<unknown>) | undefined;
    const close = vi.fn(async () => undefined); const execute = vi.fn(async () => ({ crawlRunId: job.crawlRunId, status: "COMPLETED" as const, coverage: { discovered: 1, attempted: 1, collected: 1, failed: 0, unattempted: 0 } }));
    const createWorker = vi.fn((_name, handler) => { processor = handler; return { close }; });
    const runtime = createCrawlWorker(environment, { prisma: {} as never, evidence: {} as never, resolver: {} as never, transport: {} as never, execute, fail: vi.fn(), createWorker });
    await expect(processor!({ name: RUN_CRAWL_JOB_NAME, data: job })).resolves.toMatchObject({ status: "COMPLETED" });
    await expect(processor!({ name: "unknown", data: job })).rejects.toThrow("Unsupported crawl job");
    expect(execute).toHaveBeenCalledWith(job, expect.any(Object));
    await runtime.close(); expect(close).toHaveBeenCalledOnce();
  });

  it("finalizes a failed accepted job and rethrows for BullMQ retry handling", async () => {
    let processor: ((job: { name: string; data: unknown }) => Promise<unknown>) | undefined;
    const failure = new Error("database password leaked"); const fail = vi.fn(async () => undefined);
    createCrawlWorker(environment, { prisma: {} as never, evidence: {} as never, resolver: {} as never, transport: {} as never, execute: vi.fn(async () => { throw failure; }), fail, createWorker: (_name, handler) => { processor = handler; return { close: vi.fn(async () => undefined) }; } });
    await expect(processor!({ name: RUN_CRAWL_JOB_NAME, data: job })).rejects.toBe(failure);
    expect(fail).toHaveBeenCalledWith(job, failure, expect.anything());
  });

  it("marks the run failed, clears its active lock, and stores only a safe structured error", async () => {
    const updateMany = vi.fn(async () => ({ count: 1 })); const create = vi.fn(async () => ({}));
    const prisma = { $transaction: (callback: (transaction: unknown) => Promise<void>) => callback({ crawlRun: { updateMany }, crawlError: { create } }) };
    await failCrawlRun(job, new Error("redis://user:secret@internal:6379"), prisma as never);
    expect(updateMany).toHaveBeenCalledWith({ where: { id: job.crawlRunId, organizationId: job.organizationId, siteId: job.siteId, status: { in: ["PENDING", "RUNNING"] } }, data: { status: "FAILED", activeSiteKey: null, finishedAt: expect.any(Date) } });
    expect(create).toHaveBeenCalledWith({ data: { crawlRunId: job.crawlRunId, code: "worker_failed", message: "The crawl worker could not complete this run.", retryable: true } });
    expect(JSON.stringify(create.mock.calls)).not.toContain("secret");
  });

  it("has the installed Redis runtime driver available to BullMQ", async () => {
    await expect(import("ioredis")).resolves.toBeTruthy();
  });
});
