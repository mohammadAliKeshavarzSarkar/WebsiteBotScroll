import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createPrismaClient } from "../client.js";
import { ArtifactRepository, FilesystemArtifactStore } from "./artifacts.js";
import { DefinitionRepository } from "./definitions.js";
import { ObservationRepository } from "./observation-records.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

describeDatabase("governed evidence artifacts", () => {
  const prisma = createPrismaClient(databaseUrl!);
  const definitions = new DefinitionRepository(prisma, { canPublish: true });
  const observations = new ObservationRepository(prisma);
  let organizationId: string;
  let runId: string;
  let observationId: string;
  let root: string;
  const policy = { maxBytes: 1024, allowedMediaTypes: ["text/plain"], allowedSensitivities: ["public" as const], allowedRetentionClasses: ["evidence"] };

  beforeEach(async () => {
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "observation_artifacts", "evidence_artifacts", "platform_observations", "observation_subjects", "observation_executions", "collector_capabilities", "collector_definitions", "observation_definitions", "crawl_runs", "sites", "organizations" CASCADE');
    organizationId = randomUUID(); const siteId = randomUUID(); runId = randomUUID(); observationId = "observation-1";
    await prisma.organization.create({ data: { id: organizationId, name: "Owner" } });
    await prisma.site.create({ data: { id: siteId, organizationId, name: "Site", origin: "https://example.test" } });
    await prisma.crawlRun.create({ data: { id: runId, organizationId, siteId, trigger: "MANUAL", idempotencyKey: randomUUID(), status: "RUNNING", scope: {}, limits: {} } });
    await definitions.publishObservationDefinition({ key: "run.artifact", version: "1.0.0", schema: { type: "object", additionalProperties: false }, scopes: ["run"], statuses: ["observed"], sensitivity: "public", retentionClass: "evidence" });
    await definitions.publishCollectorDefinition({ key: "collector.artifact", version: "1.0.0", configurationSchema: { type: "object", additionalProperties: false }, capabilities: [{ observationKey: "run.artifact", observationVersion: "1.0.0" }], executionMode: "worker" });
    await observations.appendSubject(organizationId, { id: "subject-run", runId, kind: "run", identity: { runId } });
    await observations.startExecution(organizationId, { id: "execution-artifact", runId, collectorKey: "collector.artifact", collectorVersion: "1.0.0", stableKey: "artifact", attempt: 0, trigger: "manual", configuration: {}, startedAt: "2026-11-21T00:00:00.000Z" });
    await observations.appendObservation(organizationId, { id: observationId, runId, subjectId: "subject-run", executionId: "execution-artifact", definitionKey: "run.artifact", definitionVersion: "1.0.0", sequence: 0, status: "observed", payload: {}, reasons: [], provenance: { collector: "collector.artifact", version: "1.0.0" }, collectedAt: "2026-11-21T00:00:01.000Z" });
    root = await mkdtemp(join(tmpdir(), "wbs-artifacts-"));
  });
  afterAll(async () => prisma.$disconnect());

  it("stores duplicate content once at a server-selected content address", async () => {
    const store = new FilesystemArtifactStore(root);
    const bytes = new TextEncoder().encode("evidence");
    const first = await store.put(bytes, { ...policy, mediaType: "text/plain", sensitivity: "public", retentionClass: "evidence" });
    const second = await store.put(bytes, { ...policy, mediaType: "text/plain", sensitivity: "public", retentionClass: "evidence" });
    expect(second).toEqual(first);
    expect(new TextDecoder().decode(await readFile(first.locator))).toBe("evidence");
    expect(first.locator.startsWith(root)).toBe(true);
  });

  it("detects occupied hash paths and removes temporary files after failure", async () => {
    const store = new FilesystemArtifactStore(root);
    const bytes = new TextEncoder().encode("collision");
    const descriptor = await store.put(bytes, { ...policy, mediaType: "text/plain", sensitivity: "public", retentionClass: "evidence" });
    await writeFile(descriptor.locator, "different");
    await expect(store.put(bytes, { ...policy, mediaType: "text/plain", sensitivity: "public", retentionClass: "evidence" })).rejects.toThrow("content-address collision");
    expect((await readdir(root, { recursive: true })).some((name) => String(name).endsWith(".tmp"))).toBe(false);
  });

  it("persists tenant-owned metadata and ordered observation links", async () => {
    const repository = new ArtifactRepository(prisma, { maxExecutionBytes: 2048 });
    const one = await repository.register(organizationId, runId, { sha256: "a".repeat(64), byteLength: 10, mediaType: "text/plain", locator: "sha256/aa/a", sensitivity: "public", retentionClass: "evidence" });
    const two = await repository.register(organizationId, runId, { sha256: "b".repeat(64), byteLength: 20, mediaType: "text/plain", locator: "sha256/bb/b", sensitivity: "public", retentionClass: "evidence" });
    await repository.linkObservation(organizationId, observationId, one.id, "source", 0);
    await repository.linkObservation(organizationId, observationId, two.id, "screenshot", 1);
    expect((await repository.listObservationArtifacts(organizationId, observationId)).map(({ role }) => role)).toEqual(["source", "screenshot"]);
  });

  it("rejects cross-tenant, unavailable, frozen, and over-budget links", async () => {
    const repository = new ArtifactRepository(prisma, { maxExecutionBytes: 20 });
    const artifact = await repository.register(organizationId, runId, { sha256: "c".repeat(64), byteLength: 15, mediaType: "text/plain", locator: "sha256/cc/c", sensitivity: "public", retentionClass: "evidence" });
    await expect(repository.linkObservation(randomUUID(), observationId, artifact.id, "source", 0)).rejects.toThrow("ownership");
    await prisma.evidenceArtifact.update({ where: { id: artifact.id }, data: { availability: "unavailable" } });
    await expect(repository.linkObservation(organizationId, observationId, artifact.id, "source", 0)).rejects.toThrow("unavailable");
    await prisma.evidenceArtifact.update({ where: { id: artifact.id }, data: { availability: "available" } });
    await repository.linkObservation(organizationId, observationId, artifact.id, "source", 0);
    const second = await repository.register(organizationId, runId, { sha256: "d".repeat(64), byteLength: 6, mediaType: "text/plain", locator: "sha256/dd/d", sensitivity: "public", retentionClass: "evidence" });
    await expect(repository.linkObservation(organizationId, observationId, second.id, "extra", 1)).rejects.toThrow("execution artifact byte limit");
    await prisma.crawlRun.update({ where: { id: runId }, data: { frozenAt: new Date() } });
    await expect(repository.linkObservation(organizationId, observationId, second.id, "extra", 1)).rejects.toThrow("frozen");
    await expect(repository.register(organizationId, runId, { sha256: "e".repeat(64), byteLength: 1, mediaType: "text/plain", locator: "sha256/ee/e", sensitivity: "public", retentionClass: "evidence" })).rejects.toThrow("frozen");
  });
});
