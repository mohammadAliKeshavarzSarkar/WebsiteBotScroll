import { describe, expect, it } from "vitest";
import { preflightExchangeBytes } from "../src/exchange-profile.js";
import { serializeEvidence } from "../src/serialize.js";

describe("exact evidence bytes and exchange profile", () => {
  it("uses deterministic two-space UTF-8 with exactly one final LF", () => {
    const bytes = serializeEvidence({ text: "عنوان فارسی", nested: { b: 2, a: 1 } });
    expect(Buffer.from(bytes).toString("utf8")).toBe('{\n  "nested": {\n    "a": 1,\n    "b": 2\n  },\n  "text": "عنوان فارسی"\n}\n');
    expect(preflightExchangeBytes(bytes)).toEqual({ eligible: true, issues: [] });
  });

  it("uses locale-independent UTF-16 code-unit key ordering", () => {
    expect(Buffer.from(serializeEvidence({ ä: 1, z: 2 })).toString("utf8")).toBe('{\n  "z": 2,\n  "ä": 1\n}\n');
  });

  it("accepts valid replacement characters and ordinary non-URL backslashes", () => {
    expect(preflightExchangeBytes(Buffer.from(JSON.stringify({ title: "valid � and C:\\docs" })))).toEqual({ eligible: true, issues: [] });
  });

  it.each([
    [Buffer.from([0xef, 0xbb, 0xbf, 0x7b, 0x7d]), "utf8_bom"],
    [Buffer.from('{"n":9007199254740992}'), "unsafe_integer"],
    [Buffer.from('{"n":1e2}'), "numeric_spelling"],
    [Buffer.from('{"at":"2026-11-21T00:00:00.0001Z"}'), "timestamp_precision"],
    [Buffer.from('{"finished_at":"2026-11-21T00:00:00.0001+00:00"}'), "timestamp_precision"],
    [Buffer.from('{"started_at":"2026-11-21T00:00:60+00:00"}'), "leap_second"],
    [Buffer.from('{"url":"https:\\\\example.test"}'), "url_character"],
    [Buffer.from('{"redirect_to":"https:\\\\example.test"}'), "url_character"],
    [Buffer.from('{"redirect_to":"https://example.test/\\u007f"}'), "url_character"],
    [Buffer.from([0x7b, 0x22, 0x78, 0x22, 0x3a, 0x22, 0xc3, 0x28, 0x22, 0x7d]), "invalid_utf8"],
    [Buffer.from('{"title":"\\ud800"}'), "unicode_scalar"],
    [Buffer.from('{"url":"https://example.test/\\u007f"}'), "url_character"],
    [Buffer.from('{"x":1,"x":2}'), "duplicate_member"],
    [Buffer.from('{"n":-0}'), "numeric_spelling"],
  ])("rejects ineligible bytes without rewriting them", (bytes, code) => expect(preflightExchangeBytes(bytes).issues.map((issue) => issue.code)).toContain(code));
});
