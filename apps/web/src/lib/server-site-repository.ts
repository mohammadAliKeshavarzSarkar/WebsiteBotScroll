import { loadEnv } from "@website-bot-scroll/config";
import { createPrismaClient } from "@website-bot-scroll/db";
import { SiteRepository } from "@website-bot-scroll/db/sites";

let cachedRepository: SiteRepository | undefined;

function createProductionRepository(): SiteRepository {
  return new SiteRepository(createPrismaClient(loadEnv().DATABASE_URL));
}

export function getSiteRepository(factory: () => SiteRepository = createProductionRepository): SiteRepository {
  cachedRepository ??= factory();
  return cachedRepository;
}
