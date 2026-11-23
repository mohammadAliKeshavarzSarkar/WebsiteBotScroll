import { describe, expect, it } from "vitest";
import { PLATFORM_OBSERVATION_DEFINITIONS, PLATFORM_CRAWLER_DEFINITION } from "./definitions.js";
import { compileBoundedSchema, validateBoundedPayload } from "@website-bot-scroll/observation-schema";
import { buildPlatformPageBatch, computeObservationParityDigest, legacyMethodToDefinitionKey } from "./platform-sink.js";

const provenance = { collector: "html", version: "1.0.0", collectedAt: "2026-11-21T00:00:00.000Z" };

describe("crawler platform migration adapter", () => {
  it("publishes the exact current collector definition set", () => {
    expect(PLATFORM_OBSERVATION_DEFINITIONS.map(({ key }) => key)).toEqual([
      "page.http", "page.metadata", "page.headings", "page.structured_data", "page.content", "page.links", "page.rendering",
    ]);
    expect(PLATFORM_CRAWLER_DEFINITION.capabilities).toHaveLength(7);
    const metadata = PLATFORM_OBSERVATION_DEFINITIONS.find(({ key }) => key === "page.metadata")!;
    expect(validateBoundedPayload(compileBoundedSchema(metadata.schema), { title: 42 }).valid).toBe(false);
    expect(validateBoundedPayload(compileBoundedSchema(metadata.schema), { title: "Title", unexpected: true }).valid).toBe(false);
  });

  it("maps legacy methods without changing payloads, order, Unicode, or unavailable states", () => {
    const observations = [
      { id: "legacy-http", method: "http", status: "observed" as const, value: { transactions: ["tx-1"], final_transaction_id: "tx-1" }, reasons: [], provenance },
      { id: "legacy-meta", method: "metadata", status: "observed" as const, value: { title: "عنوان فارسی" }, reasons: [], provenance },
      { id: "legacy-render", method: "rendering", status: "not_collected" as const, value: null, reasons: ["browser_rendering_disabled"], provenance },
    ];
    const batch = buildPlatformPageBatch({ organizationId: "org-1", runId: "run-1", pageId: "page-1", attempt: 0, observations });
    expect(batch.records.map(({ definitionKey }) => definitionKey)).toEqual(["page.http", "page.metadata", "page.rendering"]);
    expect(batch.records[0]?.payload).toEqual(observations[0]?.value);
    expect(batch.records[1]?.payload).toEqual({ title: "عنوان فارسی" });
    expect(batch.records[2]).toMatchObject({ status: "not_collected", payload: null, reasons: ["browser_rendering_disabled"] });
    expect(batch.records.map(({ id }) => id)).toEqual(["legacy-http", "legacy-meta", "legacy-render"]);
    expect(buildPlatformPageBatch({ organizationId: "org-1", runId: "run-1", pageId: "page-1", attempt: 0, observations })).toEqual(batch);
  });

  it("computes parity over mapped content without mutating legacy rows", () => {
    const legacy = [{ id: "legacy-meta", method: "metadata", status: "observed" as const, value: { title: "Original" }, reasons: [], provenance }];
    const before = structuredClone(legacy);
    const platform = buildPlatformPageBatch({ organizationId: "org", runId: "run", pageId: "page", attempt: 0, observations: legacy }).records;
    expect(computeObservationParityDigest(legacy)).toBe(computeObservationParityDigest(platform));
    expect(legacy).toEqual(before);
    expect(legacyMethodToDefinitionKey("metadata")).toBe("page.metadata");
    expect(() => legacyMethodToDefinitionKey("future")).toThrow("unsupported legacy observation method");
  });
});
