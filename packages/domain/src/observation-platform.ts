import { createHash } from "node:crypto";

export const PLATFORM_LIMITS = {
  maxSchemaBytes: 1_048_576,
  maxPayloadBytes: 1_048_576,
  maxDepth: 32,
  maxObjectProperties: 1_024,
  maxArrayItems: 10_000,
  maxArtifactBytes: 50 * 1_048_576,
  maxExecutionArtifactBytes: 250 * 1_048_576,
} as const;

export type DefinitionStatus = "draft" | "published" | "deprecated";
export type ObservationScope = "run" | "page" | "resource" | "site" | "cross_page";
export type PlatformCollectionStatus = "observed" | "partial" | "unknown" | "not_collected" | "failed" | "unsupported" | "not_applicable";
export type PlatformRecordNamespace = "subject" | "execution" | "observation";
export type ObservationSubjectKind = ObservationScope;
export type ObservationExecutionStatus = "pending" | "running" | "completed" | "partial" | "failed" | "cancelled";
export interface PlatformValidationIssue { code: string; path: string; message: string }
export type PlatformValidationResult = { valid: true } | { valid: false; issues: PlatformValidationIssue[] };

export interface ObservationDefinitionInput {
  key: string;
  version: string;
  schema: unknown;
  scopes: ObservationScope[];
  statuses: PlatformCollectionStatus[];
  sensitivity: "public" | "internal" | "sensitive";
  retentionClass: string;
}

export interface CollectorDefinitionInput {
  key: string;
  version: string;
  configurationSchema: unknown;
  capabilities: Array<{ observationKey: string; observationVersion: string }>;
  executionMode: "worker" | "renderer" | "external";
}

export interface ObservationSubjectInput { id: string; runId: string; kind: ObservationSubjectKind; identity: Record<string, unknown>; members?: string[] }
export interface ObservationExecutionInput {
  id: string; runId: string; collectorKey: string; collectorVersion: string; stableKey: string; attempt: number;
  trigger: string; configuration: unknown; startedAt: string; parentExecutionId?: string;
}
export interface ObservationRecordStateInput { status: PlatformCollectionStatus; payload: unknown; reasons: string[] }
export interface ObservationRecordInput extends ObservationRecordStateInput {
  id: string; runId: string; subjectId: string; executionId: string; definitionKey: string; definitionVersion: string;
  sequence: number; provenance: Record<string, unknown>; collectedAt: string;
}

const KEY = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const stable = (value: unknown): unknown => Array.isArray(value)
  ? value.map(stable)
  : value !== null && typeof value === "object"
    ? Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, stable(item)]))
    : value;

export const hashDefinitionSchema = (schema: unknown): string => createHash("sha256").update(JSON.stringify(stable(schema)), "utf8").digest("hex");

export function createPlatformRecordId(namespace: PlatformRecordNamespace, parts: readonly string[]): string {
  if (parts.length === 0) throw new TypeError("platform record ID parts are required");
  const hash = createHash("sha256");
  for (const part of [namespace, ...parts]) {
    const bytes = Buffer.from(part, "utf8");
    const length = Buffer.allocUnsafe(4); length.writeUInt32BE(bytes.length);
    hash.update(length); hash.update(bytes);
  }
  return `${namespace}-${hash.digest("hex")}`;
}

export function defineObservationRecord<T extends ObservationRecordStateInput>(input: T): T {
  const available = input.status === "observed" || input.status === "partial";
  if (available && input.payload === null) throw new TypeError(`${input.status} requires a non-null payload`);
  if (!available && input.payload !== null) throw new TypeError(`${input.status} requires a null payload`);
  if ((input.status === "partial" || !available) && input.reasons.length === 0) throw new TypeError(`${input.status} requires a reason`);
  return { ...input, reasons: [...input.reasons] };
}

const assertIdentity = (key: string, version: string): void => {
  if (!KEY.test(key)) throw new TypeError("definition key is invalid");
  if (!VERSION.test(version)) throw new TypeError("definition version is invalid");
};

export function defineObservationDefinition(input: ObservationDefinitionInput): ObservationDefinitionInput & { schemaSha256: string } {
  assertIdentity(input.key, input.version);
  if (input.scopes.length === 0) throw new TypeError("definition requires a scope");
  if (input.statuses.length === 0) throw new TypeError("definition requires a status");
  return { ...input, scopes: [...input.scopes], statuses: [...input.statuses], schemaSha256: hashDefinitionSchema(input.schema) };
}

export function defineCollectorDefinition(input: CollectorDefinitionInput): CollectorDefinitionInput & { configurationSchemaSha256: string } {
  assertIdentity(input.key, input.version);
  if (input.capabilities.length === 0) throw new TypeError("collector requires a capability");
  input.capabilities.forEach(({ observationKey, observationVersion }) => assertIdentity(observationKey, observationVersion));
  return { ...input, capabilities: input.capabilities.map((item) => ({ ...item })), configurationSchemaSha256: hashDefinitionSchema(input.configurationSchema) };
}
