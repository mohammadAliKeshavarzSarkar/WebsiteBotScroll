import { z } from "zod";

const identifiers = {
  organizationId: z.uuid(),
  siteId: z.uuid(),
  crawlRunId: z.uuid(),
};

export const crawlTriggerSchema = z.enum(["MANUAL", "SCHEDULED", "RETRY"]);
export const terminalCrawlStatusSchema = z.enum(["COMPLETED", "PARTIAL", "FAILED", "CANCELLED"]);

export const runCrawlJobSchema = z.object({
  ...identifiers,
  trigger: crawlTriggerSchema,
  idempotencyKey: z.string().trim().min(1).max(200),
}).strict();

export const processPageJobSchema = z.object({
  ...identifiers,
  url: z.url().refine((value) => value.startsWith("http://") || value.startsWith("https://")),
  depth: z.int().min(0).max(8),
}).strict();

export type RunCrawlJob = z.infer<typeof runCrawlJobSchema>;
export type ProcessPageJob = z.infer<typeof processPageJobSchema>;
export type CrawlTrigger = z.infer<typeof crawlTriggerSchema>;
export type TerminalCrawlStatus = z.infer<typeof terminalCrawlStatusSchema>;
