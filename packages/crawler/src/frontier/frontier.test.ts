import { describe, expect, it } from "vitest";

import type { RobotsDecisionSource } from "../robots/policy.js";
import { CrawlFrontier } from "./frontier.js";

const robots: RobotsDecisionSource = { kind: "rules", expiresAt: Infinity, sitemaps: [], groups: [{ agents: ["*"], rules: [{ allow: false, path: "/blocked" }] }] };

describe("CrawlFrontier", () => {
  it("accepts only unique normalized, same-site, robots-allowed URLs through depth 8", async () => {
    const frontier = new CrawlFrontier({ origin: new URL("https://example.com"), robots, userAgent: "WebsiteBotScroll/0.1" });
    expect(frontier.add({ url: "https://EXAMPLE.com/a?b=2&a=1#x", depth: 8, kind: "page" })).toBe(true);
    expect(frontier.add({ url: "https://example.com/a?a=1&b=2", depth: 8, kind: "page" })).toBe(false);
    expect(frontier.add({ url: "https://example.com/deep", depth: 9, kind: "page" })).toBe(false);
    expect(frontier.add({ url: "https://other.example/a", depth: 1, kind: "page" })).toBe(false);
    expect(frontier.add({ url: "https://example.com/blocked/a", depth: 1, kind: "page" })).toBe(false);
    expect((await frontier.next())?.url).toBe("https://example.com/a?a=1&b=2");
    expect(await frontier.next()).toBeNull();
  });
});
