import { hashDefinitionSchema, type ObservationScope } from "./observation-platform.js";

export interface DiagnosticRuleDefinitionInput {
  key: string;
  version: string;
  policyVersion: string;
  configurationSchema: unknown;
  acceptedInputs: Array<{ observationKey: string; observationVersion: string; scopes: readonly ObservationScope[]; required: boolean }>;
  outcomes: string[];
  supportsUnavailableInputs: boolean;
}
export interface DiagnosticExecutionInput {
  id: string; runId: string; ruleKey: string; ruleVersion: string; stableKey: string; attempt: number;
  configuration: unknown; startedAt: string;
}
export interface DiagnosticResultInput {
  id: string; runId: string; executionId: string; subjectId: string; sequence: number; outcome: string;
  messageData: Record<string, unknown>; limitations: string[]; inputObservationIds: string[]; collectedAt: string;
}

const KEY = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const unique = (items: readonly string[]): boolean => new Set(items).size === items.length;

export function defineDiagnosticRule(input: DiagnosticRuleDefinitionInput) {
  if (!KEY.test(input.key) || !VERSION.test(input.version)) throw new TypeError("diagnostic rule identity is invalid");
  if (input.policyVersion.trim() === "") throw new TypeError("diagnostic policy version is required");
  if (input.acceptedInputs.length === 0) throw new TypeError("diagnostic input is required");
  if (input.outcomes.length === 0 || !unique(input.outcomes) || input.outcomes.some((outcome) => !KEY.test(outcome))) throw new TypeError("diagnostic outcome vocabulary is invalid");
  for (const accepted of input.acceptedInputs) {
    if (!KEY.test(accepted.observationKey) || !VERSION.test(accepted.observationVersion) || accepted.scopes.length === 0 || !unique(accepted.scopes)) throw new TypeError("diagnostic input definition is invalid");
  }
  return {
    ...input,
    acceptedInputs: input.acceptedInputs.map((accepted) => ({ ...accepted, scopes: [...accepted.scopes] })),
    outcomes: [...input.outcomes],
    configurationSchemaSha256: hashDefinitionSchema(input.configurationSchema),
  };
}

export function defineDiagnosticResult<T extends { outcome: string; limitations: string[] }>(input: T): T {
  if (input.outcome === "unknown" && input.limitations.length === 0) throw new TypeError("unknown diagnostic outcome requires a limitation");
  return { ...input, limitations: [...input.limitations] };
}
