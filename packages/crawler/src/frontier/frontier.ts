import type { RobotsDecisionSource } from "../robots/policy.js";
import { canCrawl } from "../robots/policy.js";
import { normalizeUrl } from "../url/normalize.js";
import { isSameSite } from "../url/policy.js";

export interface FrontierCandidate { url: string; depth: number; kind: "page" | "image" }
export interface FrontierItem extends FrontierCandidate { url: string }
export interface CrawlFrontierOptions { origin: URL; robots: RobotsDecisionSource; userAgent: string; maxDepth?: number; includeSubdomains?: boolean }

export class CrawlFrontier {
  private readonly queued: FrontierItem[] = [];
  private readonly seen = new Set<string>();
  constructor(private readonly options: CrawlFrontierOptions) {}

  add(candidate: FrontierCandidate): boolean {
    if (candidate.depth > (this.options.maxDepth ?? 8) || candidate.depth < 0) return false;
    try {
      const normalized = normalizeUrl(candidate.url, { removeTrackingParameters: true });
      const url = new URL(normalized);
      if (!isSameSite(url, { origin: this.options.origin, includeSubdomains: this.options.includeSubdomains ?? false })) return false;
      if (!canCrawl(this.options.robots, url, this.options.userAgent) || this.seen.has(normalized)) return false;
      this.seen.add(normalized);
      this.queued.push({ ...candidate, url: normalized });
      return true;
    } catch {
      return false;
    }
  }

  async next(): Promise<FrontierItem | null> {
    return this.queued.shift() ?? null;
  }
}
