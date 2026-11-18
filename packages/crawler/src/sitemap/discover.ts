import type { SafeTextFetcher } from "../robots/fetch-robots.js";
import type { RobotsDecisionSource } from "../robots/policy.js";
import { parseSitemap } from "./parse.js";

export interface SitemapLimits {
  maxDepth?: number;
  maxFiles?: number;
  maxUrls?: number;
  maxDecodedBytes?: number;
  maxCompressedBytes?: number;
}
export interface SitemapUrl { url: string; source: string }

export async function* discoverSitemaps(origin: URL, robots: RobotsDecisionSource, fetcher: SafeTextFetcher, limits: SitemapLimits = {}): AsyncIterable<SitemapUrl> {
  const maxDepth = limits.maxDepth ?? 3;
  const maxFiles = limits.maxFiles ?? 50;
  const maxUrls = limits.maxUrls ?? 50_000;
  const maxDecodedBytes = limits.maxDecodedBytes ?? 10_000_000;
  const maxCompressedBytes = limits.maxCompressedBytes ?? 10_000_000;
  const queue = (robots.sitemaps.length ? robots.sitemaps : [new URL("/sitemap.xml", origin).href]).map((url) => ({ url, depth: 0 }));
  const visitedFiles = new Set<string>();
  const emitted = new Set<string>();
  let compressedTotal = 0;

  while (queue.length && visitedFiles.size < maxFiles && emitted.size < maxUrls) {
    const next = queue.shift()!;
    if (next.depth > maxDepth || visitedFiles.has(next.url)) continue;
    visitedFiles.add(next.url);
    let response;
    try { response = await fetcher.fetch(new URL(next.url), { maxBytes: maxDecodedBytes }); } catch { continue; }
    if (response.status < 200 || response.status >= 300) continue;
    compressedTotal += response.compressedBytes ?? response.body.byteLength;
    if (compressedTotal > maxCompressedBytes) break;
    let parsed;
    try { parsed = parseSitemap(response.body, { maxDecodedBytes }); } catch { continue; }
    if (parsed.kind === "index") {
      if (next.depth < maxDepth) {
        for (const location of parsed.locations) {
          try { queue.push({ url: new URL(location, response.finalUrl).href, depth: next.depth + 1 }); } catch { /* ignore */ }
        }
      }
      continue;
    }
    for (const location of parsed.locations) {
      if (emitted.size >= maxUrls) return;
      try {
        const url = new URL(location, response.finalUrl).href;
        if (!emitted.has(url)) { emitted.add(url); yield { url, source: next.url }; }
      } catch { /* ignore malformed locations */ }
    }
  }
}
