import { hash } from "argon2";
import { describe, expect, it, vi } from "vitest";
import {
  AuthenticationRequired,
  loginOwner,
  logoutOwner,
  requireOwnerSession,
  type AuthStore,
} from "./auth.js";

function createStore(passwordHash: string): AuthStore {
  return {
    findUserByEmail: vi.fn(async () => ({
      id: "user-1",
      organizationId: "org-1",
      email: "owner@example.com",
      passwordHash,
    })),
    createSession: vi.fn(async () => undefined),
    findSessionByDigest: vi.fn(async () => null),
    deleteSessionByDigest: vi.fn(async () => undefined),
    recordAuditEvent: vi.fn(async () => undefined),
  };
}

describe("owner authentication", () => {
  it("creates a secure HTTP-only opaque session for valid credentials", async () => {
    const store = createStore(await hash("correct-horse-battery-staple"));
    const result = await loginOwner(
      { email: "owner@example.com", password: "correct-horse-battery-staple" },
      store,
    );

    expect(result.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(result.cookie).toContain("website_bot_scroll_session=");
    expect(result.cookie).toContain("HttpOnly");
    expect(result.cookie).toContain("Secure");
    expect(result.cookie).toContain("SameSite=Lax");
    expect(result.cookie).not.toContain(result.digest);
    expect(store.createSession).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-1", tokenDigest: result.digest }),
    );
    expect(store.recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "auth.login", organizationId: "org-1" }),
    );
  });

  it("redirects an unauthenticated protected request to login", async () => {
    const store = createStore(await hash("correct-horse-battery-staple"));
    await expect(
      requireOwnerSession(new Request("https://app.example/sites"), store),
    ).rejects.toEqual(new AuthenticationRequired("/login"));
  });

  it("deletes the current session and audits logout", async () => {
    const store = createStore(await hash("correct-horse-battery-staple"));
    const request = new Request("https://app.example/sites", {
      headers: { cookie: "website_bot_scroll_session=test-session-token" },
    });
    await logoutOwner(request, store, { organizationId: "org-1", userId: "user-1" });

    expect(store.deleteSessionByDigest).toHaveBeenCalledOnce();
    expect(store.recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "auth.logout", organizationId: "org-1" }),
    );
  });
});
