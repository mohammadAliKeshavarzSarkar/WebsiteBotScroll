import { createHash } from "node:crypto";

export interface ExportProjectionDefinitionInput {
  key: string; version: string; format: string; mediaType: string;
  acceptedObservationDefinitions: Array<{ key: string; version: string }>;
  acceptedDiagnosticRules: Array<{ key: string; version: string }>;
}
const KEY = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const stable = (value: unknown): unknown => Array.isArray(value) ? value.map(stable) : value !== null && typeof value === "object"
  ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stable(item)])) : value;

export function defineExportProjection(input: ExportProjectionDefinitionInput) {
  if (!KEY.test(input.key) || !VERSION.test(input.version) || input.format.trim() === "" || input.mediaType.trim() === "") throw new TypeError("export projection identity is invalid");
  const dependencies = [...input.acceptedObservationDefinitions, ...input.acceptedDiagnosticRules];
  if (dependencies.some(({ key, version }) => !KEY.test(key) || !VERSION.test(version))) throw new TypeError("export projection dependency is invalid");
  const observationIdentities = input.acceptedObservationDefinitions.map(({ key, version }) => `${key}@${version}`);
  const diagnosticIdentities = input.acceptedDiagnosticRules.map(({ key, version }) => `${key}@${version}`);
  if (new Set(observationIdentities).size !== observationIdentities.length || new Set(diagnosticIdentities).size !== diagnosticIdentities.length) throw new TypeError("export projection dependency is duplicated");
  const defined = { ...input, acceptedObservationDefinitions: input.acceptedObservationDefinitions.map((item) => ({ ...item })), acceptedDiagnosticRules: input.acceptedDiagnosticRules.map((item) => ({ ...item })) };
  return { ...defined, identitySha256: createHash("sha256").update(JSON.stringify(stable(defined)), "utf8").digest("hex") };
}
