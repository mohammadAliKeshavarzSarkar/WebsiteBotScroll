import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { organizationId } from "@website-bot-scroll/domain/ids";
import { AuthenticationRequired, requireOwnerSession } from "../../lib/auth";
import { getAuthStore } from "../../lib/server-auth-store";
import { getSiteRepository } from "../../lib/server-site-repository";
import { SitesView } from "./sites-view";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const first = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;

export default async function SitesPage({ searchParams }: { searchParams: SearchParams }) {
  const requestHeaders = await headers();
  let session;
  try { session = await requireOwnerSession(new Request("http://localhost/sites", { headers: requestHeaders }), getAuthStore()); }
  catch (error) {
    if (error instanceof AuthenticationRequired) redirect(error.location);
    throw error;
  }
  const [sites, params] = await Promise.all([getSiteRepository().list(organizationId(session.organizationId)), searchParams]);
  const created = first(params.created);
  const error = first(params.error);
  const name = first(params.name);
  const origin = first(params.origin);
  return <SitesView sites={sites.map(({ id, name, origin }) => ({ id, name, origin }))} feedback={{
    ...(created === "1" ? { created: true } : {}),
    ...(error ? { error } : {}),
    ...(name ? { name } : {}),
    ...(origin ? { origin } : {}),
  }} />;
}
