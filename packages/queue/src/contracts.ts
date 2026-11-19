import { z } from "zod";

const identifiers = {
  organizationId: z.uuid(),
  siteId: z.uuid(),
  crawlRunId: z.uuid(),
};

export const crawlTriggerSchema = z.enum(["MANUAL", "SCHEDULED", "RETRY"]);
export const terminalCrawlStatusSchema = z.enum(["COMPLETED", "PARTIAL", "FAILED", "CANCELLED"]);
export const crawlLimitsSchema = z.object({
  maxPages: z.int().min(1).max(10_000),
  maxDepth: z.int().min(0).max(8),
  maxDurationMs: z.int().min(1).max(3_600_000),
  maxResponseBytes: z.int().min(1).max(100_000_000),
}).strict();
export const crawlScopeSchema = z.object({
  seed_urls: z.array(z.url()).min(1),
  allowed_hosts: z.array(z.string().trim().min(1)).min(1),
  include_patterns: z.array(z.string()).optional(),
  exclude_patterns: z.array(z.string()).optional(),
}).strict();

export const runCrawlJobSchema = z.object({
  ...identifiers,
  trigger: z.literal("MANUAL"),
  idempotencyKey: z.string().trim().min(1).max(200),
  authorizationRef: z.string().trim().min(1).max(200),
  limits: crawlLimitsSchema,
  producerVersion: z.string().regex(/^[a-f0-9]{40}$/),
  normalizationPolicyVersion: z.string().trim().min(1).max(100),
  extractorVersion: z.string().trim().min(1).max(100),
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
