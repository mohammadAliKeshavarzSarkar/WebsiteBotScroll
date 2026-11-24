import { describe, expect, it, vi } from "vitest";
import type { AuthStore } from "../../../../../lib/auth";
import { CrawlAuthorizationRequiredError, CrawlSiteNotFoundError, startManualCrawl } from "../../../../../lib/server-crawl-service";
import { startSiteCrawl } from "./route";

const organizationId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";
const siteId = "33333333-3333-4333-8333-333333333333";
const authStore = (authenticated = true): AuthStore => ({ findUserByEmail: vi.fn(async () => null), createSession: vi.fn(async () => undefined), findSessionByDigest: vi.fn(async () => authenticated ? { organizationId, userId, expiresAt: new Date("2099-01-01Z") } : null), deleteSessionByDigest: vi.fn(async () => undefined), recordAuditEvent: vi.fn(async () => undefined) });
const request = (values: Record<string, string> = {}) => new Request(`https://app.example/api/sites/${siteId}/crawl`, { method: "POST", headers: { cookie: "website_bot_scroll_session=token" }, body: new URLSearchParams(values) });

describe("manual crawl service", () => {
  it("constructs one bounded manual job from the active tenant authorization", async () => {
    const enqueue = vi.fn(async () => "44444444-4444-4444-8444-444444444444");
    const audit = vi.fn(async () => undefined);
    const result = await startManualCrawl({ organizationId, siteId, userId, limits: { maxPages: 100, maxDepth: 3, maxDurationMs: 300_000, maxResponseBytes: 5_242_880 } }, { workspace: { get: vi.fn(async () => ({ site: { id: siteId }, authorization: { id: "auth-1" }, latestRun: null })) }, enqueue, audit, revisions: { producerVersion: "a".repeat(40), normalizationPolicyVersion: "normalize/1", extractorVersion: "extract/1" }, idempotencyKey: () => "manual-key" });
    expect(result).toBe("44444444-4444-4444-8444-444444444444");
    expect(enqueue).toHaveBeenCalledWith({ organizationId, siteId, authorizationRef: "auth-1", trigger: "MANUAL", idempotencyKey: "manual-key", limits: { maxPages: 100, maxDepth: 3, maxDurationMs: 300_000, maxResponseBytes: 5_242_880 }, producerVersion: "a".repeat(40), normalizationPolicyVersion: "normalize/1", extractorVersion: "extract/1" });
    expect(audit).toHaveBeenCalledWith({ organizationId, userId, siteId, crawlRunId: result });
  });
  it("rejects missing authorization and cross-tenant sites before enqueue", async () => {
    const enqueue = vi.fn();
    await expect(startManualCrawl({ organizationId, siteId, userId, limits: { maxPages: 25, maxDepth: 1, maxDurationMs: 60_000, maxResponseBytes: 5_242_880 } }, { workspace: { get: vi.fn(async () => null) }, enqueue, audit: vi.fn(), revisions: { producerVersion: "a".repeat(40), normalizationPolicyVersion: "n", extractorVersion: "e" }, idempotencyKey: () => "k" })).rejects.toBeInstanceOf(CrawlSiteNotFoundError);
    await expect(startManualCrawl({ organizationId, siteId, userId, limits: { maxPages: 25, maxDepth: 1, maxDurationMs: 60_000, maxResponseBytes: 5_242_880 } }, { workspace: { get: vi.fn(async () => ({ site: { id: siteId }, authorization: null, latestRun: null })) }, enqueue, audit: vi.fn(), revisions: { producerVersion: "a".repeat(40), normalizationPolicyVersion: "n", extractorVersion: "e" }, idempotencyKey: () => "k" })).rejects.toBeInstanceOf(CrawlAuthorizationRequiredError);
    expect(enqueue).not.toHaveBeenCalled();
  });
});

describe("POST /api/sites/[siteId]/crawl", () => {
  it("parses bounded values and redirects to the created run", async () => {
    const start = vi.fn(async () => "44444444-4444-4444-8444-444444444444");
    const response = await startSiteCrawl(request({ maxPages: "100", maxDepth: "3", maxDurationSeconds: "300", allowedHost: "evil.example" }), siteId, { authStore: authStore(), crawl: { start } });
    expect(start).toHaveBeenCalledWith({ organizationId, userId, siteId, limits: { maxPages: 100, maxDepth: 3, maxDurationMs: 300_000, maxResponseBytes: 5_242_880 } });
    expect(response.headers.get("location")).toBe(`https://app.example/sites/${siteId}?run=44444444-4444-4444-8444-444444444444`);
  });
  it("returns stable validation, authorization, overlap, publication, and not-found responses", async () => {
    const invalid = await startSiteCrawl(request({ maxPages: "101" }), siteId, { authStore: authStore(), crawl: { start: vi.fn() } });
    expect(new URL(invalid.headers.get("location")!).searchParams.get("error")).toContain("1 to 100");
    for (const [error, message] of [[new CrawlAuthorizationRequiredError(), "Authorize this website"], [Object.assign(new Error(), { name: "CrawlOverlapError" }), "already active"], [new Error("redis secret"), "queue is unavailable"]] as const) {
      const response = await startSiteCrawl(request(), siteId, { authStore: authStore(), crawl: { start: vi.fn(async () => { throw error; }) } });
      expect(new URL(response.headers.get("location")!).searchParams.get("error")).toContain(message);
      expect(response.headers.get("location")).not.toContain("redis%20secret");
    }
    const missing = await startSiteCrawl(request(), siteId, { authStore: authStore(), crawl: { start: vi.fn(async () => { throw new CrawlSiteNotFoundError(); }) } });
    expect(missing.status).toBe(404);
  });
});
