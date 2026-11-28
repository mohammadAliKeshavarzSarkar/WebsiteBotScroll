import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { organizationId, siteId } from "@website-bot-scroll/domain/ids";
import { createPrismaClient } from "../client.js";
import { SiteRepository } from "./sites.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

describeDatabase("SiteRepository tenant isolation", () => {
  const prisma = createPrismaClient(databaseUrl!);
  const sites = new SiteRepository(prisma);

  beforeEach(async () => {
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "crawl_runs" CASCADE');
    await prisma.auditEvent.deleteMany();
    await prisma.site.deleteMany();
    await prisma.organization.deleteMany();
  });

  afterAll(async () => prisma.$disconnect());

  it("does not return another organization's site by id", async () => {
    const firstOrganizationId = organizationId(randomUUID());
    const secondOrganizationId = organizationId(randomUUID());
    await prisma.organization.createMany({
      data: [
        { id: firstOrganizationId, name: "First" },
        { id: secondOrganizationId, name: "Second" },
      ],
    });
    const created = await sites.create({
      organizationId: firstOrganizationId,
      origin: "https://first.example",
      name: "First site",
    });

    await expect(sites.get(secondOrganizationId, siteId(created.id))).resolves.toBeNull();
    await expect(sites.list(secondOrganizationId)).resolves.toEqual([]);
  });

  it("records site creation in the tenant audit log", async () => {
    const id = organizationId(randomUUID());
    await prisma.organization.create({ data: { id, name: "Owner" } });
    const created = await sites.create({
      organizationId: id,
      origin: "https://example.com",
      name: "Example",
    });

    await expect(
      prisma.auditEvent.findMany({ where: { organizationId: id, targetId: created.id } }),
    ).resolves.toMatchObject([{ action: "site.created" }]);
  });
});
