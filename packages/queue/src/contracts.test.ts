import { describe, expect, it } from "vitest";

import { processPageJobSchema, runCrawlJobSchema, terminalCrawlStatusSchema } from "./contracts.js";

const ids = {
  organizationId: "11111111-1111-4111-8111-111111111111",
  siteId: "22222222-2222-4222-8222-222222222222",
  crawlRunId: "33333333-3333-4333-8333-333333333333",
};

describe("queue contracts", () => {
  it("accepts identifier-only crawl jobs", () => {
    expect(runCrawlJobSchema.parse({ ...ids, trigger: "MANUAL", idempotencyKey: "manual-2026-11-18" })).toEqual({ ...ids, trigger: "MANUAL", idempotencyKey: "manual-2026-11-18" });
    expect(processPageJobSchema.parse({ ...ids, url: "https://example.com/a", depth: 2 })).toMatchObject({ depth: 2 });
  });

  it.each([
    { ...ids, trigger: "MANUAL", idempotencyKey: "x", password: "secret" },
    { ...ids, trigger: "MANUAL", idempotencyKey: "x", content: "<html>" },
    { ...ids, trigger: "INVALID", idempotencyKey: "x" },
    { ...ids, url: "http://127.0.0.1", depth: 9 },
  ])("rejects malformed or expansive payloads", (payload) => {
    expect(() => ("url" in payload ? processPageJobSchema : runCrawlJobSchema).parse(payload)).toThrow();
  });

  it("pins terminal states", () => {
    expect(terminalCrawlStatusSchema.options).toEqual(["COMPLETED", "PARTIAL", "FAILED", "CANCELLED"]);
  });
});
