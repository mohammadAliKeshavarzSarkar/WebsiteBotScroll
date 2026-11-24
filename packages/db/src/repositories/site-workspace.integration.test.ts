import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { organizationId, siteId, userId } from "@website-bot-scroll/domain/ids";
import { createPrismaClient } from "../client.js";
import { SiteWorkspaceRepository } from "./site-workspace.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

describeDatabase("SiteWorkspaceRepository", () => {
  const prisma = createPrismaClient(databaseUrl!);
  const workspace = new SiteWorkspaceRepository(prisma);
  let ownerOrganizationId: ReturnType<typeof organizationId>;
  let otherOrganizationId: ReturnType<typeof organizationId>;
  let ownerUserId: ReturnType<typeof userId>;
  let ownerSiteId: ReturnType<typeof siteId>;

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE "crawl_runs", "export_authorizations", "audit_events", "sessions", "users", "sites", "organizations" CASCADE',
    );
    ownerOrganizationId = organizationId(randomUUID());
    otherOrganizationId = organizationId(randomUUID());
    ownerUserId = userId(randomUUID());
    ownerSiteId = siteId(randomUUID());
    await prisma.organization.createMany({
      data: [
        { id: ownerOrganizationId, name: "Owner" },
        { id: otherOrganizationId, name: "Other" },
      ],
    });
    await prisma.user.create({
      data: {
        id: ownerUserId,
        organizationId: ownerOrganizationId,
        email: "owner@example.com",
        passwordHash: "test-only",
      },
    });
    await prisma.site.create({
      data: {
        id: ownerSiteId,
        organizationId: ownerOrganizationId,
        name: "Owner site",
        origin: "https://Example.COM:443",
      },
    });
  });

  afterAll(async () => prisma.$disconnect());

  it("returns not-found behavior for another tenant's site", async () => {
    await expect(workspace.get(otherOrganizationId, ownerSiteId)).resolves.toBeNull();
    await expect(
      workspace.authorizeOwnerDeclaration({
        organizationId: otherOrganizationId,
        siteId: ownerSiteId,
        userId: ownerUserId,
      }),
    ).resolves.toBeNull();
    await expect(prisma.exportAuthorization.count()).resolves.toBe(0);
  });

  it("authorizes only the exact registered origin and records the owner audit", async () => {
    const authorization = await workspace.authorizeOwnerDeclaration({
      organizationId: ownerOrganizationId,
      siteId: ownerSiteId,
      userId: ownerUserId,
    });

    expect(authorization).toMatchObject({
      organizationId: ownerOrganizationId,
      siteId: ownerSiteId,
      description: "Owner-declared crawl authorization",
      revokedAt: null,
      scope: {
        seed_urls: ["https://example.com/"],
        allowed_hosts: ["example.com"],
        include_patterns: [],
        exclude_patterns: [],
      },
    });
    await expect(
      prisma.auditEvent.findFirstOrThrow({ where: { organizationId: ownerOrganizationId } }),
    ).resolves.toMatchObject({
      userId: ownerUserId,
      siteId: ownerSiteId,
      action: "site.crawl_authorized",
      targetId: authorization?.id,
    });
  });

  it("revokes the previous active declaration when replacing it", async () => {
    const first = await workspace.authorizeOwnerDeclaration({
      organizationId: ownerOrganizationId,
      siteId: ownerSiteId,
      userId: ownerUserId,
    });
    const second = await workspace.authorizeOwnerDeclaration({
      organizationId: ownerOrganizationId,
      siteId: ownerSiteId,
      userId: ownerUserId,
    });

    expect(second?.id).not.toBe(first?.id);
    await expect(prisma.exportAuthorization.findUniqueOrThrow({ where: { id: first!.id } })).resolves.toMatchObject({
      revokedAt: expect.any(Date),
    });
    await expect(
      prisma.exportAuthorization.count({
        where: { organizationId: ownerOrganizationId, siteId: ownerSiteId, revokedAt: null },
      }),
    ).resolves.toBe(1);
  });

  it("projects the active authorization, latest run, and structured crawl errors", async () => {
    const authorization = await workspace.authorizeOwnerDeclaration({
      organizationId: ownerOrganizationId,
      siteId: ownerSiteId,
      userId: ownerUserId,
    });
    const olderRunId = randomUUID();
    const latestRunId = randomUUID();
    await prisma.crawlRun.createMany({
      data: [
        {
          id: olderRunId,
          organizationId: ownerOrganizationId,
          siteId: ownerSiteId,
          authorizationId: authorization!.id,
          trigger: "MANUAL",
          idempotencyKey: "older",
          createdAt: new Date("2026-11-24T08:00:00.000Z"),
        },
        {
          id: latestRunId,
          organizationId: ownerOrganizationId,
          siteId: ownerSiteId,
          authorizationId: authorization!.id,
          trigger: "MANUAL",
          idempotencyKey: "latest",
          status: "FAILED",
          createdAt: new Date("2026-11-24T09:00:00.000Z"),
          finishedAt: new Date("2026-11-24T09:00:03.000Z"),
          discoveredCount: 3,
          attemptedCount: 2,
          collectedCount: 1,
          failedCount: 1,
          unattemptedCount: 1,
          stopReason: "worker_error",
        },
      ],
    });
    await prisma.crawlError.create({
      data: {
        crawlRunId: latestRunId,
        code: "request_failed",
        message: "The page could not be collected.",
        url: "https://example.com/private",
        retryable: true,
      },
    });

    await expect(workspace.get(ownerOrganizationId, ownerSiteId)).resolves.toMatchObject({
      site: { id: ownerSiteId, organizationId: ownerOrganizationId, origin: "https://Example.COM:443" },
      authorization: { id: authorization!.id, revokedAt: null },
      latestRun: {
        id: latestRunId,
        status: "FAILED",
        coverage: { discovered: 3, attempted: 2, collected: 1, failed: 1, unattempted: 1 },
        stopReason: "worker_error",
        errors: [
          {
            code: "request_failed",
            message: "The page could not be collected.",
            url: "https://example.com/private",
            retryable: true,
          },
        ],
      },
    });
  });
});
