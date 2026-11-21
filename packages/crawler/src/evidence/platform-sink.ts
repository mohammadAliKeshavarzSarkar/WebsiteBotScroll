import { createHash } from "node:crypto";
import type { ObservationInput } from "@website-bot-scroll/domain/evidence";
import {
  createPlatformRecordId,
  type ObservationExecutionInput,
  type ObservationRecordInput,
  type ObservationSubjectInput,
} from "@website-bot-scroll/domain/observation-platform";

const METHOD_KEYS: Readonly<Record<string, string>> = {
  http: "page.http", metadata: "page.metadata", headings: "page.headings", structured_data: "page.structured_data",
  content: "page.content", links: "page.links", rendering: "page.rendering",
};

export function legacyMethodToDefinitionKey(method: string): string {
  const key = METHOD_KEYS[method];
  if (!key) throw new Error(`unsupported legacy observation method: ${method}`);
  return key;
}

export interface PlatformPageBatch {
  subject: ObservationSubjectInput;
  execution: ObservationExecutionInput;
  records: ObservationRecordInput[];
}

export function buildPlatformPageBatch(input: {
  organizationId: string;
  runId: string;
  pageId: string;
  attempt: number;
  observations: ObservationInput[];
}): PlatformPageBatch {
  const subjectId = createPlatformRecordId("subject", [input.runId, "page", input.pageId]);
  const executionId = createPlatformRecordId("execution", [input.runId, input.pageId, "crawler.http-html", String(input.attempt)]);
  return {
    subject: { id: subjectId, runId: input.runId, kind: "page", identity: { pageId: input.pageId } },
    execution: {
      id: executionId, runId: input.runId, collectorKey: "crawler.http-html", collectorVersion: "1.0.0",
      stableKey: `crawler.http-html:${input.pageId}`, attempt: input.attempt, trigger: input.attempt === 0 ? "collection" : "retry",
      configuration: {}, startedAt: input.observations.map(({ provenance }) => provenance.collectedAt).find((value): value is string => typeof value === "string") ?? new Date(0).toISOString(),
    },
    records: input.observations.map((observation, sequence) => ({
      id: createPlatformRecordId("observation", [input.runId, input.pageId, legacyMethodToDefinitionKey(observation.method), String(input.attempt)]),
      runId: input.runId, subjectId, executionId, definitionKey: legacyMethodToDefinitionKey(observation.method), definitionVersion: "1.0.0",
      sequence, status: observation.status, payload: observation.value, reasons: [...observation.reasons], provenance: { ...observation.provenance },
      collectedAt: observation.provenance.collectedAt ?? new Date(0).toISOString(),
    })),
  };
}

const normalize = (value: unknown): unknown => Array.isArray(value) ? value.map(normalize) : value !== null && typeof value === "object"
  ? Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, normalize(item)])) : value;

export function computeObservationParityDigest(observations: Array<ObservationInput | ObservationRecordInput>): string {
  const comparable = observations.map((item) => {
    const legacy = "method" in item;
    return {
      key: legacy ? legacyMethodToDefinitionKey(item.method) : item.definitionKey,
      status: item.status,
      payload: legacy ? item.value : item.payload,
      reasons: item.reasons,
      provenance: item.provenance,
    };
  }).sort((left, right) => left.key.localeCompare(right.key));
  return createHash("sha256").update(JSON.stringify(normalize(comparable)), "utf8").digest("hex");
}
