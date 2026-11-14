import { hash } from "argon2";
import { describe, expect, it, vi } from "vitest";
import { handleLogin } from "./route.js";
import type { AuthStore } from "../../../../lib/auth.js";

describe("POST /api/auth/login", () => {
  it("sets the session cookie and redirects after valid form credentials", async () => {
    const store: AuthStore = {
      findUserByEmail: vi.fn(async () => ({
        id: "user-1",
        organizationId: "org-1",
        email: "owner@example.com",
        passwordHash: await hash("correct-horse-battery-staple"),
      })),
      createSession: vi.fn(async () => undefined),
      findSessionByDigest: vi.fn(async () => null),
      deleteSessionByDigest: vi.fn(async () => undefined),
      recordAuditEvent: vi.fn(async () => undefined),
    };
    const body = new URLSearchParams({
      email: "owner@example.com",
      password: "correct-horse-battery-staple",
    });
    const response = await handleLogin(
      new Request("https://app.example/api/auth/login", { method: "POST", body }),
      store,
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://app.example/sites");
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
  });
});
