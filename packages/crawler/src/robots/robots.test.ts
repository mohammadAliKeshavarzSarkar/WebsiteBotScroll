import { describe, expect, it, vi } from "vitest";

import { loadRobots, type SafeTextFetcher } from "./fetch-robots.js";
import { canCrawl } from "./policy.js";

const encoder = new TextEncoder();

function fetcher(status: number, text = "", finalUrl = "https://example.com/robots.txt"): SafeTextFetcher {
  return {
    fetch: vi.fn().mockResolvedValue({ status, body: encoder.encode(text), finalUrl: new URL(finalUrl) }),
  };
}

describe("robots access results", () => {
  it("honors the longest matching allow/disallow rule for the selected agent", async () => {
    const source = await loadRobots(
      new URL("https://example.com"),
      fetcher(200, "User-agent: WebsiteBotScroll\nDisallow: /private\nAllow: /private/public\nSitemap: /map.xml"),
      { cache: false },
    );

    expect(canCrawl(source, new URL("https://example.com/private/a"), "WebsiteBotScroll/1.0")).toBe(false);
    expect(canCrawl(source, new URL("https://example.com/private/public/a"), "WebsiteBotScroll/1.0")).toBe(true);
    expect(source.sitemaps).toEqual(["https://example.com/map.xml"]);
  });

  it.each([404, 410])("treats %s as no rules", async (status) => {
    const source = await loadRobots(new URL("https://example.com"), fetcher(status), { cache: false });
    expect(canCrawl(source, new URL("https://example.com/anything"), "bot")).toBe(true);
  });

  it.each([500, 503])("temporarily disallows crawling after %s", async (status) => {
    const source = await loadRobots(new URL("https://example.com"), fetcher(status), { cache: false });
    expect(source.kind).toBe("temporary-disallow");
    expect(canCrawl(source, new URL("https://example.com/"), "bot")).toBe(false);
  });

  it("temporarily disallows crawling after a network or unsafe-redirect failure", async () => {
    const unsafe: SafeTextFetcher = { fetch: vi.fn().mockRejectedValue(new Error("redirect resolved to 127.0.0.1")) };
    const source = await loadRobots(new URL("https://example.com"), unsafe, { cache: false });
    expect(source.kind).toBe("temporary-disallow");
  });

  it("bounds UTF-8 input", async () => {
    const oversized = fetcher(200, `User-agent: *\nDisallow: /\n${"x".repeat(600_000)}`);
    const source = await loadRobots(new URL("https://example.com"), oversized, { cache: false, maxBytes: 512_000 });
    expect(source.kind).toBe("temporary-disallow");
  });

  it("caches successful results but retries transient failures after the retry window", async () => {
    let now = 1_000;
    const changing: SafeTextFetcher = {
      fetch: vi.fn().mockResolvedValueOnce({ status: 503, body: encoder.encode(""), finalUrl: new URL("https://example.com/robots.txt") })
        .mockResolvedValueOnce({ status: 404, body: encoder.encode(""), finalUrl: new URL("https://example.com/robots.txt") }),
    };
    const options = { now: () => now, retryAfterMs: 100, maxAgeMs: 1_000 };
    const first = await loadRobots(new URL("https://example.com"), changing, options);
    now += 50;
    expect(await loadRobots(new URL("https://example.com"), changing, options)).toBe(first);
    now += 51;
    expect((await loadRobots(new URL("https://example.com"), changing, options)).kind).toBe("allow-all");
    expect(changing.fetch).toHaveBeenCalledTimes(2);
  });
});
