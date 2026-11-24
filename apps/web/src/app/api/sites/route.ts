import type { CreateSiteInput } from "@website-bot-scroll/domain/site";
import { organizationId } from "@website-bot-scroll/domain/ids";
import { AuthenticationRequired, requireOwnerSession, type AuthStore } from "../../../lib/auth";
import { getAuthStore } from "../../../lib/server-auth-store";
import { getSiteRepository } from "../../../lib/server-site-repository";
import { parseCreateSiteInput } from "../../../lib/site-input";

type SiteCreator = { create(input: CreateSiteInput): Promise<unknown> };
type CreateSiteDependencies = { authStore: AuthStore; sites: SiteCreator };

const redirect = (request: Request, path: string) => new Response(null, { status: 303, headers: { location: new URL(path, request.url).toString() } });
const isUniqueConstraintError = (error: unknown) => typeof error === "object" && error !== null && "code" in error && error.code === "P2002";

function safeOriginForRedirect(value: FormDataEntryValue | null): string {
  if (typeof value !== "string") return "";
  try {
    const parsed = new URL(value);
    return parsed.username || parsed.password ? "" : value;
  } catch {
    return value;
  }
}

export async function createSite(request: Request, dependencies: CreateSiteDependencies): Promise<Response> {
  let session;
  try { session = await requireOwnerSession(request, dependencies.authStore); }
  catch (error) {
    if (error instanceof AuthenticationRequired) return redirect(request, error.location);
    throw error;
  }

  const form = await request.formData();
  const raw = { name: form.get("name"), origin: form.get("origin") };
  let input: ReturnType<typeof parseCreateSiteInput>;
  try { input = parseCreateSiteInput(raw); }
  catch (error) {
    const query = new URLSearchParams({
      error: error instanceof Error ? error.message : "Website details are invalid",
      name: typeof raw.name === "string" ? raw.name : "",
      origin: safeOriginForRedirect(raw.origin),
    });
    return redirect(request, `/sites?${query}`);
  }

  try {
    await dependencies.sites.create({ organizationId: organizationId(session.organizationId), ...input });
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;
    const query = new URLSearchParams({ error: "This website is already registered", name: input.name, origin: input.origin });
    return redirect(request, `/sites?${query}`);
  }
  return redirect(request, "/sites?created=1");
}

export async function POST(request: Request): Promise<Response> {
  return createSite(request, { authStore: getAuthStore(), sites: getSiteRepository() });
}
