import type { CollectorDefinitionInput, ObservationDefinitionInput } from "@website-bot-scroll/domain/observation-platform";

const statuses: ObservationDefinitionInput["statuses"] = ["observed", "partial", "unknown", "not_collected", "failed", "unsupported", "not_applicable"];
const definition = (key: string): ObservationDefinitionInput => ({
  key, version: "1.0.0", schema: {}, scopes: ["page"], statuses, sensitivity: "public", retentionClass: "evidence",
});

export const PLATFORM_OBSERVATION_DEFINITIONS: ObservationDefinitionInput[] = [
  "page.http", "page.metadata", "page.headings", "page.structured_data", "page.content", "page.links", "page.rendering",
].map(definition);

export const PLATFORM_CRAWLER_DEFINITION: CollectorDefinitionInput = {
  key: "crawler.http-html",
  version: "1.0.0",
  configurationSchema: { type: "object", additionalProperties: false },
  capabilities: PLATFORM_OBSERVATION_DEFINITIONS.map(({ key, version }) => ({ observationKey: key, observationVersion: version })),
  executionMode: "worker",
};
