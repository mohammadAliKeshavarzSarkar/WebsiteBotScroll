import { describe, expect, it, vi } from "vitest";
import type { AuthStore } from "./lib/auth.js";
import { config, protectRequest } from "./proxy.js";
import { getAuthStore } from "./lib/server-auth-store.js";

describe("protectRequest", () => {
  it("redirects an unauthenticated sites request to login", async () => {
    const store: AuthStore = {
      findUserByEmail: vi.fn(async () => null),
      createSession: vi.fn(async () => undefined),
      findSessionByDigest: vi.fn(async () => null),
      deleteSessionByDigest: vi.fn(async () => undefined),
      recordAuditEvent: vi.fn(async () => undefined),
    };
    const response = await protectRequest(new Request("https://app.example/sites"), store);

    expect(response?.status).toBe(307);
    expect(response?.headers.get("location")).toBe("https://app.example/login");
  });

  it("registers both workspace pages and the site creation endpoint as protected", () => {
    expect(config.matcher).toEqual(["/sites/:path*", "/api/sites"]);
  });
});

describe("getAuthStore", () => {
  it("reuses one database-backed store per server process", () => {
    const store = {} as AuthStore;
    const factory = vi.fn(() => store);

    expect(getAuthStore(factory)).toBe(store);
    expect(getAuthStore(factory)).toBe(store);
    expect(factory).toHaveBeenCalledOnce();
  });
});
