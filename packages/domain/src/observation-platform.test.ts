import { describe, expect, it } from "vitest";
import {
  defineObservationDefinition,
  defineCollectorDefinition,
  createPlatformRecordId,
  defineObservationRecord,
  PLATFORM_LIMITS,
} from "./observation-platform.js";

describe("observation platform definitions", () => {
  it("accepts exact engineering definition identity and computes an immutable schema hash", () => {
    const definition = defineObservationDefinition({
      key: "page.metadata",
      version: "1.0.0",
      schema: { type: "object", properties: { title: { type: "string" } }, required: ["title"], additionalProperties: false },
      scopes: ["page"],
      statuses: ["observed", "partial", "not_collected", "failed"],
      sensitivity: "public",
      retentionClass: "evidence",
    });

    expect(definition.schemaSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(definition.key).toBe("page.metadata");
    expect(PLATFORM_LIMITS.maxPayloadBytes).toBe(1_048_576);
  });

  it.each(["Page.Metadata", "page..metadata", "page metadata", "page."])("rejects invalid key %s", (key) => {
    expect(() => defineObservationDefinition({
      key, version: "1.0.0", schema: { type: "null" }, scopes: ["page"], statuses: ["observed"],
      sensitivity: "public", retentionClass: "evidence",
    })).toThrow("definition key");
  });

  it.each(["1.0", "v1.0.0", "1.0.0-beta", "1.0.0+build"])("rejects unsupported version %s", (version) => {
    expect(() => defineObservationDefinition({
      key: "page.metadata", version, schema: { type: "null" }, scopes: ["page"], statuses: ["observed"],
      sensitivity: "public", retentionClass: "evidence",
    })).toThrow("version");
  });

  it("rejects a collector that declares no observation capability", () => {
    expect(() => defineCollectorDefinition({
      key: "crawler.html", version: "1.0.0", configurationSchema: { type: "object" }, capabilities: [], executionMode: "worker",
    })).toThrow("capability");
  });

  it("creates namespace-separated stable platform record IDs", () => {
    expect(createPlatformRecordId("subject", ["run-1", "page-1"]))
      .toBe(createPlatformRecordId("subject", ["run-1", "page-1"]));
    expect(createPlatformRecordId("subject", ["run-1", "page-1"]))
      .not.toBe(createPlatformRecordId("execution", ["run-1", "page-1"]));
  });

  it("enforces available and unavailable observation state pairings", () => {
    expect(defineObservationRecord({ status: "observed", payload: { title: "Example" }, reasons: [] }).payload).toEqual({ title: "Example" });
    expect(() => defineObservationRecord({ status: "partial", payload: { title: "Example" }, reasons: [] })).toThrow("reason");
    expect(() => defineObservationRecord({ status: "failed", payload: {}, reasons: ["fetch_failed"] })).toThrow("null payload");
    expect(defineObservationRecord({ status: "not_collected", payload: null, reasons: ["disabled"] }).payload).toBeNull();
  });
});
