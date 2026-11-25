import { describe, expect, it, vi } from "vitest";
import type { AuthStore } from "../../../../../lib/auth";
import { authorizeSite } from "./route";

const authStore = (authenticated: boolean): AuthStore => ({
  findUserByEmail: vi.fn(async () => null), createSession: vi.fn(async () => undefined),
  findSessionByDigest: vi.fn(async () => authenticated ? { organizationId: "11111111-1111-4111-8111-111111111111", userId: "22222222-2222-4222-8222-222222222222", expiresAt: new Date("2099-01-01T00:00:00Z") } : null),
  deleteSessionByDigest: vi.fn(async () => undefined), recordAuditEvent: vi.fn(async () => undefined),
});
const siteId = "33333333-3333-4333-8333-333333333333";
const request = (body: URLSearchParams, authenticated = true) => new Request(`https://app.example/api/sites/${siteId}/authorize`, { method: "POST", headers: authenticated ? { cookie: "website_bot_scroll_session=token" } : {}, body });

describe("POST /api/sites/[siteId]/authorize", () => {
  it("redirects unauthenticated requests without writing", async () => {
    const authorizeOwnerDeclaration = vi.fn();
    const response = await authorizeSite(request(new URLSearchParams({ declaration: "on" }), false), siteId, { authStore: authStore(false), workspace: { get: vi.fn(), authorizeOwnerDeclaration } });
    expect(response.status).toBe(303); expect(response.headers.get("location")).toBe("https://app.example/login"); expect(authorizeOwnerDeclaration).not.toHaveBeenCalled();
  });
  it("returns not found across tenants", async () => {
    const response = await authorizeSite(request(new URLSearchParams()), siteId, { authStore: authStore(true), workspace: { get: vi.fn(async () => null), authorizeOwnerDeclaration: vi.fn(async () => null) } });
    expect(response.status).toBe(404);
  });
  it("rejects a missing declaration without writing", async () => {
    const authorizeOwnerDeclaration = vi.fn();
    const response = await authorizeSite(request(new URLSearchParams()), siteId, { authStore: authStore(true), workspace: { get: vi.fn(async () => ({})), authorizeOwnerDeclaration } });
    const location = new URL(response.headers.get("location")!); expect(location.pathname).toBe(`/sites/${siteId}`); expect(location.searchParams.get("error")).toContain("authorized to crawl"); expect(authorizeOwnerDeclaration).not.toHaveBeenCalled();
  });
  it("uses only session and path identities, ignoring manipulated scope fields", async () => {
    const authorizeOwnerDeclaration = vi.fn(async () => ({ id: "auth-1" }));
    const response = await authorizeSite(request(new URLSearchParams({ declaration: "on", allowedHost: "evil.example" })), siteId, { authStore: authStore(true), workspace: { get: vi.fn(async () => ({})), authorizeOwnerDeclaration } });
    expect(authorizeOwnerDeclaration).toHaveBeenCalledWith({ organizationId: "11111111-1111-4111-8111-111111111111", siteId, userId: "22222222-2222-4222-8222-222222222222" });
    expect(response.headers.get("location")).toBe(`https://app.example/sites/${siteId}?authorized=1`);
  });
});
