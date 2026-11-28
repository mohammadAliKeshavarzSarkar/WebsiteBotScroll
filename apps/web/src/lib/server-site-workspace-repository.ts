import { loadEnv } from "@website-bot-scroll/config";
import { createPrismaClient } from "@website-bot-scroll/db";
import { SiteWorkspaceRepository } from "@website-bot-scroll/db/site-workspace";

let cachedRepository: SiteWorkspaceRepository | undefined;
const createProductionRepository = () => new SiteWorkspaceRepository(createPrismaClient(loadEnv().DATABASE_URL));

export function getSiteWorkspaceRepository(factory: () => SiteWorkspaceRepository = createProductionRepository): SiteWorkspaceRepository {
  cachedRepository ??= factory();
  return cachedRepository;
}
