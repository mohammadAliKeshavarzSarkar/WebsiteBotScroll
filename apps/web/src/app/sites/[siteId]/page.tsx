import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { organizationId, siteId as toSiteId } from "@website-bot-scroll/domain/ids";
import { AuthenticationRequired, requireOwnerSession } from "../../../lib/auth";
import { getAuthStore } from "../../../lib/server-auth-store";
import { getSiteWorkspaceRepository } from "../../../lib/server-site-workspace-repository";
import { SiteDetailView } from "./site-detail-view";

const first = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;

export default async function SiteDetailPage({ params, searchParams }: { params: Promise<{ siteId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { siteId } = await params;
  let session;
  try { session = await requireOwnerSession(new Request(`http://localhost/sites/${siteId}`, { headers: await headers() }), getAuthStore()); }
  catch (error) { if (error instanceof AuthenticationRequired) redirect(error.location); throw error; }
  const [workspace, query] = await Promise.all([getSiteWorkspaceRepository().get(organizationId(session.organizationId), toSiteId(siteId)), searchParams]);
  if (!workspace) notFound();
  const error = first(query.error);
  return <SiteDetailView site={workspace.site} authorization={workspace.authorization} latestRun={workspace.latestRun} feedback={{ ...(first(query.authorized) === "1" ? { authorized: true } : {}), ...(error ? { error } : {}) }} />;
}
