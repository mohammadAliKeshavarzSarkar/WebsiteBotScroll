type Brand<T, Name extends string> = T & { readonly __brand: Name };

export type OrganizationId = Brand<string, "OrganizationId">;
export type UserId = Brand<string, "UserId">;
export type SiteId = Brand<string, "SiteId">;

function nonEmptyId<Name extends string>(value: string, name: Name): Brand<string, Name> {
  if (!value.trim()) throw new TypeError(`${name} must not be empty`);
  return value as Brand<string, Name>;
}

export const organizationId = (value: string): OrganizationId =>
  nonEmptyId(value, "OrganizationId");
export const userId = (value: string): UserId => nonEmptyId(value, "UserId");
export const siteId = (value: string): SiteId => nonEmptyId(value, "SiteId");
