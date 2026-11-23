import { describe, expect, it, vi } from "vitest";
import type { AuthStore } from "../../../lib/auth";
import { createSite } from "./route";

const authStore = (authenticated: boolean): AuthStore => ({
  findUserByEmail: vi.fn(async () => null),
  createSession: vi.fn(async () => undefined),
  findSessionByDigest: vi.fn(async () => authenticated ? ({ organizationId: "org-1", userId: "user-1", expiresAt: new Date("2099-01-01T00:00:00Z") }) : null),
  deleteSessionByDigest: vi.fn(async () => undefined),
  recordAuditEvent: vi.fn(async () => undefined),
});

describe("POST /api/sites", () => {
  it("creates a normalized site for the authenticated tenant and redirects", async () => {
    const create = vi.fn(async () => ({ id: "site-1" }));
    const request = new Request("https://app.example/api/sites", { method: "POST", headers: { cookie: "website_bot_scroll_session=token" }, body: new URLSearchParams({ name: " Main site ", origin: "https://Example.com/path" }) });

    const response = await createSite(request, { authStore: authStore(true), sites: { create } });

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://app.example/sites?created=1");
    expect(create).toHaveBeenCalledWith({ organizationId: "org-1", name: "Main site", origin: "https://example.com" });
  });

  it("redirects an unauthenticated submission to login without writing", async () => {
    const create = vi.fn();
    const response = await createSite(new Request("https://app.example/api/sites", { method: "POST", body: new URLSearchParams({ name: "Site", origin: "https://example.com" }) }), { authStore: authStore(false), sites: { create } });
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://app.example/login");
    expect(create).not.toHaveBeenCalled();
  });

  it("returns validation context to the workspace without writing", async () => {
    const create = vi.fn();
    const request = new Request("https://app.example/api/sites", { method: "POST", headers: { cookie: "website_bot_scroll_session=token" }, body: new URLSearchParams({ name: "Site", origin: "example.com/docs" }) });
    const response = await createSite(request, { authStore: authStore(true), sites: { create } });
    const location = new URL(response.headers.get("location")!);
    expect(response.status).toBe(303);
    expect(location.pathname).toBe("/sites");
    expect(location.searchParams.get("error")).toContain("absolute HTTP(S) URL");
    expect(location.searchParams.get("name")).toBe("Site");
    expect(location.searchParams.get("origin")).toBe("example.com/docs");
    expect(create).not.toHaveBeenCalled();
  });
});
