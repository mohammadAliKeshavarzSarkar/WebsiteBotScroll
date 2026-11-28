import { randomUUID } from "node:crypto";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createPrismaClient } from "@website-bot-scroll/db";
import { FilesystemArtifactStore } from "@website-bot-scroll/db/artifacts";
import { ExportProjectionRepository, SnapshotRepository } from "@website-bot-scroll/db/export-projections";
import { exportFrozenSnapshot } from "../src/export-run.js";
import { verifyExchangePair } from "../src/verify-exchange.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;
const revision = "a".repeat(40);

describeDatabase("real persisted synthetic exchange", () => {
  const prisma = createPrismaClient(databaseUrl!);
  let organizationId: string; let runId: string; let authorizationId: string;

  beforeEach(async () => {
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "projection_executions", "platform_snapshots", "export_projection_definitions", "diagnostic_rule_definitions", "collector_definitions", "observation_definitions", "evidence_artifacts", "crawl_runs", "export_authorizations", "sites", "organizations" CASCADE');
    organizationId = randomUUID(); runId = randomUUID(); authorizationId = `authorization-${randomUUID()}`; const siteId = randomUUID();
    await prisma.organization.create({ data: { id: organizationId, name: "Synthetic owner" } });
    await prisma.site.create({ data: { id: siteId, organizationId, name: "Synthetic Persian site", origin: "https://example.test" } });
    await prisma.exportAuthorization.create({ data: { id: authorizationId, organizationId, siteId, description: "Stage A.2 authorized synthetic exchange", scope: { seed_urls: ["https://example.test/start"], allowed_hosts: ["example.test"] } } });
    await prisma.crawlRun.create({ data: {
      id: runId, organizationId, siteId, authorizationId, trigger: "MANUAL", idempotencyKey: randomUUID(), status: "COMPLETED",
      startedAt: new Date("2026-11-23T00:00:00.000Z"), finishedAt: new Date("2026-11-23T00:00:02.000Z"),
      scope: { seed_urls: ["https://example.test/start"], allowed_hosts: ["example.test"] }, limits: { max_pages: 1, max_depth: 0, max_duration_ms: 5000 },
      producerVersion: revision, normalizationPolicyVersion: "1.0.0", extractorVersion: "1.0.0", discoveredCount: 1, attemptedCount: 1, collectedCount: 1, failedCount: 0, unattemptedCount: 0, stopReason: "frontier_exhausted",
    } });
  });
  afterAll(async () => prisma.$disconnect());

  it("freezes, projects, stores, exports, and independently verifies nonempty collected evidence", async () => {
    const httpDefinition = await prisma.observationDefinition.create({ data: { key: "page.http", version: "1.0.0", schema: {}, schemaSha256: "1".repeat(64), scopes: ["page"], statuses: ["observed"], sensitivity: "public", retentionClass: "evidence" } });
    const metadataDefinition = await prisma.observationDefinition.create({ data: { key: "page.metadata", version: "1.0.0", schema: {}, schemaSha256: "2".repeat(64), scopes: ["page"], statuses: ["observed"], sensitivity: "public", retentionClass: "evidence" } });
    const additionalDefinitions = await Promise.all(["headings", "structured_data", "content", "links", "rendering"].map((method, index) => prisma.observationDefinition.create({ data: { key: `page.${method}`, version: "1.0.0", schema: {}, schemaSha256: String(index + 5).repeat(64), scopes: ["page"], statuses: ["observed", "not_collected"], sensitivity: "public", retentionClass: "evidence" } })));
    const allDefinitions = [httpDefinition, metadataDefinition, ...additionalDefinitions];
    const collector = await prisma.collectorDefinition.create({ data: { key: "crawler.http-html", version: "1.0.0", configurationSchema: {}, configurationSchemaSha256: "3".repeat(64), executionMode: "worker", capabilities: { create: allDefinitions.map((definition, position) => ({ observationDefinitionId: definition.id, position })) } } });
    const rule = await prisma.diagnosticRuleDefinition.create({ data: { key: "seo.title", version: "1.0.0", policyVersion: "2026-11", configurationSchema: {}, configurationSchemaSha256: "4".repeat(64), outcomes: ["pass"], supportsUnavailableInputs: false, inputs: { create: { observationDefinitionId: metadataDefinition.id, position: 0, scopes: ["page"], required: true } } } });
    await prisma.evidencePage.create({ data: {
      id: "page-1", crawlRunId: runId, position: 0, depth: 0, discoveredUrl: "https://example.test/start", requestedUrl: "https://example.test/start", normalizedUrl: "https://example.test/start", finalUrl: "https://example.test/fa", canonicalUrls: ["https://example.test/fa"],
      transactions: { create: [
        { id: "tx-redirect", position: 0, method: "GET", requestUrl: "https://example.test/start", responseUrl: "https://example.test/start", statusCode: 301, startedAt: new Date("2026-11-23T00:00:00.100Z"), finishedAt: new Date("2026-11-23T00:00:00.300Z"), transferredBytes: 120n, decodedBytes: 0n, redirectTo: "https://example.test/fa", headers: { create: { position: 0, name: "location", values: { create: { position: 0, value: "https://example.test/fa" } } } } },
        { id: "tx-final", position: 1, method: "GET", requestUrl: "https://example.test/fa", responseUrl: "https://example.test/fa", statusCode: 200, startedAt: new Date("2026-11-23T00:00:00.400Z"), finishedAt: new Date("2026-11-23T00:00:01.000Z"), transferredBytes: 512n, decodedBytes: 1024n, headers: { create: { position: 0, name: "link", values: { create: [{ position: 0, value: "</fa>; rel=alternate" }, { position: 1, value: "</en>; rel=alternate" }] } } } },
      ] },
    } });
    await prisma.evidenceLimitation.create({ data: { id: "limitation-1", crawlRunId: runId, pageId: "page-1", code: "rendering_not_enabled", message: "Browser rendering was outside this authorized collection." } });
    await prisma.observationSubject.create({ data: { id: "subject-page-1", organizationId, crawlRunId: runId, position: 0, kind: "page", identity: { pageId: "page-1" } } });
    await prisma.observationExecution.create({ data: { id: "collection-1", organizationId, crawlRunId: runId, collectorDefinitionId: collector.id, stableKey: "page-1", attempt: 0, trigger: "collection", configuration: {}, status: "completed", startedAt: new Date("2026-11-23T00:00:00.000Z"), finishedAt: new Date("2026-11-23T00:00:01.200Z") } });
    await prisma.platformObservation.createMany({ data: [
      { id: "legacy-http", organizationId, crawlRunId: runId, subjectId: "subject-page-1", executionId: "collection-1", observationDefinitionId: httpDefinition.id, sequence: 0, status: "observed", payload: { transactions: ["tx-redirect", "tx-final"], final_transaction_id: "tx-final" }, reasons: [], provenance: { collector: "http", version: "1.0.0", collectedAt: "2026-11-23T00:00:01.000Z" }, collectedAt: new Date("2026-11-23T00:00:01.000Z") },
      { id: "legacy-metadata", organizationId, crawlRunId: runId, subjectId: "subject-page-1", executionId: "collection-1", observationDefinitionId: metadataDefinition.id, sequence: 1, status: "observed", payload: { title: "عنوان فارسی", meta_description: "توضیحات", canonical_urls: ["https://example.test/fa"], robots: ["index", "follow"], language: "fa" }, reasons: [], provenance: { collector: "html", version: "1.0.0", collectedAt: "2026-11-23T00:00:01.100Z" }, collectedAt: new Date("2026-11-23T00:00:01.100Z") },
      { id: "legacy-headings", organizationId, crawlRunId: runId, subjectId: "subject-page-1", executionId: "collection-1", observationDefinitionId: additionalDefinitions[0]!.id, sequence: 2, status: "observed", payload: [{ level: 1, text: "عنوان فارسی" }], reasons: [], provenance: { collector: "html", version: "1.0.0", collectedAt: "2026-11-23T00:00:01.100Z" }, collectedAt: new Date("2026-11-23T00:00:01.100Z") },
      { id: "legacy-structured", organizationId, crawlRunId: runId, subjectId: "subject-page-1", executionId: "collection-1", observationDefinitionId: additionalDefinitions[1]!.id, sequence: 3, status: "observed", payload: [], reasons: [], provenance: { collector: "html", version: "1.0.0", collectedAt: "2026-11-23T00:00:01.100Z" }, collectedAt: new Date("2026-11-23T00:00:01.100Z") },
      { id: "legacy-content", organizationId, crawlRunId: runId, subjectId: "subject-page-1", executionId: "collection-1", observationDefinitionId: additionalDefinitions[2]!.id, sequence: 4, status: "observed", payload: { raw_sha256: "5".repeat(64), normalized_sha256: "6".repeat(64), hash_method_version: "sha256-visible-text/1", visible_text_summary: "عنوان فارسی" }, reasons: [], provenance: { collector: "html", version: "1.0.0", collectedAt: "2026-11-23T00:00:01.100Z" }, collectedAt: new Date("2026-11-23T00:00:01.100Z") },
      { id: "legacy-links", organizationId, crawlRunId: runId, subjectId: "subject-page-1", executionId: "collection-1", observationDefinitionId: additionalDefinitions[3]!.id, sequence: 5, status: "observed", payload: [], reasons: [], provenance: { collector: "html", version: "1.0.0", collectedAt: "2026-11-23T00:00:01.100Z" }, collectedAt: new Date("2026-11-23T00:00:01.100Z") },
      { id: "legacy-rendering", organizationId, crawlRunId: runId, subjectId: "subject-page-1", executionId: "collection-1", observationDefinitionId: additionalDefinitions[4]!.id, sequence: 6, status: "not_collected", reasons: ["browser_rendering_disabled"], provenance: { collector: "html", version: "1.0.0", collectedAt: "2026-11-23T00:00:01.100Z" }, collectedAt: new Date("2026-11-23T00:00:01.100Z") },
    ] });
    const platformRows = await prisma.platformObservation.findMany({ where: { crawlRunId: runId }, include: { definition: true } });
    await prisma.evidenceObservation.createMany({ data: platformRows.map((row) => ({
      id: `legacy-${row.id}`, pageId: "page-1", method: row.definition.key.replace(/^page\./, ""), status: row.status,
      value: row.payload as never, reasons: row.reasons as never, provenance: row.provenance as never,
    })) });
    await prisma.diagnosticExecution.create({ data: { id: "diagnostic-1", organizationId, crawlRunId: runId, ruleDefinitionId: rule.id, stableKey: "title", attempt: 0, configuration: {}, status: "completed", startedAt: new Date("2026-11-23T00:00:01.300Z"), finishedAt: new Date("2026-11-23T00:00:01.400Z") } });
    await prisma.diagnosticResult.create({ data: { id: "diagnostic-result-1", organizationId, crawlRunId: runId, executionId: "diagnostic-1", subjectId: "subject-page-1", sequence: 0, outcome: "pass", messageData: { title: "عنوان فارسی" }, limitations: [], collectedAt: new Date("2026-11-23T00:00:01.350Z"), inputs: { create: { observationId: "legacy-metadata", position: 0 } } } });

    const snapshots = new SnapshotRepository(prisma);
    const parity = await snapshots.inspectObservationParity(organizationId, runId);
    await snapshots.recordParityCheckpoint(organizationId, runId, { checkpoint: { pages: 1, observations: 7 }, parityDigest: parity.legacyDigest });
    await snapshots.switchToGeneralizedReads(organizationId, runId);
    const snapshot = await snapshots.freezePlatformSnapshot(organizationId, runId);
    const artifactRoot = await mkdtemp(join(tmpdir(), "wbs-real-artifacts-")); const exchangeRoot = await mkdtemp(join(tmpdir(), "wbs-real-exchange-"));
    const store = new FilesystemArtifactStore(artifactRoot); const projections = new ExportProjectionRepository(prisma, { canPublish: true }, store);
    await projections.publishProjection({ key: "seo-crawl-evidence", version: "0.1.0", format: "seo-crawl-evidence/0.1.0", mediaType: "application/json", acceptedObservationDefinitions: allDefinitions.map(({ key, version }) => ({ key, version })), acceptedDiagnosticRules: [{ key: "seo.title", version: "1.0.0" }] });
    const receipt = await exportFrozenSnapshot({ snapshot, destinationDirectory: exchangeRoot, evidenceFilename: `${runId}.evidence.json`, manifestFilename: `${runId}.manifest.json`, producerCommit: revision });
    const evidenceBytes = await readFile(receipt.evidencePath);
    const execution = await projections.runProjection(organizationId, snapshot.id, { id: "projection-1", key: "seo-crawl-evidence", version: "0.1.0", stableKey: "canonical", attempt: 0, bytes: evidenceBytes, sha256: receipt.evidenceSha256 });
    const verified = await verifyExchangePair({ evidencePath: receipt.evidencePath, manifestPath: receipt.manifestPath, expectedAuthorizationRef: authorizationId });
    const artifact = await prisma.evidenceArtifact.findUniqueOrThrow({ where: { id: execution.outputArtifactId } });
    expect(verified).toMatchObject({ runId, evidenceSha256: receipt.evidenceSha256 });
    expect(Buffer.from(await store.read(artifact.locator))).toEqual(evidenceBytes);
    expect(Buffer.from(evidenceBytes).toString("utf8")).toContain("عنوان فارسی");
    expect(await prisma.projectionExecution.count({ where: { snapshotId: snapshot.id } })).toBe(1);
  });
});
