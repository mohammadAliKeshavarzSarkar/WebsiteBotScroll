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

  it("does not copy rejected URL credentials into the redirect", async () => {
    const create = vi.fn();
    const request = new Request("https://app.example/api/sites", { method: "POST", headers: { cookie: "website_bot_scroll_session=token" }, body: new URLSearchParams({ name: "Site", origin: "https://private-user:private-password@example.com" }) });
    const response = await createSite(request, { authStore: authStore(true), sites: { create } });
    const location = response.headers.get("location")!;

    expect(location).not.toContain("private-user");
    expect(location).not.toContain("private-password");
    expect(new URL(location).searchParams.get("origin")).toBe("");
    expect(create).not.toHaveBeenCalled();
  });

  it("returns a useful workspace error when the normalized origin already exists", async () => {
    const create = vi.fn(async () => { throw Object.assign(new Error("Unique constraint"), { code: "P2002" }); });
    const request = new Request("https://app.example/api/sites", { method: "POST", headers: { cookie: "website_bot_scroll_session=token" }, body: new URLSearchParams({ name: "Docs", origin: "https://Example.com/docs" }) });
    const response = await createSite(request, { authStore: authStore(true), sites: { create } });
    const location = new URL(response.headers.get("location")!);

    expect(response.status).toBe(303);
    expect(location.searchParams.get("error")).toBe("This website is already registered");
    expect(location.searchParams.get("name")).toBe("Docs");
    expect(location.searchParams.get("origin")).toBe("https://example.com");
  });
});
