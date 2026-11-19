import { describe, expect, it } from "vitest";

import { processPageJobSchema, runCrawlJobSchema, terminalCrawlStatusSchema } from "./contracts.js";

const ids = {
  organizationId: "11111111-1111-4111-8111-111111111111",
  siteId: "22222222-2222-4222-8222-222222222222",
  crawlRunId: "33333333-3333-4333-8333-333333333333",
};
const evidenceControl = {
  authorizationRef: "auth-stage-a2",
  limits: { maxPages: 2, maxDepth: 1, maxDurationMs: 10_000, maxResponseBytes: 1_000_000 },
  producerVersion: "a".repeat(40),
  normalizationPolicyVersion: "normalize/1",
  extractorVersion: "extract/1",
};

describe("queue contracts", () => {
  it("accepts identifier-only crawl jobs", () => {
    expect(runCrawlJobSchema.parse({ ...ids, ...evidenceControl, trigger: "MANUAL", idempotencyKey: "manual-2026-11-18" }))
      .toEqual({ ...ids, ...evidenceControl, trigger: "MANUAL", idempotencyKey: "manual-2026-11-18" });
    expect(processPageJobSchema.parse({ ...ids, url: "https://example.com/a", depth: 2 })).toMatchObject({ depth: 2 });
  });

  it.each([
    { ...ids, ...evidenceControl, trigger: "MANUAL", idempotencyKey: "x", password: "secret" },
    { ...ids, ...evidenceControl, trigger: "MANUAL", idempotencyKey: "x", content: "<html>" },
    { ...ids, ...evidenceControl, trigger: "INVALID", idempotencyKey: "x" },
    { ...ids, url: "http://127.0.0.1", depth: 9 },
  ])("rejects malformed or expansive payloads", (payload) => {
    expect(() => ("url" in payload ? processPageJobSchema : runCrawlJobSchema).parse(payload)).toThrow();
  });

  it("requires a manual authorization reference, bounded limits, and exact producer versions", () => {
    expect(() => runCrawlJobSchema.parse({ ...ids, trigger: "MANUAL", idempotencyKey: "x" })).toThrow();
    expect(() => runCrawlJobSchema.parse({ ...ids, ...evidenceControl, trigger: "SCHEDULED", idempotencyKey: "x" })).toThrow();
    expect(() => runCrawlJobSchema.parse({ ...ids, ...evidenceControl, limits: { ...evidenceControl.limits, maxPages: 10_001 }, trigger: "MANUAL", idempotencyKey: "x" })).toThrow();
  });

  it("pins terminal states", () => {
    expect(terminalCrawlStatusSchema.options).toEqual(["COMPLETED", "PARTIAL", "FAILED", "CANCELLED"]);
  });
});
