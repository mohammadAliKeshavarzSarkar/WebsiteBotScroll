import { Ajv2020, type ErrorObject } from "ajv/dist/2020.js";
import * as formatsModule from "ajv-formats";
import type { FormatsPlugin } from "ajv-formats";

import schema from "../schema/seo-crawl-evidence/0.1.0/schema.json" with { type: "json" };
import { validateEvidenceSemantics } from "./semantic-validation.js";
import type { EvidenceDocument, ValidationIssue, ValidationResult } from "./types.js";

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

export type { EvidenceDocument, ValidationIssue, ValidationResult } from "./types.js";
export { COLLECTION_STATUSES, EVIDENCE_SCHEMA_VERSION } from "./types.js";
