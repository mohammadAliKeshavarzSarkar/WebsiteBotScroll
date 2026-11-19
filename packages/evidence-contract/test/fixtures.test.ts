import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { parseEvidenceJson, validateEvidence } from "../src/validate.js";

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
    if (name === "duplicate-structural-property") {
      const raw = readFileSync(resolve(root, "fixtures", "invalid", `${name}.json`), "utf8");
      expect(parseEvidenceJson(raw).valid).toBe(false);
    } else {
      expect(validateEvidence(readFixture("invalid", name)).valid).toBe(false);
    }
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

  it("represents observed absent metadata on an inspected page", () => {
    const fixture = readFixture("valid", "observed-absent-metadata") as {
      pages: Array<{ observations: { metadata: { status: string; value: { title: null; meta_description: null; canonical_urls: unknown[] } } } }>;
    };
    expect(fixture.pages[0]?.observations.metadata).toMatchObject({
      status: "observed",
      value: { title: null, meta_description: null, canonical_urls: [] },
    });
  });

  it("represents rendering not collected on a page with a reason", () => {
    const fixture = readFixture("valid", "rendering-not-collected") as {
      pages: Array<{ observations: { rendering: { status: string; value: null; reasons: string[] } } }>;
    };
    expect(fixture.pages[0]?.observations.rendering).toEqual({
      id: "obs-render",
      status: "not_collected",
      value: null,
      reasons: ["browser_rendering_disabled"],
    });
  });

  it("requires a diagnostic policy version", () => {
    const fixture = readFixture("valid", "complete-page") as {
      diagnostics: { value: Array<Record<string, unknown>> };
    };
    delete fixture.diagnostics.value[0]?.policy_version;
    expect(validateEvidence(fixture).valid).toBe(false);
  });
});
