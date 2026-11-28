import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SiteDetailView } from "./site-detail-view";

Object.assign(globalThis, { React });
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {} }) }));
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
    expect(html).toContain('action="/api/sites/site-1/crawl"');
    expect(html).toContain('name="maxPages"');
    expect(html).toContain('value="25"');
    expect(html).toContain('name="maxDepth"');
    expect(html).toContain('name="maxDurationSeconds"');
    expect(html).toContain("Crawl failed");
    expect(html).toContain("<dt>Pages collected</dt><dd>1</dd>");
    expect(html).toContain("The page could not be collected.");
    expect(html).not.toContain("SEO score");
  });

  it("explains a completed crawl and shows the collected page and status", () => {
    const html = renderToStaticMarkup(<SiteDetailView site={site} authorization={null} latestRun={{
      id: "run-1", status: "COMPLETED", createdAt: new Date(0), startedAt: new Date(0),
      finishedAt: new Date(4000), stopReason: "frontier_exhausted",
      coverage: { discovered: 1, attempted: 1, collected: 1, failed: 0, unattempted: 0 },
      pages: [{ url: "https://example.com/about", statusCode: 200 }], errors: [],
    }} />);
    expect(html).toContain("Crawl complete");
    expect(html).toContain("Processing time: 4 seconds");
    expect(html).toContain("Queue wait: Under 1 second");
    expect(html).toContain("Finished checking the pages found");
    expect(html).toContain("https://example.com/about");
    expect(html).toContain("HTTP 200");
    expect(html).toContain("1 of 1 pages collected");
    expect(html).toMatch(/<time datetime="1970-01-01T00:00:04\.000Z"/i);
    expect(html).toContain('<th scope="col">Final URL</th>');
    expect(html).not.toContain("frontier_exhausted");
  });

  it("distinguishes saving the report from crawling and completion", () => {
    const html = renderToStaticMarkup(<SiteDetailView site={site} authorization={null} latestRun={{
      id: "run-1", status: "RUNNING", createdAt: new Date(0), startedAt: new Date(4000),
      finishedAt: null, stopReason: "frontier_exhausted",
      coverage: { discovered: 1, attempted: 1, collected: 1, failed: 0, unattempted: 0 }, errors: [],
    }} />);
    expect(html).toContain("Saving results");
    expect(html).toContain("Queue wait: 4 seconds");
    expect(html).not.toContain("Crawl complete");
  });

  it("marks active runs for safe refresh and disables overlapping starts", () => {
    const html = renderToStaticMarkup(<SiteDetailView site={site} authorization={{ id: "auth-1", description: "Owner-declared crawl authorization", scope: { seed_urls: ["https://example.com/"], allowed_hosts: ["example.com"], include_patterns: [], exclude_patterns: [] }, createdAt: new Date("2026-11-24T09:00:00Z") }} latestRun={{ id: "run-1", status: "RUNNING", createdAt: new Date(), startedAt: new Date(), finishedAt: null, stopReason: null, coverage: { discovered: 1, attempted: 0, collected: 0, failed: 0, unattempted: 1 }, errors: [] }} />);
    expect(html).toContain('data-active-run="true"');
    expect(html).toContain("updates automatically while this tab is visible");
    expect(html).not.toContain('http-equiv="refresh"');
    expect(html).not.toContain('action="/api/sites/site-1/crawl"');
  });

  it("renders stable route feedback", () => {
    const html = renderToStaticMarkup(<SiteDetailView site={site} authorization={null} latestRun={null} feedback={{ error: "Confirm authorization" }} />);
    expect(html).toContain('role="alert"');
    expect(html).toContain("Confirm authorization");
  });
});
