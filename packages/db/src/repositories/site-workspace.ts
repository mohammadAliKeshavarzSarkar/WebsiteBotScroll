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
  pages?: { url: string; statusCode: number | null }[];
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

function ownerDeclarationScope(origin: string): OwnerDeclarationScope {
  const registeredOrigin = new URL(origin);
  return { seed_urls: [`${registeredOrigin.origin}/`], allowed_hosts: [registeredOrigin.hostname], include_patterns: [], exclude_patterns: [] };
}

function isOwnerDeclaration(record: { description: string; scope: unknown }, origin: string): boolean {
  if (record.description !== "Owner-declared crawl authorization" || !record.scope || typeof record.scope !== "object" || Array.isArray(record.scope)) return false;
  const actual = record.scope as Record<string, unknown>;
  const expected = ownerDeclarationScope(origin);
  return Object.keys(actual).length === 4
    && JSON.stringify(actual.seed_urls) === JSON.stringify(expected.seed_urls)
    && JSON.stringify(actual.allowed_hosts) === JSON.stringify(expected.allowed_hosts)
    && JSON.stringify(actual.include_patterns) === "[]"
    && JSON.stringify(actual.exclude_patterns) === "[]";
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
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
        },
        crawlRuns: {
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: 1,
          include: {
            errors: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
            evidenceErrors: { orderBy: [{ occurredAt: "asc" }, { id: "asc" }] },
            evidencePages: {
              orderBy: { position: "asc" },
              select: { finalUrl: true, transactions: { orderBy: { position: "desc" }, take: 1, select: { statusCode: true } } },
            },
          },
        },
      },
    });
    if (!record) return null;

    const authorization = record.exportAuthorizations.find((candidate) => isOwnerDeclaration(candidate, record.origin));
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
            pages: latestRun.evidencePages.map(({ finalUrl, transactions }) => ({
              url: finalUrl, statusCode: transactions[0]?.statusCode ?? null,
            })),
            coverage: {
              discovered: latestRun.discoveredCount,
              attempted: latestRun.attemptedCount,
              collected: latestRun.collectedCount,
              failed: latestRun.failedCount,
              unattempted: latestRun.unattemptedCount,
            },
            errors: [
              ...latestRun.errors.map(({ code, message, url, retryable }) => ({ code, message, url, retryable })),
              ...latestRun.evidenceErrors.map(({ code, retryable }) => ({
                code,
                message: code === "timeout" ? "The page request timed out."
                  : code === "evidence_persistence_error" ? "The page was fetched, but its evidence could not be saved."
                  : /^http_[1-5]\d{2}$/.test(code) ? `The page returned HTTP ${code.slice(5)}.`
                  : "The page could not be collected.",
                url: null,
                retryable,
              })),
            ],
          }
        : null,
    };
  }

  async authorizeOwnerDeclaration(
    input: AuthorizeOwnerDeclarationInput,
  ): Promise<WorkspaceAuthorization | null> {
    const authorize = () => this.prisma.$transaction(async (transaction) => {
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

      const scope = ownerDeclarationScope(site.origin);
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
    try { return await authorize(); }
    catch (error) { if (!isUniqueViolation(error)) throw error; return authorize(); }
  }
}
