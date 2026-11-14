import { describe, expect, it } from "vitest";
import { loadEnv } from "./env.js";

const validEnvironment = {
  DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/website_bot_scroll",
  REDIS_URL: "redis://localhost:6379",
  AUTH_SECRET: "a".repeat(32),
  APP_BASE_URL: "http://localhost:3000",
  CRAWLER_CONTACT_URL: "https://example.com/crawler",
  BOOTSTRAP_OWNER_EMAIL: "owner@example.com",
  BOOTSTRAP_OWNER_PASSWORD: "correct-horse-battery-staple",
};

describe("loadEnv", () => {
  it("parses every required setting", () => {
    expect(loadEnv(validEnvironment)).toEqual(validEnvironment);
  });

  it.each(Object.keys(validEnvironment))("requires %s", (key) => {
    const source = { ...validEnvironment };
    delete source[key as keyof typeof source];
    expect(() => loadEnv(source)).toThrow();
  });

  it("requires a 32-character authentication secret", () => {
    expect(() => loadEnv({ ...validEnvironment, AUTH_SECRET: "too-short" })).toThrow();
  });

  it("requires a 16-character bootstrap password", () => {
    expect(() =>
      loadEnv({ ...validEnvironment, BOOTSTRAP_OWNER_PASSWORD: "short-password" }),
    ).toThrow();
  });
});
