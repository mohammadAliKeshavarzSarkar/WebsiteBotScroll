import { describe, expect, it } from "vitest";
import { defineExportProjection } from "./export-projection.js";

describe("export projections", () => {
  it("pins accepted observation and diagnostic definition versions", () => {
    const definition = defineExportProjection({
      key: "platform.neutral-json", version: "1.0.0", format: "neutral-json", mediaType: "application/json",
      acceptedObservationDefinitions: [{ key: "page.metadata", version: "1.0.0" }],
      acceptedDiagnosticRules: [{ key: "seo.title.consistency", version: "1.0.0" }],
    });
    expect(definition.identitySha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects duplicate or unversioned dependencies", () => {
    expect(() => defineExportProjection({ key: "platform.neutral-json", version: "1.0.0", format: "neutral-json", mediaType: "application/json", acceptedObservationDefinitions: [{ key: "page.metadata", version: "latest" }], acceptedDiagnosticRules: [] })).toThrow("dependency");
  });
});
