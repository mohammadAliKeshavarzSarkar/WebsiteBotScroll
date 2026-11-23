import type { CollectorDefinitionInput, ObservationDefinitionInput } from "@website-bot-scroll/domain/observation-platform";

const statuses: ObservationDefinitionInput["statuses"] = ["observed", "partial", "unknown", "not_collected", "failed", "unsupported", "not_applicable"];
const nullableString = { type: ["string", "null"] } as const;
const closedObject = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, required, additionalProperties: false });
const stringArray = { type: "array", items: { type: "string" } };

const schemas: Record<string, Record<string, unknown>> = {
  "page.http": closedObject({ transactions: stringArray, final_transaction_id: nullableString }, ["transactions"]),
  "page.metadata": closedObject({ title: nullableString, meta_description: nullableString, canonical_urls: stringArray, robots: stringArray, language: nullableString }),
  "page.headings": { type: "array", items: closedObject({ level: { type: "integer", minimum: 1, maximum: 6 }, text: { type: "string" } }, ["level", "text"]) },
  "page.structured_data": { type: "array", items: closedObject({ format: { const: "json-ld" }, parsed: { type: "boolean" }, types: stringArray, error: nullableString, raw_hash: { type: "string", pattern: "^[a-f0-9]{64}$" } }, ["format", "parsed", "types", "error", "raw_hash"]) },
  "page.content": closedObject({ raw_sha256: { type: "string", pattern: "^[a-f0-9]{64}$" }, normalized_sha256: { type: "string", pattern: "^[a-f0-9]{64}$" }, hash_method_version: { type: "string" }, visible_text_summary: { type: "string" } }, ["raw_sha256", "normalized_sha256", "hash_method_version", "visible_text_summary"]),
  "page.links": { type: "array", items: closedObject({ id: { type: "string" }, target_url: { type: "string" }, kind: { enum: ["internal", "external"] }, discovery_method: { const: "anchor" }, target_page_id: nullableString, inspected: { type: "boolean" } }, ["id", "target_url", "kind", "discovery_method", "target_page_id", "inspected"]) },
  "page.rendering": closedObject({ engine: { type: "string" }, engine_version: { type: "string" }, final_url: { type: "string" }, timing_policy: { type: "object" } }),
};

export const PLATFORM_OBSERVATION_DEFINITIONS: ObservationDefinitionInput[] = Object.entries(schemas).map(([key, schema]) => ({
  key, version: "1.0.0", schema, scopes: ["page"], statuses, sensitivity: "public", retentionClass: "evidence",
}));

export const PLATFORM_CRAWLER_DEFINITION: CollectorDefinitionInput = {
  key: "crawler.http-html",
  version: "1.0.0",
  configurationSchema: { type: "object", additionalProperties: false },
  capabilities: PLATFORM_OBSERVATION_DEFINITIONS.map(({ key, version }) => ({ observationKey: key, observationVersion: version })),
  executionMode: "worker",
};
