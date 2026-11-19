import type { HttpTransactionInput } from "@website-bot-scroll/domain/evidence";

export interface EvidenceContext {
  runId: string;
  pageId?: string;
}

export type CrawlEvidenceEvent =
  | { kind: "http_transaction"; runId: string; pageId: string; transaction: HttpTransactionInput }
  | { kind: "collection_error"; runId: string; pageId?: string; stage: string; code: string; message: string; retryable: boolean; occurredAt: string }
  | { kind: "robots_fetch"; runId: string; robotsUrl: string; finalUrl?: string; status?: number; outcome: "rules" | "allow-all" | "temporary-disallow"; occurredAt: string; error?: string }
  | { kind: "sitemap_fetch"; runId: string; requestedUrl: string; finalUrl?: string; depth: number; status?: number; outcome: "parsed" | "http_error" | "fetch_error" | "parse_error"; occurredAt: string; error?: string };

export interface EvidenceSink {
  record(event: CrawlEvidenceEvent): Promise<void>;
}
