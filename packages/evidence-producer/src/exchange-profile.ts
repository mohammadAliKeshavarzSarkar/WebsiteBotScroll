export const EXCHANGE_PROFILE = "seo-crawl-evidence-exchange-profile/0.1.0" as const;
export interface ExchangeProfileIssue { code: string; path: string; message: string }
export interface ExchangeProfileResult { eligible: boolean; issues: ExchangeProfileIssue[] }

const issue = (issues: ExchangeProfileIssue[], code: string, path: string, message: string) => {
  if (!issues.some((candidate) => candidate.code === code && candidate.path === path)) issues.push({ code, path, message });
};

const scalar = (value: string, path: string, issues: ExchangeProfileIssue[]) => {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) issue(issues, "unicode_scalar", path, "Unpaired Unicode surrogate is not permitted");
      else index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) issue(issues, "unicode_scalar", path, "Unpaired Unicode surrogate is not permitted");
  }
};

function scanJson(text: string, issues: ExchangeProfileIssue[]): unknown {
  let index = 0;
  const space = () => { while (/\s/.test(text[index] ?? "")) index += 1; };
  const string = (path: string): string => {
    const start = index++;
    while (index < text.length) {
      if (text[index] === "\\") { index += text[index + 1] === "u" ? 6 : 2; continue; }
      if (text[index++] === '"') break;
    }
    const token = text.slice(start, index);
    const decoded = JSON.parse(token) as string;
    scalar(decoded, path, issues);
    return decoded;
  };
  const number = (path: string): number => {
    const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(text.slice(index));
    if (!match) throw new SyntaxError("invalid number");
    index += match[0].length;
    if (!/^(?:0|-[1-9]\d*|[1-9]\d*)$/.test(match[0])) issue(issues, "numeric_spelling", path, "Only ordinary decimal integers are permitted");
    if (!Number.isSafeInteger(Number(match[0]))) issue(issues, "unsafe_integer", path, "Integer exceeds the safe range");
    return Number(match[0]);
  };
  const value = (path: string): unknown => {
    space(); const current = text[index];
    if (current === '"') return string(path);
    if (current === "{") {
      index += 1; const result = Object.create(null) as Record<string, unknown>; const keys = new Set<string>(); space();
      if (text[index] === "}") { index += 1; return result; }
      while (true) {
        space(); if (text[index] !== '"') throw new SyntaxError("object key expected");
        const key = string(path); const childPath = `${path === "/" ? "" : path}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`;
        if (keys.has(key)) issue(issues, "duplicate_member", childPath, "Duplicate JSON member is not permitted");
        keys.add(key); space(); if (text[index++] !== ":") throw new SyntaxError("colon expected"); result[key] = value(childPath); space();
        if (text[index] === "}") { index += 1; return result; }
        if (text[index++] !== ",") throw new SyntaxError("comma expected");
      }
    }
    if (current === "[") {
      index += 1; const result: unknown[] = []; space(); if (text[index] === "]") { index += 1; return result; }
      while (true) { result.push(value(`${path}/${result.length}`)); space(); if (text[index] === "]") { index += 1; return result; } if (text[index++] !== ",") throw new SyntaxError("comma expected"); }
    }
    for (const [token, parsed] of [["true", true], ["false", false], ["null", null]] as const) if (text.startsWith(token, index)) { index += token.length; return parsed; }
    return number(path);
  };
  const parsed = value("/"); space(); if (index !== text.length) throw new SyntaxError("trailing JSON input"); return parsed;
}

const hasUrlCharacters = (value: string) => [...value].some((character) => character === "\\" || character.charCodeAt(0) <= 0x1f || character.charCodeAt(0) === 0x7f);
const urlKey = (key: string) => key === "url" || key.endsWith("_url") || key === "redirect_to" || key === "canonical_urls" || key === "seed_urls";
const inspectValues = (value: unknown, path: string, key: string, issues: ExchangeProfileIssue[]): void => {
  if (typeof value === "string") {
    if (urlKey(key) && hasUrlCharacters(value)) issue(issues, "url_character", path, "Ambiguous URL characters are not permitted");
    if (/(?:^|_)at$/.test(key) || key.endsWith("At")) {
      if (/T\d{2}:\d{2}:\d{2}\.\d{4,}(?:Z|[+-]\d{2}:\d{2})$/.test(value)) issue(issues, "timestamp_precision", path, "Timestamp precision exceeds milliseconds");
      if (/T\d{2}:\d{2}:60(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) issue(issues, "leap_second", path, "Leap seconds are not permitted");
    }
    return;
  }
  if (Array.isArray(value)) { value.forEach((item, position) => inspectValues(item, `${path}/${position}`, key, issues)); return; }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if ((record.name === "location" || record.name === "link") && Array.isArray(record.values)) record.values.forEach((item, position) => {
      if (typeof item === "string" && hasUrlCharacters(item)) issue(issues, "url_character", `${path}/values/${position}`, "Ambiguous URL header characters are not permitted");
    });
    for (const [childKey, child] of Object.entries(record)) inspectValues(child, `${path === "/" ? "" : path}/${childKey}`, childKey, issues);
  }
};

export function inspectExchangeJsonBytes(bytes: Uint8Array): { value?: unknown; issues: ExchangeProfileIssue[] } {
  const issues: ExchangeProfileIssue[] = [];
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) issues.push({ code: "utf8_bom", path: "/", message: "UTF-8 BOM is not permitted" });
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { issue(issues, "invalid_utf8", "/", "Invalid UTF-8 is not permitted"); return { issues }; }
  try { const value = scanJson(text.replace(/^\uFEFF/, ""), issues); inspectValues(value, "/", "", issues); return { value, issues }; }
  catch { issue(issues, "json_parse", "/", "Malformed JSON"); return { issues }; }
}

export function preflightExchangeBytes(bytes: Uint8Array): ExchangeProfileResult {
  const { issues } = inspectExchangeJsonBytes(bytes);
  return { eligible: issues.length === 0, issues };
}
