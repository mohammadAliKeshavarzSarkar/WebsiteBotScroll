export interface CrawlLimits {
  maxPages: number;
  maxImages: number;
  maxDepth: number;
  maxTransferredBytes: number;
  maxDurationMs: number;
  maxConsecutiveServerErrors: number;
  maxConsecutiveNetworkFailures: number;
}

export const DEFAULT_CRAWL_LIMITS: CrawlLimits = {
  maxPages: 500,
  maxImages: 1_000,
  maxDepth: 8,
  maxTransferredBytes: 250 * 1024 * 1024,
  maxDurationMs: 30 * 60 * 1_000,
  maxConsecutiveServerErrors: 3,
  maxConsecutiveNetworkFailures: 5,
};

export type BudgetEvent =
  | { type: "page"; depth: number }
  | { type: "image" }
  | { type: "bytes"; count: number }
  | { type: "response"; status: number }
  | { type: "network-failure" }
  | { type: "check" };

export interface BudgetDecision { allowed: boolean; stopScheduling: boolean; reason?: "pages" | "images" | "depth" | "bytes" | "duration" | "rate-limited" | "server-errors" | "network-failures" }

export class CrawlBudget {
  readonly limits: CrawlLimits;
  private readonly startedAt: number;
  private pages = 0;
  private images = 0;
  private bytes = 0;
  private serverErrors = 0;
  private networkFailures = 0;
  private stoppedReason?: BudgetDecision["reason"];

  constructor(limits: Partial<CrawlLimits> = {}, private readonly now: () => number = Date.now) {
    this.limits = { ...DEFAULT_CRAWL_LIMITS, ...limits };
    this.startedAt = now();
  }

  consume(event: BudgetEvent): BudgetDecision {
    if (this.stoppedReason) return { allowed: false, stopScheduling: true, reason: this.stoppedReason };
    if (this.now() - this.startedAt > this.limits.maxDurationMs) return { allowed: false, stopScheduling: true, reason: "duration" };
    if (event.type === "page") {
      if (event.depth > this.limits.maxDepth) return { allowed: false, stopScheduling: false, reason: "depth" };
      if (this.pages >= this.limits.maxPages) return { allowed: false, stopScheduling: false, reason: "pages" };
      this.pages += 1;
    } else if (event.type === "image") {
      if (this.images >= this.limits.maxImages) return { allowed: false, stopScheduling: false, reason: "images" };
      this.images += 1;
    } else if (event.type === "bytes") {
      if (event.count < 0 || this.bytes + event.count > this.limits.maxTransferredBytes) return { allowed: false, stopScheduling: true, reason: "bytes" };
      this.bytes += event.count;
    } else if (event.type === "network-failure") {
      this.networkFailures += 1;
      if (this.networkFailures >= this.limits.maxConsecutiveNetworkFailures) this.stoppedReason = "network-failures";
    } else if (event.type === "response") {
      this.networkFailures = 0;
      if (event.status === 429) this.stoppedReason = "rate-limited";
      else if (event.status >= 500 && event.status <= 599) {
        this.serverErrors += 1;
        if (this.serverErrors >= this.limits.maxConsecutiveServerErrors) this.stoppedReason = "server-errors";
      } else this.serverErrors = 0;
    }
    return this.stoppedReason
      ? { allowed: false, stopScheduling: true, reason: this.stoppedReason }
      : { allowed: true, stopScheduling: false };
  }
}
