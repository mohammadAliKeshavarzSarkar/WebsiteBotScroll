import { createHash } from "node:crypto";
import { load } from "cheerio";
import { createEvidenceId, defineObservation, type ObservationInput } from "@website-bot-scroll/domain/evidence";

export interface HtmlObservationRequest {
  runId: string;
  pageId: string;
  pageUrl: string;
  html: Uint8Array;
  collectedAt: string;
  extractorVersion: string;
  hashMethodVersion: string;
}

const methods = ["metadata", "headings", "structured_data", "content", "links"] as const;
const sha256 = (value: Uint8Array | string): string => createHash("sha256").update(value).digest("hex");
const cleanText = (value: string): string => value.replace(/\s+/g, " ").trim();

function typesFrom(value: unknown): string[] {
  if (Array.isArray(value)) return [...new Set(value.flatMap(typesFrom))];
  if (value === null || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  const own = typeof record["@type"] === "string"
    ? [record["@type"]]
    : Array.isArray(record["@type"])
      ? record["@type"].filter((item): item is string => typeof item === "string")
      : [];
  return [...new Set([...own, ...Object.values(record).flatMap(typesFrom)])];
}

function envelope(request: HtmlObservationRequest, method: string, status: ObservationInput["status"], value: unknown, reasons: string[]): ObservationInput {
  return defineObservation({
    id: createEvidenceId("observation", [request.runId, request.pageId, method]),
    method,
    status,
    value,
    reasons,
    provenance: { collector: "html", version: request.extractorVersion, collectedAt: request.collectedAt },
  });
}

const renderingEnvelope = (request: HtmlObservationRequest): ObservationInput =>
  envelope(request, "rendering", "not_collected", null, ["browser_rendering_disabled"]);

export function extractHtmlObservations(request: HtmlObservationRequest): ObservationInput[] {
  let html: string;
  try {
    html = new TextDecoder("utf-8", { fatal: true }).decode(request.html);
  } catch {
    return [
      ...methods.map((method) => envelope(request, method, "failed", null, ["incomplete_evidence"])),
      renderingEnvelope(request),
    ];
  }

  try {
    const $ = load(html);
    const pageUrl = new URL(request.pageUrl);
    const canonicalUrls = $("link[rel~='canonical']").map((_index, element) => $(element).attr("href")).get()
      .flatMap((href) => { try { return [new URL(href, pageUrl).href]; } catch { return []; } });
    const robots = $("meta[name='robots' i]").attr("content")?.split(",").map((value) => value.trim()).filter(Boolean) ?? [];
    const title = cleanText($("title").first().text()) || null;
    const description = $("meta[name='description' i]").attr("content")?.trim() || null;
    const language = $("html").attr("lang")?.trim() || null;

    const headings = $("h1,h2,h3,h4,h5,h6").map((_index, element) => ({
      level: Number(element.tagName.slice(1)),
      text: cleanText($(element).text()),
    })).get();

    const structuredData = $("script[type='application/ld+json' i]").map((_index, element) => {
      const raw = $(element).text();
      try {
        const parsed: unknown = JSON.parse(raw);
        return { format: "json-ld", parsed: true, types: typesFrom(parsed), error: null, raw_hash: sha256(raw) };
      } catch (error) {
        return { format: "json-ld", parsed: false, types: [], error: error instanceof Error ? error.message : "Invalid JSON-LD", raw_hash: sha256(raw) };
      }
    }).get();

    $("script,style,noscript,template").remove();
    const visibleText = cleanText($("body").text());
    const rawHash = sha256(request.html);
    const normalizedHash = sha256(visibleText);

    const links = $("a[href]").map((index, element) => $(element).attr("href") ? { index, href: $(element).attr("href")! } : null).get()
      .flatMap(({ index, href }) => {
        try {
          const target = new URL(href, pageUrl);
          return [{
            id: createEvidenceId("observation", [request.runId, request.pageId, "link", String(index), target.href]),
            target_url: target.href,
            kind: target.origin === pageUrl.origin ? "internal" : "external",
            discovery_method: "anchor",
            target_page_id: null,
            inspected: false,
          }];
        } catch { return []; }
      });

    const content = envelope(request, "content", "observed", {
      raw_sha256: rawHash,
      normalized_sha256: normalizedHash,
      hash_method_version: request.hashMethodVersion,
      visible_text_summary: visibleText.slice(0, 500),
    }, []);
    content.rawHash = rawHash;
    content.normalizedHash = normalizedHash;

    return [
      envelope(request, "metadata", "observed", { title, meta_description: description, canonical_urls: canonicalUrls, robots, language }, []),
      envelope(request, "headings", "observed", headings, []),
      envelope(request, "structured_data", "observed", structuredData, []),
      content,
      envelope(request, "links", "observed", links, []),
      renderingEnvelope(request),
    ];
  } catch {
    return [
      ...methods.map((method) => envelope(request, method, "failed", null, ["incomplete_evidence"])),
      renderingEnvelope(request),
    ];
  }
}
