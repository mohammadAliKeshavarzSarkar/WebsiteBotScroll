import { describe, expect, it } from "vitest";
import { preflightExchangeBytes } from "../src/exchange-profile.js";
import { serializeEvidence } from "../src/serialize.js";

describe("exact evidence bytes and exchange profile", () => {
  it("uses deterministic two-space UTF-8 with exactly one final LF", () => {
    const bytes = serializeEvidence({ text: "عنوان فارسی", nested: { b: 2, a: 1 } });
    expect(Buffer.from(bytes).toString("utf8")).toBe('{\n  "nested": {\n    "a": 1,\n    "b": 2\n  },\n  "text": "عنوان فارسی"\n}\n');
    expect(preflightExchangeBytes(bytes)).toEqual({ eligible: true, issues: [] });
  });

  it.each([
    [Buffer.from([0xef, 0xbb, 0xbf, 0x7b, 0x7d]), "utf8_bom"],
    [Buffer.from('{"n":9007199254740992}'), "unsafe_integer"],
    [Buffer.from('{"n":1e2}'), "numeric_spelling"],
    [Buffer.from('{"at":"2026-11-21T00:00:00.0001Z"}'), "timestamp_precision"],
    [Buffer.from('{"url":"https:\\\\example.test"}'), "url_character"],
  ])("rejects ineligible bytes without rewriting them", (bytes, code) => expect(preflightExchangeBytes(bytes).issues.map((issue) => issue.code)).toContain(code));
});
