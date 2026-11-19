import { describe, expect, it } from "vitest";
import { compileBoundedSchema, validateBoundedPayload } from "./schema-policy.js";

describe("bounded observation schemas", () => {
  it("compiles a closed local schema and validates a real payload", () => {
    const compiled = compileBoundedSchema({ type: "object", properties: { title: { type: "string" } }, required: ["title"], additionalProperties: false });
    expect(validateBoundedPayload(compiled, { title: "عنوان فارسی" })).toEqual({ valid: true });
    expect(validateBoundedPayload(compiled, { title: 12 })).toMatchObject({ valid: false });
  });

  it.each([
    { $ref: "https://example.com/schema.json" },
    { $dynamicRef: "#node" },
    { type: "object", properties: Object.fromEntries(Array.from({ length: 1_025 }, (_, index) => [`p${index}`, { type: "string" }])) },
  ])("rejects remote, dynamic, or excessive schema structures", (schema) => {
    expect(() => compileBoundedSchema(schema)).toThrow();
  });

  it("rejects payloads beyond aggregate depth and array limits", () => {
    const compiled = compileBoundedSchema({});
    let deep: unknown = "leaf";
    for (let index = 0; index < 33; index += 1) deep = { child: deep };
    expect(validateBoundedPayload(compiled, deep)).toMatchObject({ valid: false, issues: [{ code: "payload_depth_exceeded" }] });
    expect(validateBoundedPayload(compiled, Array.from({ length: 10_001 }, () => null))).toMatchObject({ valid: false, issues: [{ code: "payload_array_items_exceeded" }] });
  });
});
