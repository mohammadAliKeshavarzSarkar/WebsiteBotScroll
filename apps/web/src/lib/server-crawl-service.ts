import { randomUUID } from "node:crypto";
import { loadEnv } from "@website-bot-scroll/config";
import { createPrismaClient } from "@website-bot-scroll/db";
import { organizationId as toOrganizationId, siteId as toSiteId } from "@website-bot-scroll/domain/ids";
import { createCrawlQueueProducer, enqueueCrawl, type EnqueueCrawlInput } from "@website-bot-scroll/queue/client";
import type { ReturnTypeOfStartCrawlInput } from "./server-crawl-types";
import { getSiteWorkspaceRepository } from "./server-site-workspace-repository";

export class CrawlSiteNotFoundError extends Error { constructor() { super("Site not found"); this.name = "CrawlSiteNotFoundError"; } }
export class CrawlAuthorizationRequiredError extends Error { constructor() { super("Crawl authorization required"); this.name = "CrawlAuthorizationRequiredError"; } }
export class CrawlWorkerUnavailableError extends Error { constructor() { super("No crawl worker is connected"); this.name = "CrawlWorkerUnavailableError"; } }

type StartInput = { organizationId: string; siteId: string; userId: string; limits: ReturnTypeOfStartCrawlInput };
type WorkspaceReader = { get(organizationId: ReturnType<typeof toOrganizationId>, siteId: ReturnType<typeof toSiteId>): Promise<{ site: { id: string }; authorization: { id: string } | null; latestRun: unknown } | null> };
type Dependencies = {
  workspace: WorkspaceReader;
  enqueue(input: EnqueueCrawlInput): Promise<string>;
  revisions: { producerVersion: string; normalizationPolicyVersion: string; extractorVersion: string };
  idempotencyKey(): string;
};

export async function startManualCrawl(input: StartInput, dependencies: Dependencies): Promise<string> {
  const workspace = await dependencies.workspace.get(toOrganizationId(input.organizationId), toSiteId(input.siteId));
  if (!workspace) throw new CrawlSiteNotFoundError();
  if (!workspace.authorization) throw new CrawlAuthorizationRequiredError();
  const crawlRunId = await dependencies.enqueue({
    organizationId: input.organizationId, siteId: input.siteId, authorizationRef: workspace.authorization.id,
    trigger: "MANUAL", idempotencyKey: dependencies.idempotencyKey(), requestedByUserId: input.userId, limits: input.limits, ...dependencies.revisions,
  });
  return crawlRunId;
}

export type CrawlService = { requireSite(input: { organizationId: string; siteId: string }): Promise<void>; start(input: StartInput): Promise<string> };
let cachedService: CrawlService | undefined;

function createProductionService(): CrawlService {
  const environment = loadEnv();
  const prisma = createPrismaClient(environment.DATABASE_URL);
  const producer = createCrawlQueueProducer(environment.REDIS_URL);
  const producerVersion = process.env.SOURCE_REVISION;
  if (!producerVersion || !/^[a-f0-9]{40}$/.test(producerVersion)) throw new Error("SOURCE_REVISION must be the exact 40-character Git commit");
  const dependencies: Dependencies = {
    workspace: getSiteWorkspaceRepository(),
    enqueue: async (input) => {
      if (await producer.getWorkerCount() === 0) throw new CrawlWorkerUnavailableError();
      return enqueueCrawl(input, { prisma, producer });
    },
    revisions: { producerVersion, normalizationPolicyVersion: "normalize/1", extractorVersion: "html/1" },
    idempotencyKey: randomUUID,
  };
  return {
    requireSite: async (input) => { if (!await dependencies.workspace.get(toOrganizationId(input.organizationId), toSiteId(input.siteId))) throw new CrawlSiteNotFoundError(); },
    start: (input) => startManualCrawl(input, dependencies),
  };
}

export function getCrawlService(factory: () => CrawlService = createProductionService): CrawlService {
  cachedService ??= factory();
  return cachedService;
}
