export interface ParseSitemapOptions { maxDecodedBytes?: number }
export interface ParsedSitemap { kind: "urlset" | "index"; locations: string[] }

function decodeXml(value: string): string {
  return value.replace(/&(amp|lt|gt|quot|apos);/g, (_, entity: string) => ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" })[entity]!);
}

export function parseSitemap(bytes: Uint8Array, options: ParseSitemapOptions = {}): ParsedSitemap {
  const max = options.maxDecodedBytes ?? 10_000_000;
  if (bytes.byteLength > max) throw new Error("Sitemap exceeds decoded byte limit");
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error("XML declarations with entities are forbidden");
  const kind = /<\s*sitemapindex(?:\s|>)/i.test(text) ? "index" : /<\s*urlset(?:\s|>)/i.test(text) ? "urlset" : undefined;
  if (!kind) throw new Error("Unsupported sitemap document");
  const locations = [...text.matchAll(/<\s*loc\s*>([\s\S]*?)<\s*\/\s*loc\s*>/gi)].map((match) => decodeXml(match[1]!.trim()));
  return { kind, locations };
}
