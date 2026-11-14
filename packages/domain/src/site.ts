import type { OrganizationId, SiteId } from "./ids.js";

export type Site = {
  id: SiteId;
  organizationId: OrganizationId;
  name: string;
  origin: string;
  createdAt: Date;
  updatedAt: Date;
};

export type CreateSiteInput = {
  organizationId: OrganizationId;
  name: string;
  origin: string;
};
