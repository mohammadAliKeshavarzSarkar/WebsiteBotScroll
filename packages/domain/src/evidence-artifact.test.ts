import { describe, expect, it } from "vitest";
import { describeArtifact, validateArtifactPolicy } from "./evidence-artifact.js";

describe("evidence artifacts", () => {
  it("derives identity and byte length from exact bytes", () => {
    const descriptor = describeArtifact(new TextEncoder().encode("سلام"), "text/plain; charset=utf-8");
    expect(descriptor.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(descriptor.byteLength).toBe(8);
    expect(descriptor.mediaType).toBe("text/plain; charset=utf-8");
  });

  it("rejects disallowed media, sensitivity, retention, and byte limits", () => {
    const policy = { maxBytes: 4, allowedMediaTypes: ["text/plain"], allowedSensitivities: ["public" as const], allowedRetentionClasses: ["ephemeral"] };
    expect(() => validateArtifactPolicy({ byteLength: 5, mediaType: "text/plain", sensitivity: "public", retentionClass: "ephemeral" }, policy)).toThrow("byte limit");
    expect(() => validateArtifactPolicy({ byteLength: 1, mediaType: "text/html", sensitivity: "public", retentionClass: "ephemeral" }, policy)).toThrow("media type");
    expect(() => validateArtifactPolicy({ byteLength: 1, mediaType: "text/plain", sensitivity: "sensitive", retentionClass: "ephemeral" }, policy)).toThrow("sensitivity");
    expect(() => validateArtifactPolicy({ byteLength: 1, mediaType: "text/plain", sensitivity: "public", retentionClass: "forever" }, policy)).toThrow("retention");
  });
});
