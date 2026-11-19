import { Ajv2020, type AnySchema, type ValidateFunction } from "ajv/dist/2020.js";
import { PLATFORM_LIMITS, type PlatformValidationIssue, type PlatformValidationResult } from "@website-bot-scroll/domain/observation-platform";

export interface CompiledObservationSchema { validate: ValidateFunction }

interface Shape { depth: number; properties: number; arrayItems: number }
const measure = (value: unknown, depth = 0): Shape => {
  if (Array.isArray(value)) return value.reduce<Shape>((total, item) => {
    const child = measure(item, depth + 1);
    return { depth: Math.max(total.depth, child.depth), properties: total.properties + child.properties, arrayItems: total.arrayItems + child.arrayItems };
  }, { depth, properties: 0, arrayItems: value.length });
  if (value !== null && typeof value === "object") return Object.values(value).reduce<Shape>((total, item) => {
    const child = measure(item, depth + 1);
    return { depth: Math.max(total.depth, child.depth), properties: total.properties + child.properties, arrayItems: total.arrayItems + child.arrayItems };
  }, { depth, properties: Object.keys(value).length, arrayItems: 0 });
  return { depth, properties: 0, arrayItems: 0 };
};

const issue = (code: string, message: string): PlatformValidationResult => ({ valid: false, issues: [{ code, path: "", message }] });

const inspectSchema = (schema: unknown): void => {
  if (Buffer.byteLength(JSON.stringify(schema), "utf8") > PLATFORM_LIMITS.maxSchemaBytes) throw new TypeError("schema bytes exceeded");
  const shape = measure(schema);
  if (shape.depth > PLATFORM_LIMITS.maxDepth) throw new TypeError("schema depth exceeded");
  if (shape.properties > PLATFORM_LIMITS.maxObjectProperties) throw new TypeError("schema properties exceeded");
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) return value.forEach(visit);
    if (value === null || typeof value !== "object") return;
    for (const [key, item] of Object.entries(value)) {
      if (key === "$dynamicRef" || key === "$dynamicAnchor") throw new TypeError("dynamic schema references are prohibited");
      if (key === "$ref" && (typeof item !== "string" || !item.startsWith("#"))) throw new TypeError("remote schema references are prohibited");
      visit(item);
    }
  };
  visit(schema);
};

export function compileBoundedSchema(schema: unknown): CompiledObservationSchema {
  inspectSchema(schema);
  const ajv = new Ajv2020({ strict: true, allErrors: true, coerceTypes: false, useDefaults: false, removeAdditional: false });
  return { validate: ajv.compile(schema as AnySchema) };
}

export function validateBoundedPayload(compiled: CompiledObservationSchema, payload: unknown): PlatformValidationResult {
  if (Buffer.byteLength(JSON.stringify(payload), "utf8") > PLATFORM_LIMITS.maxPayloadBytes) return issue("payload_bytes_exceeded", "payload byte limit exceeded");
  const shape = measure(payload);
  if (shape.depth > PLATFORM_LIMITS.maxDepth) return issue("payload_depth_exceeded", "payload depth limit exceeded");
  if (shape.properties > PLATFORM_LIMITS.maxObjectProperties) return issue("payload_properties_exceeded", "payload property limit exceeded");
  if (shape.arrayItems > PLATFORM_LIMITS.maxArrayItems) return issue("payload_array_items_exceeded", "payload array item limit exceeded");
  if (compiled.validate(payload)) return { valid: true };
  const issues: PlatformValidationIssue[] = (compiled.validate.errors ?? []).map((error) => ({ code: `schema_${error.keyword}`, path: error.instancePath, message: error.message ?? "schema validation failed" }));
  return { valid: false, issues };
}
