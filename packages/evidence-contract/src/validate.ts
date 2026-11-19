import { Ajv2020, type ErrorObject } from "ajv/dist/2020.js";
import * as formatsModule from "ajv-formats";
import type { FormatsPlugin } from "ajv-formats";

import schema from "../schema/seo-crawl-evidence/0.1.0/schema.json" with { type: "json" };
import { validateEvidenceSemantics } from "./semantic-validation.js";
import type { EvidenceDocument, EvidenceParseResult, ValidationIssue, ValidationResult } from "./types.js";

const ajv = new Ajv2020({
  strict: true,
  allErrors: true,
  coerceTypes: false,
  useDefaults: false,
  removeAdditional: false,
});
const addFormats = formatsModule.default as unknown as FormatsPlugin;
addFormats(ajv);

const validateStructure = ajv.compile(schema);

const toIssue = (error: ErrorObject): ValidationIssue => ({
  code: `schema.${error.keyword}`,
  path: error.instancePath || "/",
  message: error.message ?? "Schema validation failed",
});

export const validateEvidence = (input: unknown): ValidationResult => {
  if (validateStructure(input)) {
    const semanticErrors = validateEvidenceSemantics(input as EvidenceDocument);
    return semanticErrors.length === 0 ? { valid: true } : { valid: false, errors: semanticErrors };
  }

  return { valid: false, errors: (validateStructure.errors ?? []).map(toIssue) };
};

const findDuplicateJsonKey = (input: string): { key: string; position: number } | undefined => {
  const stack: Array<{ kind: "object"; keys: Set<string> } | { kind: "array" }> = [];
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (character === "{") {
      stack.push({ kind: "object", keys: new Set() });
    } else if (character === "[") {
      stack.push({ kind: "array" });
    } else if (character === "}" || character === "]") {
      stack.pop();
    } else if (character === '"') {
      const start = index;
      index += 1;
      while (index < input.length) {
        if (input[index] === "\\") {
          index += 2;
          continue;
        }
        if (input[index] === '"') break;
        index += 1;
      }
      const rawString = input.slice(start, index + 1);
      let next = index + 1;
      while (/\s/.test(input[next] ?? "")) next += 1;
      const frame = stack.at(-1);
      if (input[next] === ":" && frame?.kind === "object") {
        const key = JSON.parse(rawString) as string;
        if (frame.keys.has(key)) return { key, position: start };
        frame.keys.add(key);
      }
    }
  }
  return undefined;
};

export const parseEvidenceJson = (input: string): EvidenceParseResult => {
  const duplicate = findDuplicateJsonKey(input);
  if (duplicate) {
    return {
      valid: false,
      errors: [{ code: "json.duplicate_key", path: "/", message: `Duplicate JSON member '${duplicate.key}' at offset ${duplicate.position}.` }],
    };
  }

  let document: unknown;
  try {
    document = JSON.parse(input) as unknown;
  } catch (error) {
    return {
      valid: false,
      errors: [{ code: "json.parse", path: "/", message: error instanceof Error ? error.message : "Invalid JSON." }],
    };
  }
  const validation = validateEvidence(document);
  return validation.valid ? { valid: true, document: document as EvidenceDocument } : validation;
};

export type { EvidenceDocument, EvidenceParseResult, ValidationIssue, ValidationResult } from "./types.js";
export { COLLECTION_STATUSES, EVIDENCE_SCHEMA_VERSION } from "./types.js";
