import { describe, expect, it } from "vitest";
import { extractHtmlObservations } from "./html-observations.js";

const encoder = new TextEncoder();
const request = (html: string | Uint8Array) => ({
  runId: "run-1", pageId: "page-1", pageUrl: "https://example.test/fa/page",
  html: typeof html === "string" ? encoder.encode(html) : html,
  collectedAt: "2026-11-19T00:00:00.000Z", extractorVersion: "extract/1", hashMethodVersion: "hash/1",
});
const byMethod = (html: string | Uint8Array) =>
  Object.fromEntries(extractHtmlObservations(request(html)).map((observation) => [observation.method, observation]));

describe("extractHtmlObservations", () => {
  it("extracts explicit metadata, headings, content, links, and rendering envelopes", () => {
    const observations = byMethod(`<!doctype html><html lang="fa"><head>
      <title>صفحه نمونه</title><meta name="description" content="توضیح">
      <meta name="robots" content="index,follow"><link rel="canonical" href="/canonical">
      </head><body><h1>عنوان</h1><h2>عنوان دوم</h2><a href="/next">بعدی</a><p>متن فارسی</p></body></html>`);
    expect(Object.keys(observations)).toEqual(["metadata", "headings", "structured_data", "content", "links", "rendering"]);
    expect(observations.metadata).toMatchObject({ status: "observed", value: {
      title: "صفحه نمونه", meta_description: "توضیح", canonical_urls: ["https://example.test/canonical"],
      robots: ["index", "follow"], language: "fa",
    } });
    expect(observations.headings?.value).toEqual([{ level: 1, text: "عنوان" }, { level: 2, text: "عنوان دوم" }]);
    expect(observations.content).toMatchObject({ status: "observed", value: { hash_method_version: "hash/1" } });
    expect(observations.links?.value).toEqual([expect.objectContaining({ target_url: "https://example.test/next", kind: "internal", discovery_method: "anchor", inspected: false })]);
    expect(observations.rendering).toMatchObject({ status: "not_collected", value: null, reasons: ["browser_rendering_disabled"] });
  });

  it("represents observed metadata absence without making it unavailable", () => {
    expect(byMethod("<html><head></head><body><p>Visible</p></body></html>").metadata).toMatchObject({ status: "observed", reasons: [], value: {
      title: null, meta_description: null, canonical_urls: [], robots: [], language: null,
    } });
  });

  it("preserves malformed JSON-LD as an observed structured-data item", () => {
    expect(byMethod('<html><head><script type="application/ld+json">{"@type":</script></head></html>').structured_data?.value).toEqual([
      expect.objectContaining({ format: "json-ld", parsed: false, types: [], error: expect.any(String), raw_hash: expect.stringMatching(/^[a-f0-9]{64}$/) }),
    ]);
  });

  it("extracts JSON-LD types without retaining its raw text", () => {
    const observations = byMethod('<script type="application/ld+json">{"@context":"https://schema.org","@type":["Article","NewsArticle"]}</script>');
    expect(observations.structured_data?.value).toEqual([
      expect.objectContaining({ format: "json-ld", parsed: true, types: ["Article", "NewsArticle"], error: null }),
    ]);
    expect(JSON.stringify(observations)).not.toContain("@context");
  });

  it("returns failed source observations for invalid UTF-8 without throwing", () => {
    const observations = extractHtmlObservations(request(new Uint8Array([0xc3, 0x28])));
    expect(observations.filter(({ method }) => method !== "rendering"))
      .toEqual(expect.arrayContaining([expect.objectContaining({ status: "failed", value: null, reasons: ["incomplete_evidence"] })]));
    expect(observations.find(({ method }) => method === "rendering"))
      .toMatchObject({ status: "not_collected", reasons: ["browser_rendering_disabled"] });
  });
});
