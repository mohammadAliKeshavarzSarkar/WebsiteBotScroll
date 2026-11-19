import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createPrismaClient } from "../client.js";
import { EvidenceRepository } from "./evidence.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

const scope = {
  seed_urls: ["https://synthetic.example/"],
  allowed_hosts: ["synthetic.example"],
};

describeDatabase("EvidenceRepository", () => {
  const prisma = createPrismaClient(databaseUrl!);
  const evidence = new EvidenceRepository(prisma);

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(`
      TRUNCATE TABLE
        "evidence_header_values", "evidence_headers", "evidence_transactions",
        "evidence_observations", "evidence_errors", "evidence_limitations", "evidence_pages",
        "crawl_errors", "crawl_runs", "export_authorizations", "sites", "organizations"
      CASCADE
    `);
  });

  afterAll(async () => prisma.$disconnect());

  async function createRun(options: {
    organizationId?: string;
    status?: "RUNNING" | "COMPLETED" | "PARTIAL";
    runScope?: typeof scope;
    authorizationScope?: typeof scope;
  } = {}) {
    const organizationId = options.organizationId ?? randomUUID();
    const siteId = randomUUID();
    const runId = randomUUID();
    const authorizationId = `auth-${randomUUID()}`;
    await prisma.organization.create({ data: { id: organizationId, name: "Synthetic owner" } });
    await prisma.site.create({ data: { id: siteId, organizationId, name: "Synthetic", origin: "https://synthetic.example" } });
    await prisma.exportAuthorization.create({
      data: {
        id: authorizationId,
        organizationId,
        siteId,
        description: "Stage A.2.4 synthetic crawl",
        scope: options.authorizationScope ?? scope,
      },
    });
    await prisma.crawlRun.create({
      data: {
        id: runId,
        organizationId,
        siteId,
        authorizationId,
        trigger: "MANUAL",
        idempotencyKey: randomUUID(),
        status: options.status ?? "RUNNING",
        startedAt: new Date("2026-11-19T00:00:00.000Z"),
        ...((options.status ?? "RUNNING") === "RUNNING" ? {} : { finishedAt: new Date("2026-11-19T00:00:01.000Z") }),
        scope: options.runScope ?? scope,
        limits: { max_pages: 2, max_depth: 1, max_duration_ms: 10_000 },
        producerVersion: "a".repeat(40),
        normalizationPolicyVersion: "normalize/1",
        extractorVersion: "extract/1",
        discoveredCount: 1,
        attemptedCount: 1,
        collectedCount: 1,
        failedCount: 0,
        unattemptedCount: 0,
        stopReason: "frontier_exhausted",
      },
    });
    return { organizationId, siteId, runId, authorizationId };
  }

  it("enforces tenant isolation for appends and frozen reads", async () => {
    const owner = await createRun();
    const otherOrganizationId = randomUUID();
    await prisma.organization.create({ data: { id: otherOrganizationId, name: "Other" } });

    await expect(evidence.appendPage(otherOrganizationId, owner.runId, {
      id: "page-1", position: 0, depth: 0, discoveredUrl: scope.seed_urls[0]!, requestedUrl: scope.seed_urls[0]!,
      normalizedUrl: scope.seed_urls[0]!, finalUrl: scope.seed_urls[0]!, canonicalUrls: [],
    })).rejects.toThrow("crawl run not found");
    await expect(evidence.loadFrozenRun(otherOrganizationId, owner.runId)).rejects.toThrow("frozen crawl run not found");
  });

  it("preserves transaction and repeated-header order and makes stable appends idempotent", async () => {
    const run = await createRun();
    await evidence.appendPage(run.organizationId, run.runId, {
      id: "page-1", position: 0, depth: 0, discoveredUrl: scope.seed_urls[0]!, requestedUrl: scope.seed_urls[0]!,
      normalizedUrl: scope.seed_urls[0]!, finalUrl: scope.seed_urls[0]!, canonicalUrls: [],
    });
    const transaction = {
      id: "tx-1", requestUrl: scope.seed_urls[0]!, responseUrl: scope.seed_urls[0]!, method: "GET" as const,
      statusCode: 200, startedAt: "2026-11-19T00:00:00.000Z", finishedAt: "2026-11-19T00:00:00.100Z",
      transferredBytes: 12, decodedBytes: 12, redirectTo: null,
      headers: [{ name: "link" as const, values: ["</fa>; rel=alternate", "</en>; rel=alternate"] }],
    };

    await evidence.appendTransaction(run.organizationId, run.runId, "page-1", 0, transaction);
    await evidence.appendTransaction(run.organizationId, run.runId, "page-1", 0, transaction);

    expect(await prisma.evidenceTransaction.count()).toBe(1);
    const frozenRows = await evidence.listTransactions(run.organizationId, run.runId, "page-1");
    expect(frozenRows[0]?.headers[0]?.values).toEqual(["</fa>; rel=alternate", "</en>; rel=alternate"]);
  });

  it("rejects mutation of an existing observation identity", async () => {
    const run = await createRun();
    await evidence.appendPage(run.organizationId, run.runId, {
      id: "page-1", position: 0, depth: 0, discoveredUrl: scope.seed_urls[0]!, requestedUrl: scope.seed_urls[0]!,
      normalizedUrl: scope.seed_urls[0]!, finalUrl: scope.seed_urls[0]!, canonicalUrls: [],
    });
    const observation = {
      id: "obs-1", method: "metadata", status: "observed" as const, value: { title: "Original" }, reasons: [],
      provenance: { collector: "html", version: "1" },
    };
    await evidence.appendObservation(run.organizationId, run.runId, "page-1", observation);
    await expect(evidence.appendObservation(run.organizationId, run.runId, "page-1", {
      ...observation, value: { title: "Changed" },
    })).rejects.toThrow("immutable evidence conflict");
  });

  it("freezes a truthful partial run and preserves coverage and limitations", async () => {
    const run = await createRun({ status: "PARTIAL" });
    await evidence.appendPage(run.organizationId, run.runId, {
      id: "page-1", position: 0, depth: 0, discoveredUrl: scope.seed_urls[0]!, requestedUrl: scope.seed_urls[0]!,
      normalizedUrl: scope.seed_urls[0]!, finalUrl: scope.seed_urls[0]!, canonicalUrls: [],
    });
    await evidence.appendLimitation(run.organizationId, run.runId, {
      id: "limit-1", code: "page_limit_reached", message: "The bounded crawl stopped at its page limit.",
    });
    await evidence.freezeRun(run.organizationId, run.runId);

    const frozen = await evidence.loadFrozenRun(run.organizationId, run.runId);
    expect(frozen.status).toBe("PARTIAL");
    expect(frozen.coverage).toEqual({ discovered: 1, attempted: 1, collected: 1, failed: 0, unattempted: 0 });
    expect(frozen.limitations).toMatchObject([{ code: "page_limit_reached" }]);
  });

  it("rejects freeze for nonterminal, inconsistent coverage, or authorization scope mismatch", async () => {
    const running = await createRun();
    await expect(evidence.freezeRun(running.organizationId, running.runId)).rejects.toThrow("terminal");

    const inconsistent = await createRun({ status: "COMPLETED" });
    await prisma.crawlRun.update({ where: { id: inconsistent.runId }, data: { failedCount: 1 } });
    await expect(evidence.freezeRun(inconsistent.organizationId, inconsistent.runId)).rejects.toThrow("coverage");

    const mismatched = await createRun({
      status: "COMPLETED",
      runScope: { ...scope, allowed_hosts: ["other.example"] },
    });
    await expect(evidence.freezeRun(mismatched.organizationId, mismatched.runId)).rejects.toThrow("authorization scope");
  });
});
