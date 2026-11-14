import { loadEnv } from "@website-bot-scroll/config";
import { createPrismaClient } from "@website-bot-scroll/db";
import type { AuthStore } from "./auth";
import { PrismaAuthStore } from "./prisma-auth-store";

let cachedStore: AuthStore | undefined;

function createProductionStore(): AuthStore {
  const environment = loadEnv();
  return new PrismaAuthStore(createPrismaClient(environment.DATABASE_URL));
}

export function getAuthStore(factory: () => AuthStore = createProductionStore): AuthStore {
  cachedStore ??= factory();
  return cachedStore;
}
