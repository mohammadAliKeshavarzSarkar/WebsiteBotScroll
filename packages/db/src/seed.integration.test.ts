import { verify } from "argon2";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { AppEnv } from "@website-bot-scroll/config";
import { createPrismaClient } from "./client.js";
import { bootstrapOwner } from "./seed.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

describeDatabase("bootstrapOwner", () => {
  const prisma = createPrismaClient(databaseUrl!);

  beforeEach(async () => {
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "crawl_runs" CASCADE');
    await prisma.auditEvent.deleteMany();
    await prisma.session.deleteMany();
    await prisma.user.deleteMany();
    await prisma.site.deleteMany();
    await prisma.organization.deleteMany();
  });
  afterAll(async () => prisma.$disconnect());

  it("stores only an Argon2id hash and erases the bootstrap password", async () => {
    const environment: AppEnv = {
      DATABASE_URL: databaseUrl!,
      REDIS_URL: "redis://localhost:6379",
      AUTH_SECRET: "a".repeat(32),
      APP_BASE_URL: "http://localhost:3000",
      CRAWLER_CONTACT_URL: "https://example.com/crawler",
      BOOTSTRAP_OWNER_EMAIL: "OWNER@example.com",
      BOOTSTRAP_OWNER_PASSWORD: "correct-horse-battery-staple",
    };
    await bootstrapOwner(environment, prisma);

    const owner = await prisma.user.findUniqueOrThrow({ where: { email: "owner@example.com" } });
    await expect(verify(owner.passwordHash, "correct-horse-battery-staple")).resolves.toBe(true);
    expect(owner.passwordHash).not.toContain("correct-horse-battery-staple");
    expect(environment.BOOTSTRAP_OWNER_PASSWORD).toBe("");
  });
});
