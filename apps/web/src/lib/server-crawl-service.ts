import { randomUUID } from "node:crypto";
import { loadEnv } from "@website-bot-scroll/config";
import { createPrismaClient } from "@website-bot-scroll/db";
import { organizationId as toOrganizationId, siteId as toSiteId } from "@website-bot-scroll/domain/ids";
import { createCrawlQueueProducer, enqueueCrawl, type EnqueueCrawlInput } from "@website-bot-scroll/queue/client";
import type { ReturnTypeOfStartCrawlInput } from "./server-crawl-types";
import { getSiteWorkspaceRepository } from "./server-site-workspace-repository";

export class CrawlSiteNotFoundError extends Error { constructor() { super("Site not found"); this.name = "CrawlSiteNotFoundError"; } }
export class CrawlAuthorizationRequiredError extends Error { constructor() { super("Crawl authorization required"); this.name = "CrawlAuthorizationRequiredError"; } }

type StartInput = { organizationId: string; siteId: string; userId: string; limits: ReturnTypeOfStartCrawlInput };
type WorkspaceReader = { get(organizationId: ReturnType<typeof toOrganizationId>, siteId: ReturnType<typeof toSiteId>): Promise<{ site: { id: string }; authorization: { id: string } | null; latestRun: unknown } | null> };
type Dependencies = {
  workspace: WorkspaceReader;
  enqueue(input: EnqueueCrawlInput): Promise<string>;
  audit(input: { organizationId: string; userId: string; siteId: string; crawlRunId: string }): Promise<void>;
  revisions: { producerVersion: string; normalizationPolicyVersion: string; extractorVersion: string };
  idempotencyKey(): string;
};

export async function startManualCrawl(input: StartInput, dependencies: Dependencies): Promise<string> {
  const workspace = await dependencies.workspace.get(toOrganizationId(input.organizationId), toSiteId(input.siteId));
  if (!workspace) throw new CrawlSiteNotFoundError();
  if (!workspace.authorization) throw new CrawlAuthorizationRequiredError();
  const crawlRunId = await dependencies.enqueue({
    organizationId: input.organizationId, siteId: input.siteId, authorizationRef: workspace.authorization.id,
    trigger: "MANUAL", idempotencyKey: dependencies.idempotencyKey(), limits: input.limits, ...dependencies.revisions,
  });
  await dependencies.audit({ organizationId: input.organizationId, userId: input.userId, siteId: input.siteId, crawlRunId });
  return crawlRunId;
}

export type CrawlService = { start(input: StartInput): Promise<string> };
let cachedService: CrawlService | undefined;

function createProductionService(): CrawlService {
  const environment = loadEnv();
  const prisma = createPrismaClient(environment.DATABASE_URL);
  const producer = createCrawlQueueProducer(environment.REDIS_URL);
  const producerVersion = process.env.SOURCE_REVISION;
  if (!producerVersion || !/^[a-f0-9]{40}$/.test(producerVersion)) throw new Error("SOURCE_REVISION must be the exact 40-character Git commit");
  const dependencies: Dependencies = {
    workspace: getSiteWorkspaceRepository(),
    enqueue: (input) => enqueueCrawl(input, { prisma, producer }),
    audit: async ({ organizationId, userId, siteId, crawlRunId }) => { await prisma.auditEvent.create({ data: { organizationId, userId, siteId, action: "site.crawl_requested", targetId: crawlRunId } }); },
    revisions: { producerVersion, normalizationPolicyVersion: "normalize/1", extractorVersion: "html/1" },
    idempotencyKey: randomUUID,
  };
  return { start: (input) => startManualCrawl(input, dependencies) };
}

export function getCrawlService(factory: () => CrawlService = createProductionService): CrawlService {
  cachedService ??= factory();
  return cachedService;
}
