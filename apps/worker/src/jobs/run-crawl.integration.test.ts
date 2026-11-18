import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { enqueueCrawl, CrawlOverlapError, type QueueProducer } from "@website-bot-scroll/queue/client";
import { createPrismaClient } from "@website-bot-scroll/db";
import { processPage } from "./process-page.js";
import { finishCrawlRun, processRunCrawl } from "./run-crawl.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

describeDatabase("idempotent crawl orchestration", () => {
  const prisma = createPrismaClient(databaseUrl!);
  const producer: QueueProducer = { add: vi.fn().mockResolvedValue(undefined) };
  let organizationId: string;
  let siteId: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    await prisma.crawlError.deleteMany();
    await prisma.crawlRun.deleteMany();
    await prisma.site.deleteMany();
    await prisma.organization.deleteMany();
    organizationId = randomUUID();
    siteId = randomUUID();
    await prisma.organization.create({ data: { id: organizationId, name: "Owner" } });
    await prisma.site.create({ data: { id: siteId, organizationId, name: "Example", origin: "https://example.com" } });
  });

  afterAll(async () => prisma.$disconnect());

  it("enqueues one run per idempotency key and prevents site overlap", async () => {
    const input = { organizationId, siteId, trigger: "MANUAL" as const, idempotencyKey: "manual-1" };
    const first = await enqueueCrawl(input, { prisma, producer });
    const duplicate = await enqueueCrawl(input, { prisma, producer });
    expect(duplicate).toBe(first);
    expect(await prisma.crawlRun.count()).toBe(1);
    expect(producer.add).toHaveBeenCalledTimes(2);
    await expect(enqueueCrawl({ ...input, idempotencyKey: "manual-2" }, { prisma, producer })).rejects.toBeInstanceOf(CrawlOverlapError);
  });

  it("republishes a stored run after a transient queue failure", async () => {
    const recovering: QueueProducer = { add: vi.fn().mockRejectedValueOnce(new Error("redis unavailable")).mockResolvedValueOnce(undefined) };
    const input = { organizationId, siteId, trigger: "MANUAL" as const, idempotencyKey: "recover-1" };
    await expect(enqueueCrawl(input, { prisma, producer: recovering })).rejects.toThrow("redis unavailable");
    const crawlRunId = await enqueueCrawl(input, { prisma, producer: recovering });
    expect(crawlRunId).toBeTruthy();
    expect(await prisma.crawlRun.count()).toBe(1);
    expect(recovering.add).toHaveBeenCalledTimes(2);
  });

  it("resumes duplicate worker delivery and checkpoints a page once", async () => {
    const crawlRunId = await enqueueCrawl({ organizationId, siteId, trigger: "MANUAL", idempotencyKey: "retry-1" }, { prisma, producer });
    const job = { organizationId, siteId, crawlRunId, trigger: "MANUAL" as const, idempotencyKey: "retry-1" };
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
    const input = { organizationId, siteId, trigger: "MANUAL" as const, idempotencyKey: "first" };
    const crawlRunId = await enqueueCrawl(input, { prisma, producer });
    await finishCrawlRun(crawlRunId, "COMPLETED", prisma);
    const next = await enqueueCrawl({ ...input, idempotencyKey: "second" }, { prisma, producer });
    expect(next).not.toBe(crawlRunId);
    expect((await prisma.crawlRun.findUniqueOrThrow({ where: { id: crawlRunId } })).activeSiteKey).toBeNull();
  });
});
