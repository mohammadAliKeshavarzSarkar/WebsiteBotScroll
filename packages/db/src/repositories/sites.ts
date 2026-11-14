import type { CreateSiteInput, Site } from "@website-bot-scroll/domain/site";
import { organizationId, siteId, type OrganizationId, type SiteId } from "@website-bot-scroll/domain/ids";
import type { DatabaseClient } from "../client.js";

function toDomainSite(record: {
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

export class SiteRepository {
  constructor(private readonly prisma: DatabaseClient) {}

  async list(tenantId: OrganizationId): Promise<Site[]> {
    const records = await this.prisma.site.findMany({
      where: { organizationId: tenantId },
      orderBy: { createdAt: "asc" },
    });
    return records.map(toDomainSite);
  }

  async get(tenantId: OrganizationId, id: SiteId): Promise<Site | null> {
    const record = await this.prisma.site.findFirst({
      where: { id, organizationId: tenantId },
    });
    return record ? toDomainSite(record) : null;
  }

  async create(input: CreateSiteInput): Promise<Site> {
    const record = await this.prisma.$transaction(async (transaction) => {
      const site = await transaction.site.create({ data: input });
      await transaction.auditEvent.create({
        data: {
          organizationId: input.organizationId,
          siteId: site.id,
          action: "site.created",
          targetId: site.id,
        },
      });
      return site;
    });
    return toDomainSite(record);
  }
}
