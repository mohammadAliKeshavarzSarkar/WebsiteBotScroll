import { describe, expect, it, vi } from "vitest";
import { startWorker } from "./index.js";

describe("startWorker", () => {
  it("logs a structured ready event after validating configuration", () => {
    const write = vi.fn();
    startWorker(
      {
        DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/website_bot_scroll",
        REDIS_URL: "redis://localhost:6379",
        AUTH_SECRET: "a".repeat(32),
        APP_BASE_URL: "http://localhost:3000",
        CRAWLER_CONTACT_URL: "https://example.com/crawler",
        BOOTSTRAP_OWNER_EMAIL: "owner@example.com",
        BOOTSTRAP_OWNER_PASSWORD: "correct-horse-battery-staple",
      },
      write,
    );

    expect(write).toHaveBeenCalledWith(
      JSON.stringify({ component: "worker", event: "ready" }),
    );
  });
});
