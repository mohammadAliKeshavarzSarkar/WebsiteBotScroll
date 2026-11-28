import { CrawlOverlapError } from "@website-bot-scroll/queue/client";
import { AuthenticationRequired, requireOwnerSession, type AuthStore } from "../../../../../lib/auth";
import { parseStartCrawlInput } from "../../../../../lib/crawl-input";
import { CrawlAuthorizationRequiredError, CrawlSiteNotFoundError, CrawlWorkerUnavailableError, getCrawlService, type CrawlService } from "../../../../../lib/server-crawl-service";
import { getAuthStore } from "../../../../../lib/server-auth-store";

type Dependencies = { authStore: AuthStore; crawl: CrawlService };
const redirect = (request: Request, path: string) => new Response(null, { status: 303, headers: { location: new URL(path, request.url).toString() } });
const errorRedirect = (request: Request, siteId: string, message: string) => redirect(request, `/sites/${encodeURIComponent(siteId)}?${new URLSearchParams({ error: message })}`);

export async function startSiteCrawl(request: Request, siteId: string, dependencies: Dependencies): Promise<Response> {
  let session;
  try { session = await requireOwnerSession(request, dependencies.authStore); }
  catch (error) { if (error instanceof AuthenticationRequired) return redirect(request, error.location); throw error; }
  try { await dependencies.crawl.requireSite({ organizationId: session.organizationId, siteId }); }
  catch (error) { if (error instanceof CrawlSiteNotFoundError) return new Response("Not found", { status: 404 }); throw error; }
  const form = await request.formData();
  let limits;
  try { limits = parseStartCrawlInput({ maxPages: form.get("maxPages") ?? undefined, maxDepth: form.get("maxDepth") ?? undefined, maxDurationSeconds: form.get("maxDurationSeconds") ?? undefined }); }
  catch (error) { return errorRedirect(request, siteId, error instanceof Error ? error.message : "Crawl controls are invalid"); }
  try {
    const runId = await dependencies.crawl.start({ organizationId: session.organizationId, userId: session.userId, siteId, limits });
    return redirect(request, `/sites/${encodeURIComponent(siteId)}?run=${encodeURIComponent(runId)}`);
  } catch (error) {
    if (error instanceof CrawlSiteNotFoundError) return new Response("Not found", { status: 404 });
    if (error instanceof CrawlAuthorizationRequiredError) return errorRedirect(request, siteId, "Authorize this website before starting a crawl");
    if (error instanceof CrawlWorkerUnavailableError) return errorRedirect(request, siteId, "No crawl worker is connected. Start the worker, then try again.");
    if (error instanceof CrawlOverlapError || (error instanceof Error && error.name === "CrawlOverlapError")) return errorRedirect(request, siteId, "A crawl is already active for this website");
    return errorRedirect(request, siteId, "The crawl queue is unavailable. Check Redis and the worker, then try again.");
  }
}

export async function POST(request: Request, context: { params: Promise<{ siteId: string }> }): Promise<Response> {
  const { siteId } = await context.params;
  return startSiteCrawl(request, siteId, { authStore: getAuthStore(), crawl: getCrawlService() });
}
