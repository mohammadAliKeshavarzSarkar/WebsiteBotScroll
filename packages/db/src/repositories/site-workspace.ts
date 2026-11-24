import { randomUUID } from "node:crypto";
import type { OrganizationId, SiteId, UserId } from "@website-bot-scroll/domain/ids";
import { organizationId, siteId } from "@website-bot-scroll/domain/ids";
import type { Site } from "@website-bot-scroll/domain/site";
import type { DatabaseClient } from "../client.js";

export type OwnerDeclarationScope = {
  seed_urls: string[];
  allowed_hosts: string[];
  include_patterns: string[];
  exclude_patterns: string[];
};

export type WorkspaceAuthorization = {
  id: string;
  organizationId: OrganizationId;
  siteId: SiteId;
  description: string;
  scope: OwnerDeclarationScope;
  createdAt: Date;
  revokedAt: Date | null;
};

export type WorkspaceCrawlError = {
  code: string;
  message: string;
  url: string | null;
  retryable: boolean;
};

export type WorkspaceCrawlRun = {
  id: string;
  status: "PENDING" | "RUNNING" | "COMPLETED" | "PARTIAL" | "FAILED" | "CANCELLED";
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  stopReason: string | null;
  coverage: {
    discovered: number;
    attempted: number;
    collected: number;
    failed: number;
    unattempted: number | null;
  };
  errors: WorkspaceCrawlError[];
};

export type SiteWorkspace = {
  site: Site;
  authorization: WorkspaceAuthorization | null;
  latestRun: WorkspaceCrawlRun | null;
};

export type AuthorizeOwnerDeclarationInput = {
  organizationId: OrganizationId;
  siteId: SiteId;
  userId: UserId;
};

function toSite(record: {
  id: string;
  organizationId: string;
  name: string;
  origin: string;
  createdAt: Date;
  updatedAt: Date;
}): Site {
  return {
    ...record,
    id: siteId(record.id),
    organizationId: organizationId(record.organizationId),
  };
}

function toAuthorization(record: {
  id: string;
  organizationId: string;
  siteId: string;
  description: string;
  scope: unknown;
  createdAt: Date;
  revokedAt: Date | null;
}): WorkspaceAuthorization {
  return {
    ...record,
    organizationId: organizationId(record.organizationId),
    siteId: siteId(record.siteId),
    scope: record.scope as OwnerDeclarationScope,
  };
}

export class SiteWorkspaceRepository {
  constructor(private readonly prisma: DatabaseClient) {}

  async get(tenantId: OrganizationId, id: SiteId): Promise<SiteWorkspace | null> {
    const record = await this.prisma.site.findFirst({
      where: { id, organizationId: tenantId },
      include: {
        exportAuthorizations: {
          where: { revokedAt: null },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
        crawlRuns: {
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: 1,
          include: { errors: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] } },
        },
      },
    });
    if (!record) return null;

    const authorization = record.exportAuthorizations[0];
    const latestRun = record.crawlRuns[0];
    return {
      site: toSite(record),
      authorization: authorization ? toAuthorization(authorization) : null,
      latestRun: latestRun
        ? {
            id: latestRun.id,
            status: latestRun.status,
            createdAt: latestRun.createdAt,
            startedAt: latestRun.startedAt,
            finishedAt: latestRun.finishedAt,
            stopReason: latestRun.stopReason,
            coverage: {
              discovered: latestRun.discoveredCount,
              attempted: latestRun.attemptedCount,
              collected: latestRun.collectedCount,
              failed: latestRun.failedCount,
              unattempted: latestRun.unattemptedCount,
            },
            errors: latestRun.errors.map(({ code, message, url, retryable }) => ({
              code,
              message,
              url,
              retryable,
            })),
          }
        : null,
    };
  }

  async authorizeOwnerDeclaration(
    input: AuthorizeOwnerDeclarationInput,
  ): Promise<WorkspaceAuthorization | null> {
    return this.prisma.$transaction(async (transaction) => {
      const site = await transaction.site.findFirst({
        where: { id: input.siteId, organizationId: input.organizationId },
        select: { id: true, organizationId: true, origin: true },
      });
      if (!site) return null;

      const now = new Date();
      await transaction.exportAuthorization.updateMany({
        where: { organizationId: input.organizationId, siteId: input.siteId, revokedAt: null },
        data: { revokedAt: now },
      });

      const registeredOrigin = new URL(site.origin);
      const scope: OwnerDeclarationScope = {
        seed_urls: [`${registeredOrigin.origin}/`],
        allowed_hosts: [registeredOrigin.hostname],
        include_patterns: [],
        exclude_patterns: [],
      };
      const authorization = await transaction.exportAuthorization.create({
        data: {
          id: `owner-declaration-${randomUUID()}`,
          organizationId: input.organizationId,
          siteId: input.siteId,
          description: "Owner-declared crawl authorization",
          scope,
        },
      });
      await transaction.auditEvent.create({
        data: {
          organizationId: input.organizationId,
          userId: input.userId,
          siteId: input.siteId,
          action: "site.crawl_authorized",
          targetId: authorization.id,
          metadata: { authorization_type: "owner_declaration" },
        },
      });
      return toAuthorization(authorization);
    });
  }
}
