export const EXCHANGE_PROFILE = "seo-crawl-evidence-exchange-profile/0.1.0" as const;
export interface ExchangeProfileIssue { code: string; path: string; message: string }
export interface ExchangeProfileResult { eligible: boolean; issues: ExchangeProfileIssue[] }

export function preflightExchangeBytes(bytes: Uint8Array): ExchangeProfileResult {
  const issues: ExchangeProfileIssue[] = [];
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) issues.push({ code: "utf8_bom", path: "/", message: "UTF-8 BOM is not permitted" });
  const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  const lexicalNumbers = text.replace(/"(?:\\.|[^"\\])*"/g, '""');
  if (text.includes("�")) issues.push({ code: "invalid_utf8", path: "/", message: "Invalid UTF-8 is not permitted" });
  const integers = lexicalNumbers.match(/(?<![\w."])-?\d+(?![\w."])/g) ?? [];
  for (const token of integers) if (!Number.isSafeInteger(Number(token))) { issues.push({ code: "unsafe_integer", path: "/", message: "Integer exceeds the safe range" }); break; }
  if (/(?:^|[:,]|\[)\s*-0(?:\s*[,}\]])/.test(lexicalNumbers) || /\b\d+(?:\.\d+|[eE][+-]?\d+)\b/.test(lexicalNumbers)) issues.push({ code: "numeric_spelling", path: "/", message: "Only ordinary decimal integers are permitted" });
  if (/T\d{2}:\d{2}:\d{2}\.\d{4,}Z/.test(text)) issues.push({ code: "timestamp_precision", path: "/", message: "Timestamp precision exceeds milliseconds" });
  if (/T\d{2}:\d{2}:60(?:\.\d+)?Z/.test(text)) issues.push({ code: "leap_second", path: "/", message: "Leap seconds are not permitted" });
  if (/\\(?:\\|u00(?:0[0-9a-f]|7f))/i.test(text) && /"(?:url|discovered_url|requested_url|normalized_url|final_url|canonical_urls|link|location)"/i.test(text)) issues.push({ code: "url_character", path: "/", message: "Ambiguous URL characters are not permitted" });
  try { JSON.parse(text.replace(/^\uFEFF/, "")); } catch { issues.push({ code: "json_parse", path: "/", message: "Malformed JSON" }); }
  return { eligible: issues.length === 0, issues };
}
