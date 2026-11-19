import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createPrismaClient } from "../client.js";
import { DefinitionRepository } from "./definitions.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;
const observation = {
  key: "page.metadata", version: "1.0.0",
  schema: { type: "object", properties: { title: { type: "string" } }, required: ["title"], additionalProperties: false },
  scopes: ["page" as const], statuses: ["observed" as const, "not_collected" as const],
  sensitivity: "public" as const, retentionClass: "evidence",
};

describeDatabase("DefinitionRepository", () => {
  const prisma = createPrismaClient(databaseUrl!);
  const publisher = new DefinitionRepository(prisma, { canPublish: true });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "collector_capabilities", "collector_definitions", "observation_definitions" CASCADE');
  });
  afterAll(async () => prisma.$disconnect());

  it("requires internal publication authority", async () => {
    const reader = new DefinitionRepository(prisma, { canPublish: false });
    await expect(reader.publishObservationDefinition(observation)).rejects.toThrow("publication authority");
  });

  it("publishes idempotently and rejects semantic conflict at the same identity", async () => {
    const first = await publisher.publishObservationDefinition(observation);
    const second = await publisher.publishObservationDefinition(observation);
    expect(second.id).toBe(first.id);
    await expect(publisher.publishObservationDefinition({ ...observation, scopes: ["site"] }))
      .rejects.toThrow("definition conflict");
  });

  it("publishes collectors only for existing observation capabilities", async () => {
    await expect(publisher.publishCollectorDefinition({
      key: "crawler.html", version: "1.0.0", configurationSchema: { type: "object" }, executionMode: "worker",
      capabilities: [{ observationKey: "page.metadata", observationVersion: "1.0.0" }],
    })).rejects.toThrow("capability definition");
    await publisher.publishObservationDefinition(observation);
    const collector = await publisher.publishCollectorDefinition({
      key: "crawler.html", version: "1.0.0", configurationSchema: { type: "object" }, executionMode: "worker",
      capabilities: [{ observationKey: "page.metadata", observationVersion: "1.0.0" }],
    });
    expect(collector.capabilities).toEqual([{ observationKey: "page.metadata", observationVersion: "1.0.0" }]);
  });

  it("rejects a changed capability set for an existing collector identity", async () => {
    await publisher.publishObservationDefinition(observation);
    await publisher.publishObservationDefinition({ ...observation, key: "site.summary", scopes: ["site"] });
    const collector = {
      key: "crawler.html", version: "1.0.0", configurationSchema: { type: "object" }, executionMode: "worker" as const,
      capabilities: [{ observationKey: "page.metadata", observationVersion: "1.0.0" }],
    };
    await publisher.publishCollectorDefinition(collector);
    await expect(publisher.publishCollectorDefinition({
      ...collector, capabilities: [{ observationKey: "site.summary", observationVersion: "1.0.0" }],
    })).rejects.toThrow("definition conflict");
  });

  it("deprecates without mutating published definition content", async () => {
    await publisher.publishObservationDefinition(observation);
    await publisher.deprecateObservationDefinition(observation.key, observation.version);
    expect((await publisher.getObservationDefinition(observation.key, observation.version))?.status).toBe("deprecated");
    expect((await publisher.getObservationDefinition(observation.key, observation.version))?.schema).toEqual(observation.schema);
  });

  it("converges concurrent identical publication to one row", async () => {
    const results = await Promise.all(Array.from({ length: 4 }, () => publisher.publishObservationDefinition(observation)));
    expect(new Set(results.map(({ id }) => id)).size).toBe(1);
    expect(await prisma.observationDefinition.count()).toBe(1);
  });
});
