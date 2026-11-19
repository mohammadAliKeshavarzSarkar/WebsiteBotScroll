import {
  defineCollectorDefinition,
  defineObservationDefinition,
  type CollectorDefinitionInput,
  type ObservationDefinitionInput,
} from "@website-bot-scroll/domain/observation-platform";
import { compileBoundedSchema } from "@website-bot-scroll/observation-schema";
import { Prisma, type ObservationDefinition } from "../../generated/prisma/client.js";
import type { DatabaseClient } from "../client.js";

type PublicationAccess = { canPublish: boolean };
const json = (value: unknown): Prisma.InputJsonValue => value as Prisma.InputJsonValue;
const normalize = (value: unknown): unknown => Array.isArray(value)
  ? value.map(normalize)
  : value !== null && typeof value === "object"
    ? Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, normalize(item)]))
    : value;
const stable = (value: unknown): string => JSON.stringify(normalize(value));

export class DefinitionRepository {
  constructor(private readonly prisma: DatabaseClient, private readonly access: PublicationAccess) {}

  private requirePublisher(): void {
    if (!this.access.canPublish) throw new Error("definition publication authority required");
  }

  async getObservationDefinition(key: string, version: string) {
    return this.prisma.observationDefinition.findUnique({ where: { key_version: { key, version } } });
  }

  async publishObservationDefinition(input: ObservationDefinitionInput): Promise<ObservationDefinition> {
    this.requirePublisher();
    const defined = defineObservationDefinition(input);
    compileBoundedSchema(defined.schema);
    const existing = await this.getObservationDefinition(defined.key, defined.version);
    if (existing) {
      if (existing.schemaSha256 !== defined.schemaSha256 || stable(existing.scopes) !== stable(defined.scopes) || stable(existing.statuses) !== stable(defined.statuses) || existing.sensitivity !== defined.sensitivity || existing.retentionClass !== defined.retentionClass) throw new Error("definition conflict");
      return existing;
    }
    try {
      return await this.prisma.observationDefinition.create({ data: {
        key: defined.key, version: defined.version, schema: json(defined.schema), schemaSha256: defined.schemaSha256,
        scopes: defined.scopes, statuses: defined.statuses, sensitivity: defined.sensitivity, retentionClass: defined.retentionClass,
      } });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
      return this.publishObservationDefinition(input);
    }
  }

  async deprecateObservationDefinition(key: string, version: string) {
    this.requirePublisher();
    return this.prisma.observationDefinition.update({ where: { key_version: { key, version } }, data: { status: "deprecated", deprecatedAt: new Date() } });
  }

  async publishCollectorDefinition(input: CollectorDefinitionInput) {
    this.requirePublisher();
    const defined = defineCollectorDefinition(input);
    compileBoundedSchema(defined.configurationSchema);
    const observations = await Promise.all(defined.capabilities.map(({ observationKey: key, observationVersion: version }) => this.getObservationDefinition(key, version)));
    if (observations.some((item) => !item)) throw new Error("collector capability definition not found");
    const existing = await this.prisma.collectorDefinition.findUnique({
      where: { key_version: { key: defined.key, version: defined.version } },
      include: { capabilities: { orderBy: { position: "asc" }, include: { observation: true } } },
    });
    if (existing) {
      const capabilities = existing.capabilities.map(({ observation }) => ({ observationKey: observation.key, observationVersion: observation.version }));
      if (existing.configurationSchemaSha256 !== defined.configurationSchemaSha256 || existing.executionMode !== defined.executionMode || stable(capabilities) !== stable(defined.capabilities)) throw new Error("definition conflict");
      return { ...existing, capabilities };
    }
    const created = await this.prisma.collectorDefinition.create({ data: {
      key: defined.key, version: defined.version, configurationSchema: json(defined.configurationSchema),
      configurationSchemaSha256: defined.configurationSchemaSha256, executionMode: defined.executionMode,
      capabilities: { create: observations.map((observation, position) => ({ observationDefinitionId: observation!.id, position })) },
    }, include: { capabilities: { orderBy: { position: "asc" }, include: { observation: true } } } });
    return { ...created, capabilities: created.capabilities.map(({ observation }) => ({ observationKey: observation.key, observationVersion: observation.version })) };
  }
}
