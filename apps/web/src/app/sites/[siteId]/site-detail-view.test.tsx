import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SiteDetailView } from "./site-detail-view";

Object.assign(globalThis, { React });
const site = { id: "site-1", name: "Main shop", origin: "https://example.com" };

describe("owner site detail", () => {
  it("labels the declaration honestly and keeps crawling unavailable before authorization", () => {
    const html = renderToStaticMarkup(<SiteDetailView site={site} authorization={null} latestRun={null} />);
    expect(html).toContain("Owner declaration");
    expect(html).toContain("not technical domain verification");
    expect(html).toContain('action="/api/sites/site-1/authorize"');
    expect(html).toContain('name="declaration"');
    expect(html).not.toContain('action="/api/sites/site-1/crawl"');
  });

  it("shows the exact scope and persisted run state without a score", () => {
    const html = renderToStaticMarkup(<SiteDetailView site={site} authorization={{ id: "auth-1", description: "Owner-declared crawl authorization", scope: { seed_urls: ["https://example.com/"], allowed_hosts: ["example.com"], include_patterns: [], exclude_patterns: [] }, createdAt: new Date("2026-11-24T09:00:00Z") }} latestRun={{ id: "run-1", status: "FAILED", createdAt: new Date("2026-11-24T09:01:00Z"), startedAt: new Date("2026-11-24T09:01:01Z"), finishedAt: new Date("2026-11-24T09:01:03Z"), stopReason: "worker_error", coverage: { discovered: 3, attempted: 2, collected: 1, failed: 1, unattempted: 1 }, errors: [{ code: "request_failed", message: "The page could not be collected.", url: null, retryable: true }] }} feedback={{ authorized: true }} />);
    expect(html).toContain("Authorized for bounded collection");
    expect(html).toContain("https://example.com/");
    expect(html).toContain("FAILED");
    expect(html).toContain("1 collected");
    expect(html).toContain("The page could not be collected.");
    expect(html).not.toContain("SEO score");
  });

  it("renders stable route feedback", () => {
    const html = renderToStaticMarkup(<SiteDetailView site={site} authorization={null} latestRun={null} feedback={{ error: "Confirm authorization" }} />);
    expect(html).toContain('role="alert"');
    expect(html).toContain("Confirm authorization");
  });
});
