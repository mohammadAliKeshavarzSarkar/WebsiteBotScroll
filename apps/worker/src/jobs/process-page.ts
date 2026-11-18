import type { DatabaseClient } from "@website-bot-scroll/db";
import { processPageJobSchema } from "@website-bot-scroll/queue/contracts";

export async function processPage(rawJob: unknown, prisma: DatabaseClient): Promise<{ duplicate: boolean }> {
  const job = processPageJobSchema.parse(rawJob);
  return prisma.$transaction(async (transaction) => {
    const run = await transaction.crawlRun.findFirstOrThrow({ where: { id: job.crawlRunId, siteId: job.siteId, organizationId: job.organizationId } });
    const processed = Array.isArray(run.processedUrls) ? run.processedUrls.filter((value): value is string => typeof value === "string") : [];
    if (processed.includes(job.url)) return { duplicate: true };
    await transaction.crawlRun.update({ where: { id: run.id }, data: { processedUrls: [...processed, job.url] } });
    return { duplicate: false };
  });
}
