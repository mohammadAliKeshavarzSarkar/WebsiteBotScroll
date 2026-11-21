import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { SYNTHETIC_RENDERER_DEFINITION } from "@website-bot-scroll/domain/renderer-session";
import { createPrismaClient } from "../client.js";
import { ArtifactRepository } from "./artifacts.js";
import { DefinitionRepository } from "./definitions.js";
import { ObservationRepository } from "./observation-records.js";
import { RendererSessionRepository } from "./renderer-sessions.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;
const sessionInput = (executionId: string) => ({
  executionId, engine: "synthetic" as const, engineVersion: "1.0.0", viewport: { width: 1440, height: 900, deviceScaleFactor: 1 },
  locale: "fa-IR", userAgent: "WebsiteBotScroll Renderer/1.0",
  timingPolicy: { navigationTimeoutMs: 30_000, settleDelayMs: 500, waitUntil: "networkidle" as const },
});

describeDatabase("RendererSessionRepository", () => {
  const prisma = createPrismaClient(databaseUrl!);
  const definitions = new DefinitionRepository(prisma, { canPublish: true });
  const observations = new ObservationRepository(prisma);
  const renderers = new RendererSessionRepository(prisma);
  const artifacts = new ArtifactRepository(prisma);
  let organizationId: string;
  let runId: string;

  beforeEach(async () => {
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "renderer_sessions", "observation_executions", "collector_capabilities", "collector_definitions", "observation_definitions", "crawl_runs", "sites", "organizations" CASCADE');
    organizationId = randomUUID(); const siteId = randomUUID(); runId = randomUUID();
    await prisma.organization.create({ data: { id: organizationId, name: "Owner" } });
    await prisma.site.create({ data: { id: siteId, organizationId, name: "Site", origin: "https://example.test" } });
    await prisma.crawlRun.create({ data: { id: runId, organizationId, siteId, trigger: "MANUAL", idempotencyKey: randomUUID(), status: "RUNNING", scope: {}, limits: {} } });
    await definitions.publishObservationDefinition({ key: "page.rendering", version: "1.0.0", schema: {}, scopes: ["page"], statuses: ["observed", "partial", "failed", "not_collected"], sensitivity: "public", retentionClass: "evidence" });
    await definitions.publishCollectorDefinition(SYNTHETIC_RENDERER_DEFINITION);
  });
  afterAll(async () => prisma.$disconnect());

  async function start(executionId: string, attempt: number) {
    await observations.startExecution(organizationId, { id: executionId, runId, collectorKey: SYNTHETIC_RENDERER_DEFINITION.key, collectorVersion: SYNTHETIC_RENDERER_DEFINITION.version, stableKey: "render:page-1", attempt, trigger: attempt === 0 ? "collection" : "retry", configuration: {}, startedAt: `2026-11-21T00:00:0${attempt}.000Z` });
  }

  it("persists an immutable session only for a renderer execution", async () => {
    await start("execution-1", 0);
    await renderers.createSession(organizationId, sessionInput("execution-1"));
    await renderers.createSession(organizationId, sessionInput("execution-1"));
    expect(await renderers.getSession(organizationId, "execution-1")).toMatchObject({ engine: "synthetic", engineVersion: "1.0.0", locale: "fa-IR" });
    await expect(renderers.createSession(organizationId, { ...sessionInput("execution-1"), locale: "en-US" })).rejects.toThrow("immutable renderer session conflict");
  });

  it("keeps retry sessions isolated by execution attempt", async () => {
    await start("execution-1", 0);
    await renderers.createSession(organizationId, sessionInput("execution-1"));
    await renderers.finishSession(organizationId, { executionId: "execution-1", status: "failed", finishedAt: "2026-11-21T00:00:01.000Z", error: { code: "navigation_timeout" } });
    await start("execution-2", 1);
    await renderers.createSession(organizationId, { ...sessionInput("execution-2"), engineVersion: "1.0.1" });
    expect((await renderers.getSession(organizationId, "execution-1")).execution.status).toBe("failed");
    expect((await renderers.getSession(organizationId, "execution-2")).execution.status).toBe("running");
  });

  it("requires structured failure and enforces tenant ownership", async () => {
    await start("execution-1", 0);
    await renderers.createSession(organizationId, sessionInput("execution-1"));
    await expect(renderers.finishSession(organizationId, { executionId: "execution-1", status: "failed", finishedAt: "2026-11-21T00:00:01.000Z" })).rejects.toThrow("failure details");
    await expect(renderers.getSession(randomUUID(), "execution-1")).rejects.toThrow("renderer session not found");
  });

  it("links ordered screenshot, trace, and DOM snapshot artifacts to renderer evidence", async () => {
    await prisma.evidencePage.create({ data: {
      id: "page-rendered", crawlRunId: runId, position: 0, depth: 0,
      discoveredUrl: "https://example.test/", requestedUrl: "https://example.test/",
      normalizedUrl: "https://example.test/", finalUrl: "https://example.test/", canonicalUrls: [],
    } });
    await observations.appendSubject(organizationId, { id: "subject-page", runId, kind: "page", identity: { pageId: "page-rendered" } });
    await start("execution-1", 0);
    await renderers.createSession(organizationId, sessionInput("execution-1"));
    await observations.appendObservation(organizationId, {
      id: "observation-rendered", runId, subjectId: "subject-page", executionId: "execution-1",
      definitionKey: "page.rendering", definitionVersion: "1.0.0", sequence: 0, status: "observed",
      payload: { rendered: true }, reasons: [], provenance: { engine: "synthetic", version: "1.0.0" },
      collectedAt: "2026-11-21T00:00:01.000Z",
    });
    const descriptors = [
      { role: "screenshot", sha256: "a".repeat(64), mediaType: "image/png", byteLength: 10 },
      { role: "trace", sha256: "b".repeat(64), mediaType: "application/zip", byteLength: 20 },
      { role: "dom_snapshot", sha256: "c".repeat(64), mediaType: "text/html", byteLength: 30 },
    ] as const;
    for (const [position, descriptor] of descriptors.entries()) {
      const artifact = await artifacts.register(organizationId, runId, {
        sha256: descriptor.sha256, mediaType: descriptor.mediaType, byteLength: descriptor.byteLength,
        locator: `sha256/${descriptor.sha256.slice(0, 2)}/${descriptor.sha256}`,
        sensitivity: "public", retentionClass: "evidence",
      });
      await artifacts.linkObservation(organizationId, "observation-rendered", artifact.id, descriptor.role, position);
    }
    const linked = await artifacts.listObservationArtifacts(organizationId, "observation-rendered");
    expect(linked.map(({ role, artifact }) => ({ role, mediaType: artifact.mediaType }))).toEqual([
      { role: "screenshot", mediaType: "image/png" },
      { role: "trace", mediaType: "application/zip" },
      { role: "dom_snapshot", mediaType: "text/html" },
    ]);
  });
});
