import { hash } from "argon2";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createPrismaClient } from "@website-bot-scroll/db";
import { PrismaAuthStore } from "./prisma-auth-store.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

describeDatabase("PrismaAuthStore", () => {
  const prisma = createPrismaClient(databaseUrl!);
  const store = new PrismaAuthStore(prisma);

  beforeEach(async () => {
    await prisma.auditEvent.deleteMany();
    await prisma.session.deleteMany();
    await prisma.user.deleteMany();
    await prisma.site.deleteMany();
    await prisma.organization.deleteMany();
  });

  afterAll(async () => prisma.$disconnect());

  it("persists only a token digest and returns its tenant session", async () => {
    const organization = await prisma.organization.create({ data: { name: "Owner" } });
    const user = await prisma.user.create({
      data: {
        organizationId: organization.id,
        email: "owner@example.com",
        passwordHash: await hash("correct-horse-battery-staple"),
      },
    });
    await store.createSession({
      userId: user.id,
      tokenDigest: "digest-only",
      expiresAt: new Date("2030-01-01T00:00:00Z"),
    });

    await expect(store.findSessionByDigest("digest-only")).resolves.toMatchObject({
      organizationId: organization.id,
      userId: user.id,
    });
    await expect(prisma.session.findFirst()).resolves.toMatchObject({
      tokenDigest: "digest-only",
    });
  });
});
