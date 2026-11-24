import { organizationId, siteId as toSiteId, userId } from "@website-bot-scroll/domain/ids";
import { AuthenticationRequired, requireOwnerSession, type AuthStore } from "../../../../../lib/auth";
import { parseAuthorizationInput } from "../../../../../lib/crawl-input";
import { getAuthStore } from "../../../../../lib/server-auth-store";
import { getSiteWorkspaceRepository } from "../../../../../lib/server-site-workspace-repository";

type Authorizer = { authorizeOwnerDeclaration(input: { organizationId: ReturnType<typeof organizationId>; siteId: ReturnType<typeof toSiteId>; userId: ReturnType<typeof userId> }): Promise<unknown | null> };
type Dependencies = { authStore: AuthStore; workspace: Authorizer };
const redirect = (request: Request, path: string) => new Response(null, { status: 303, headers: { location: new URL(path, request.url).toString() } });

export async function authorizeSite(request: Request, pathSiteId: string, dependencies: Dependencies): Promise<Response> {
  let session;
  try { session = await requireOwnerSession(request, dependencies.authStore); }
  catch (error) {
    if (error instanceof AuthenticationRequired) return redirect(request, error.location);
    throw error;
  }
  const form = await request.formData();
  try { parseAuthorizationInput({ declaration: form.get("declaration") }); }
  catch (error) {
    const message = error instanceof Error ? error.message : "Authorization declaration is invalid";
    return redirect(request, `/sites/${encodeURIComponent(pathSiteId)}?${new URLSearchParams({ error: message })}`);
  }
  const result = await dependencies.workspace.authorizeOwnerDeclaration({
    organizationId: organizationId(session.organizationId), siteId: toSiteId(pathSiteId), userId: userId(session.userId),
  });
  if (!result) return new Response("Not found", { status: 404 });
  return redirect(request, `/sites/${encodeURIComponent(pathSiteId)}?authorized=1`);
}

export async function POST(request: Request, context: { params: Promise<{ siteId: string }> }): Promise<Response> {
  const { siteId } = await context.params;
  return authorizeSite(request, siteId, { authStore: getAuthStore(), workspace: getSiteWorkspaceRepository() });
}
