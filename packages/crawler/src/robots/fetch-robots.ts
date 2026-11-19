import type { RobotsDecisionSource, RobotsRule } from "./policy.js";
import type { EvidenceContext, EvidenceSink } from "../evidence/events.js";

export interface SafeFetchResult {
  status: number;
  body: Uint8Array;
  finalUrl: URL;
  compressedBytes?: number;
}

export interface SafeTextFetcher {
  /** Fetches only after Task 3 validation and revalidates every redirect. */
  fetch(url: URL, options?: { maxBytes?: number }): Promise<SafeFetchResult>;
}

export interface LoadRobotsOptions {
  cache?: boolean;
  maxBytes?: number;
  maxAgeMs?: number;
  retryAfterMs?: number;
  now?: () => number;
  evidenceSink?: EvidenceSink;
  evidenceContext?: EvidenceContext;
}

const caches = new WeakMap<SafeTextFetcher, Map<string, RobotsDecisionSource>>();

function parseRobots(text: string, base: URL, expiresAt: number): RobotsDecisionSource {
  const groups: NonNullable<RobotsDecisionSource["groups"]> = [];
  const sitemaps: string[] = [];
  let agents: string[] = [];
  let rules: RobotsRule[] = [];
  let hasRules = false;
  const flush = () => {
    if (agents.length) groups.push({ agents, rules });
    agents = [];
    rules = [];
    hasRules = false;
  };

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    const separator = line.indexOf(":");
    if (separator < 0) continue;
    const field = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (field === "user-agent") {
      if (hasRules) flush();
      agents.push(value.toLowerCase());
    } else if ((field === "allow" || field === "disallow") && agents.length) {
      rules.push({ allow: field === "allow", path: value });
      hasRules = true;
    } else if (field === "sitemap" && value) {
      try { sitemaps.push(new URL(value, base).href); } catch { /* Ignore malformed declarations. */ }
    }
  }
  flush();
  return { kind: "rules", groups, sitemaps: [...new Set(sitemaps)], expiresAt };
}

export async function loadRobots(origin: URL, fetcher: SafeTextFetcher, options: LoadRobotsOptions = {}): Promise<RobotsDecisionSource> {
  const now = options.now?.() ?? Date.now();
  const cacheEnabled = options.cache !== false;
  const key = origin.origin;
  let cache = caches.get(fetcher);
  if (!cache) caches.set(fetcher, cache = new Map());
  const cached = cache.get(key);
  if (cacheEnabled && cached && cached.expiresAt > now) return cached;

  const maxAge = Math.min(options.maxAgeMs ?? 86_400_000, 86_400_000);
  const retryAfter = options.retryAfterMs ?? 300_000;
  const maxBytes = options.maxBytes ?? 512_000;
  let result: RobotsDecisionSource;
  let status: number | undefined;
  let finalUrl: string | undefined;
  let failure: string | undefined;
  try {
    const response = await fetcher.fetch(new URL("/robots.txt", origin), { maxBytes });
    status = response.status;
    finalUrl = response.finalUrl.href;
    if (response.body.byteLength > maxBytes) throw new Error("robots.txt exceeds byte limit");
    if (response.status >= 200 && response.status < 300) {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(response.body);
      result = parseRobots(text, response.finalUrl, now + maxAge);
    } else if (response.status === 404 || response.status === 410) {
      result = { kind: "allow-all", sitemaps: [], expiresAt: now + maxAge };
    } else if (response.status >= 500) {
      result = { kind: "temporary-disallow", sitemaps: [], expiresAt: now + retryAfter };
    } else {
      result = { kind: "allow-all", sitemaps: [], expiresAt: now + maxAge };
    }
  } catch (error) {
    failure = error instanceof Error ? error.message : "robots fetch failed";
    result = { kind: "temporary-disallow", sitemaps: [], expiresAt: now + retryAfter };
  }
  if (options.evidenceSink && options.evidenceContext) {
    await options.evidenceSink.record({
      kind: "robots_fetch", runId: options.evidenceContext.runId, robotsUrl: new URL("/robots.txt", origin).href,
      ...(finalUrl ? { finalUrl } : {}), ...(status === undefined ? {} : { status }), outcome: result.kind,
      occurredAt: new Date(now).toISOString(), ...(failure ? { error: failure } : {}),
    });
  }
  if (cacheEnabled) cache.set(key, result);
  return result;
}
