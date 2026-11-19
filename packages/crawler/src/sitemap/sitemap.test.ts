import { describe, expect, it, vi } from "vitest";

import type { SafeTextFetcher } from "../robots/fetch-robots.js";
import type { RobotsDecisionSource } from "../robots/policy.js";
import { discoverSitemaps } from "./discover.js";
import type { CrawlEvidenceEvent } from "../evidence/events.js";
import { parseSitemap } from "./parse.js";

const encoder = new TextEncoder();
const robots = (sitemaps: string[] = []): RobotsDecisionSource => ({ kind: "allow-all", sitemaps, expiresAt: 0 });
const xml = (body: string) => ({ status: 200, body: encoder.encode(body), finalUrl: new URL("https://example.com/sitemap.xml") });

describe("parseSitemap", () => {
  it("parses URL sets and sitemap indexes", () => {
    expect(parseSitemap(encoder.encode("<urlset><url><loc>https://example.com/a&amp;b</loc></url></urlset>"))).toEqual({
      kind: "urlset", locations: ["https://example.com/a&b"],
    });
    expect(parseSitemap(encoder.encode("<sitemapindex><sitemap><loc>https://example.com/child.xml</loc></sitemap></sitemapindex>"))).toEqual({
      kind: "index", locations: ["https://example.com/child.xml"],
    });
  });

  it("rejects entity expansion and oversized decoded input", () => {
    expect(() => parseSitemap(encoder.encode("<!DOCTYPE x [<!ENTITY boom 'x'>]><urlset/>"))).toThrow();
    expect(() => parseSitemap(encoder.encode(`<urlset>${"x".repeat(100)}</urlset>`), { maxDecodedBytes: 20 })).toThrow();
  });
});

describe("discoverSitemaps", () => {
  it("records each sitemap fetch chain entry", async () => {
    const events: CrawlEvidenceEvent[] = [];
    const fetcher: SafeTextFetcher = { fetch: vi.fn().mockResolvedValue(xml("<urlset><url><loc>https://example.com/a</loc></url></urlset>")) };
    for await (const entry of discoverSitemaps(new URL("https://example.com"), robots(), fetcher, {
      evidenceSink: { record: async (event) => { events.push(event); } }, evidenceContext: { runId: "run-1" },
    })) { void entry; }
    expect(events).toContainEqual(expect.objectContaining({
      kind: "sitemap_fetch", requestedUrl: "https://example.com/sitemap.xml", depth: 0, status: 200,
    }));
  });
  it("uses robots declarations, follows bounded indexes, and deduplicates URLs", async () => {
    const pages = new Map([
      ["https://example.com/root.xml", xml("<sitemapindex><sitemap><loc>https://example.com/child.xml</loc></sitemap></sitemapindex>")],
      ["https://example.com/child.xml", xml("<urlset><url><loc>https://example.com/a</loc></url><url><loc>https://example.com/a</loc></url></urlset>")],
    ]);
    const fetcher: SafeTextFetcher = { fetch: vi.fn(async (url) => pages.get(url.href) ?? { ...xml(""), status: 404 }) };
    const found = [];
    for await (const entry of discoverSitemaps(new URL("https://example.com"), robots(["https://example.com/root.xml"]), fetcher)) found.push(entry.url);
    expect(found).toEqual(["https://example.com/a"]);
  });

  it("falls back to /sitemap.xml and enforces file, depth, URL, and compressed-byte limits", async () => {
    const index = (next: string) => xml(`<sitemapindex><sitemap><loc>${next}</loc></sitemap></sitemapindex>`);
    const fetcher: SafeTextFetcher = {
      fetch: vi.fn(async (url) => ({ ...(url.pathname === "/sitemap.xml" ? index("https://example.com/1.xml") : index(`https://example.com/${Number(url.pathname.slice(1, -4)) + 1}.xml`)), compressedBytes: 10 })),
    };
    const found = [];
    for await (const entry of discoverSitemaps(new URL("https://example.com"), robots(), fetcher, { maxDepth: 2, maxFiles: 3, maxUrls: 1, maxCompressedBytes: 15 })) found.push(entry);
    expect(found).toEqual([]);
    expect(fetcher.fetch).toHaveBeenCalledTimes(2);
  });

  it("stops exactly at the URL budget", async () => {
    const fetcher: SafeTextFetcher = { fetch: vi.fn().mockResolvedValue(xml("<urlset><url><loc>https://example.com/a</loc></url><url><loc>https://example.com/b</loc></url></urlset>")) };
    const found = [];
    for await (const entry of discoverSitemaps(new URL("https://example.com"), robots(), fetcher, { maxUrls: 1 })) found.push(entry.url);
    expect(found).toEqual(["https://example.com/a"]);
  });
});
