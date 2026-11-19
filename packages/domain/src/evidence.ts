import { createHash } from "node:crypto";

export const EVIDENCE_ID_NAMESPACES = [
  "run",
  "page",
  "transaction",
  "observation",
  "error",
  "limitation",
] as const;

export type EvidenceIdNamespace = (typeof EVIDENCE_ID_NAMESPACES)[number];
export type EvidenceCollectionStatus =
  | "observed"
  | "partial"
  | "unknown"
  | "not_collected"
  | "failed"
  | "unsupported"
  | "not_applicable";

export interface EvidenceRunConfiguration {
  authorizationRef: string;
  seedUrls: string[];
  allowedHosts: string[];
  includePatterns?: string[];
  excludePatterns?: string[];
  maxPages: number;
  maxDepth: number;
  maxDurationMs: number;
  maxResponseBytes?: number;
  normalizationPolicyVersion: string;
  extractorVersion: string;
}

export interface PageIdentityInput {
  discoveredUrl: string;
  requestedUrl: string;
  normalizedUrl: string;
  finalUrl: string;
  canonicalUrls: string[];
}

export type EvidenceHeaderName =
  | "location"
  | "content-type"
  | "x-robots-tag"
  | "link"
  | "content-language"
  | "content-length"
  | "content-encoding"
  | "retry-after"
  | "cache-control"
  | "vary"
  | "etag"
  | "last-modified"
  | "age";

export interface EvidenceHeaderInput {
  name: EvidenceHeaderName;
  values: string[];
}

export interface HttpTransactionInput {
  id: string;
  requestUrl: string;
  responseUrl: string;
  method: "GET" | "HEAD";
  statusCode: number;
  startedAt: string;
  finishedAt: string;
  headers: EvidenceHeaderInput[];
  transferredBytes: number;
  decodedBytes: number;
  redirectTo: string | null;
}

export interface EvidenceProvenanceInput {
  collector: string;
  version: string;
  collectedAt?: string;
}

export interface ObservationInput {
  id: string;
  method: string;
  status: EvidenceCollectionStatus;
  value: unknown;
  reasons: string[];
  provenance: EvidenceProvenanceInput;
  fieldOverrides?: Array<{ path: string; provenance: EvidenceProvenanceInput }>;
  rawHash?: string;
  normalizedHash?: string;
}

export interface EvidenceErrorInput {
  id: string;
  stage: string;
  code: string;
  message: string;
  occurredAt: string;
  retryable: boolean;
  pageId?: string;
  observationId?: string;
}

export interface EvidenceLimitationInput {
  id: string;
  code: string;
  message: string;
  pageId?: string;
}

const requireNonEmpty = (value: string, field: string): void => {
  if (value.trim() === "") throw new TypeError(`${field} must not be empty`);
};

export function assertSafeEvidenceInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value)) throw new TypeError(`${field} must be a safe integer`);
  return value;
}

export function createEvidenceId(namespace: EvidenceIdNamespace, parts: readonly string[]): string {
  if (parts.length === 0) throw new TypeError("evidence ID parts must not be empty");
  const hash = createHash("sha256");
  const writePart = (part: string): void => {
    const bytes = Buffer.from(part, "utf8");
    const length = Buffer.allocUnsafe(4);
    length.writeUInt32BE(bytes.byteLength);
    hash.update(length);
    hash.update(bytes);
  };
  writePart(namespace);
  parts.forEach(writePart);
  return `${namespace}-${hash.digest("hex")}`;
}

export function definePageIdentity(input: PageIdentityInput): PageIdentityInput {
  requireNonEmpty(input.discoveredUrl, "discoveredUrl");
  requireNonEmpty(input.requestedUrl, "requestedUrl");
  requireNonEmpty(input.normalizedUrl, "normalizedUrl");
  requireNonEmpty(input.finalUrl, "finalUrl");
  return { ...input, canonicalUrls: [...input.canonicalUrls] };
}

export function defineHttpTransaction(input: HttpTransactionInput): HttpTransactionInput {
  requireNonEmpty(input.id, "transaction id");
  assertSafeEvidenceInteger(input.statusCode, "statusCode");
  assertSafeEvidenceInteger(input.transferredBytes, "transferredBytes");
  assertSafeEvidenceInteger(input.decodedBytes, "decodedBytes");
  return {
    ...input,
    headers: input.headers.map((header) => ({ ...header, values: [...header.values] })),
  };
}

export function defineObservation(input: ObservationInput): ObservationInput {
  requireNonEmpty(input.id, "observation id");
  const available = input.status === "observed" || input.status === "partial";
  if (available && input.value === null) {
    throw new TypeError(`${input.status} observations require a non-null value`);
  }
  if (!available && input.value !== null) {
    throw new TypeError(`${input.status} observations require a null value`);
  }
  if (!available && input.reasons.length === 0) {
    throw new TypeError(`${input.status} observations require at least one reason`);
  }
  return {
    ...input,
    reasons: [...input.reasons],
    provenance: { ...input.provenance },
    ...(input.fieldOverrides
      ? { fieldOverrides: input.fieldOverrides.map((override) => ({ ...override, provenance: { ...override.provenance } })) }
      : {}),
  };
}
