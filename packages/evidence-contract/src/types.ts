export const EVIDENCE_SCHEMA_VERSION = "0.1.0" as const;

export const COLLECTION_STATUSES = [
  "observed",
  "partial",
  "unknown",
  "not_collected",
  "failed",
  "unsupported",
  "not_applicable",
] as const;

export type CollectionStatus = (typeof COLLECTION_STATUSES)[number];

export interface ValidationIssue {
  code: string;
  path: string;
  message: string;
}

export type ValidationResult =
  | { valid: true }
  | { valid: false; errors: ValidationIssue[] };

export type EvidenceDocument = Record<string, unknown>;
