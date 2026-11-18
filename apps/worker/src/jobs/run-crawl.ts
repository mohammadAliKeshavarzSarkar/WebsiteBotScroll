import type { DatabaseClient } from "@website-bot-scroll/db";
import { runCrawlJobSchema, terminalCrawlStatusSchema, type TerminalCrawlStatus } from "@website-bot-scroll/queue/contracts";

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
