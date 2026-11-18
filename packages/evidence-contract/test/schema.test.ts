import { describe, expect, it } from "vitest";

import { validateEvidence } from "../src/validate.js";

const minimalDocument = () => ({
  contract: { name: "seo-crawl-evidence", version: "0.1.0" },
  producer: {
    name: "WebsiteBotScroll",
    version: "0.1.0",
    schema_version: "0.1.0",
    normalization_policy_version: "1.0.0",
  },
  run: {
    id: "run-1",
    trigger: "manual",
    lifecycle: "completed",
    started_at: "2026-11-18T10:00:00Z",
    finished_at: "2026-11-18T10:01:00Z",
    scope: { seed_urls: ["https://example.com/"], allowed_hosts: ["example.com"] },
    limits: { max_pages: 10, max_depth: 2, max_duration_ms: 60000 },
    coverage: { discovered: 1, attempted: 1, collected: 0, failed: 1 },
    stop_reason: "frontier_exhausted",
    limitations: [],
  },
  pages: [],
  diagnostics: { id: "observation-diagnostics", status: "not_collected", value: null, reasons: ["stage_not_run"] },
  errors: [
    {
      id: "error-1",
      stage: "http",
      code: "network_error",
      message: "Synthetic failure",
      occurred_at: "2026-11-18T10:00:30Z",
      retryable: true,
    },
  ],
});

describe("seo-crawl-evidence structural validation", () => {
  it("accepts the minimal complete envelope without mutating it", () => {
    const input = minimalDocument();
    const before = structuredClone(input);

    expect(validateEvidence(input)).toEqual({ valid: true });
    expect(input).toEqual(before);
  });

  it.each([
    ["unsupported version", (value: ReturnType<typeof minimalDocument>) => { value.contract.version = "0.2.0"; }],
    ["unknown property", (value: ReturnType<typeof minimalDocument>) => { Object.assign(value.run, { surprise: true }); }],
    ["coerced number", (value: ReturnType<typeof minimalDocument>) => { Object.assign(value.run.limits, { max_pages: "10" }); }],
    ["malformed timestamp", (value: ReturnType<typeof minimalDocument>) => { value.run.started_at = "yesterday"; }],
    ["unavailable state with value", (value: ReturnType<typeof minimalDocument>) => { Object.assign(value.diagnostics, { value: [] }); }],
    ["unavailable state without reasons", (value: ReturnType<typeof minimalDocument>) => { value.diagnostics.reasons = []; }],
    ["non-finite number", (value: ReturnType<typeof minimalDocument>) => { value.run.limits.max_pages = Number.POSITIVE_INFINITY; }],
  ])("rejects %s", (_name, mutate) => {
    const input = minimalDocument();
    mutate(input);
    expect(validateEvidence(input).valid).toBe(false);
  });

  it("rejects an observed group with a null value", () => {
    const input = minimalDocument();
    Object.assign(input.diagnostics, { status: "observed", value: null, reasons: [] });
    expect(validateEvidence(input).valid).toBe(false);
  });
});
