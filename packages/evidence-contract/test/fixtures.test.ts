import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { validateEvidence } from "../src/validate.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const readFixture = (kind: "valid" | "invalid", name: string): unknown =>
  JSON.parse(readFileSync(resolve(root, "fixtures", kind, `${name}.json`), "utf8"));

const validFixtures = [
  "complete-page",
  "observed-absent-metadata",
  "partial-crawl",
  "redirect-repeated-headers",
  "rendering-not-collected",
  "malformed-structured-data",
  "internal-links-uninspected",
  "persian-utf8",
] as const;

const invalidFixtures = [
  "failed-as-empty",
  "duplicate-structural-property",
  "unsupported-version",
  "unexpected-property",
  "missing-partial-reason",
  "malformed-timestamp",
  "invalid-status-value-pairing",
  "duplicate-identities",
  "dangling-observation-reference",
  "inconsistent-coverage",
  "redirect-final-url-mismatch",
] as const;

describe("authoritative compatibility fixtures", () => {
  it.each(validFixtures)("accepts valid/%s.json", (name) => {
    expect(validateEvidence(readFixture("valid", name))).toEqual({ valid: true });
  });

  it.each(invalidFixtures)("rejects invalid/%s.json", (name) => {
    expect(validateEvidence(readFixture("invalid", name)).valid).toBe(false);
  });

  it("preserves Persian UTF-8 exactly", () => {
    const fixture = readFixture("valid", "persian-utf8") as {
      pages: Array<{ observations: { metadata: { value: { title: string } } } }>;
    };
    expect(fixture.pages[0]?.observations.metadata.value.title).toBe("راهنمای سئوی فنی");
  });

  it("preserves repeated header values and order", () => {
    const fixture = readFixture("valid", "redirect-repeated-headers") as {
      pages: Array<{ observations: { http: { value: { transactions: Array<{ headers: Array<{ name: string; values: string[] }> }> } } } }>;
    };
    const links = fixture.pages[0]?.observations.http.value.transactions[1]?.headers.find(({ name }) => name === "link");
    expect(links?.values).toEqual(["</fa>; rel=alternate; hreflang=fa", "</en>; rel=alternate; hreflang=en"]);
  });
});
