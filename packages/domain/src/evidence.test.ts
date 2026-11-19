import { describe, expect, it } from "vitest";
import {
  assertSafeEvidenceInteger,
  createEvidenceId,
  defineHttpTransaction,
  defineObservation,
  definePageIdentity,
} from "./evidence.js";

describe("crawl evidence domain", () => {
  it("creates deterministic namespace-separated IDs without delimiter collisions", () => {
    expect(createEvidenceId("page", ["run-1", "https://example.test/"]))
      .toBe(createEvidenceId("page", ["run-1", "https://example.test/"]));
    expect(createEvidenceId("page", ["ab", "c"]))
      .not.toBe(createEvidenceId("page", ["a", "bc"]));
    expect(createEvidenceId("page", ["run-1", "url"]))
      .not.toBe(createEvidenceId("observation", ["run-1", "url"]));
  });

  it("preserves separate discovered, requested, normalized, final, and canonical URLs", () => {
    const identity = definePageIdentity({
      discoveredUrl: "https://example.test/start",
      requestedUrl: "https://example.test/start#fragment",
      normalizedUrl: "https://example.test/start",
      finalUrl: "https://example.test/final",
      canonicalUrls: ["https://example.test/canonical"],
    });

    expect(identity).toEqual({
      discoveredUrl: "https://example.test/start",
      requestedUrl: "https://example.test/start#fragment",
      normalizedUrl: "https://example.test/start",
      finalUrl: "https://example.test/final",
      canonicalUrls: ["https://example.test/canonical"],
    });
  });

  it("preserves repeated header value order", () => {
    const transaction = defineHttpTransaction({
      id: "tx-1",
      requestUrl: "https://example.test/",
      responseUrl: "https://example.test/",
      method: "GET",
      statusCode: 200,
      startedAt: "2026-11-19T00:00:00.000Z",
      finishedAt: "2026-11-19T00:00:00.010Z",
      headers: [{ name: "link", values: ["</fa>; rel=alternate", "</en>; rel=alternate"] }],
      transferredBytes: 12,
      decodedBytes: 12,
      redirectTo: null,
    });

    expect(transaction.headers[0]?.values).toEqual(["</fa>; rel=alternate", "</en>; rel=alternate"]);
  });

  it("enforces observation status and value pairing", () => {
    expect(defineObservation({
      id: "obs-1",
      method: "metadata",
      status: "observed",
      value: { title: "صفحه" },
      reasons: [],
      provenance: { collector: "html", version: "1" },
    }).status).toBe("observed");

    expect(() => defineObservation({
      id: "obs-2",
      method: "metadata",
      status: "not_collected",
      value: {},
      reasons: ["stage_not_run"],
      provenance: { collector: "html", version: "1" },
    })).toThrow("not_collected observations require a null value");
  });

  it("rejects integers outside JavaScript's safe range", () => {
    expect(assertSafeEvidenceInteger(Number.MAX_SAFE_INTEGER, "transferredBytes")).toBe(Number.MAX_SAFE_INTEGER);
    expect(() => assertSafeEvidenceInteger(Number.MAX_SAFE_INTEGER + 1, "transferredBytes"))
      .toThrow("transferredBytes must be a safe integer");
    expect(() => assertSafeEvidenceInteger(1.5, "transferredBytes"))
      .toThrow("transferredBytes must be a safe integer");
  });
});
