import { describe, expect, it } from "vitest";

import { CrawlBudget, DEFAULT_CRAWL_LIMITS } from "./budget.js";

describe("CrawlBudget", () => {
  it("pins the MVP defaults", () => {
    expect(DEFAULT_CRAWL_LIMITS).toEqual({
      maxPages: 500,
      maxImages: 1_000,
      maxDepth: 8,
      maxTransferredBytes: 250 * 1024 * 1024,
      maxDurationMs: 30 * 60 * 1_000,
      maxConsecutiveServerErrors: 3,
      maxConsecutiveNetworkFailures: 5,
    });
  });

  it("keeps page, image, byte, depth, and duration limits independent", () => {
    let now = 0;
    const budget = new CrawlBudget({ maxPages: 1, maxImages: 1, maxTransferredBytes: 10, maxDepth: 1, maxDurationMs: 10 }, () => now);
    expect(budget.consume({ type: "page", depth: 1 }).allowed).toBe(true);
    expect(budget.consume({ type: "page", depth: 1 }).allowed).toBe(false);
    expect(budget.consume({ type: "image" }).allowed).toBe(true);
    expect(budget.consume({ type: "image" }).allowed).toBe(false);
    expect(budget.consume({ type: "bytes", count: 10 }).allowed).toBe(true);
    expect(budget.consume({ type: "bytes", count: 1 }).allowed).toBe(false);
    expect(budget.consume({ type: "page", depth: 2 }).reason).toBe("depth");
    now = 11;
    expect(budget.consume({ type: "check" }).reason).toBe("duration");
  });

  it("stops scheduling after 429, three consecutive 5xx, or five network failures", () => {
    expect(new CrawlBudget().consume({ type: "response", status: 429 }).stopScheduling).toBe(true);
    const servers = new CrawlBudget();
    servers.consume({ type: "response", status: 500 });
    servers.consume({ type: "response", status: 502 });
    expect(servers.consume({ type: "response", status: 503 }).stopScheduling).toBe(true);
    const network = new CrawlBudget();
    for (let count = 0; count < 4; count += 1) network.consume({ type: "network-failure" });
    expect(network.consume({ type: "network-failure" }).stopScheduling).toBe(true);
  });
});
