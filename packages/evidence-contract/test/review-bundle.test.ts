import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(packageRoot, "..", "..");
const manifestPath = resolve(packageRoot, "review-manifest.json");
const sha256 = (path: string): string =>
  createHash("sha256").update(readFileSync(path, "utf8").replaceAll("\r\n", "\n"), "utf8").digest("hex");

type ReviewManifest = {
  contract: { name: string; version: string; dialect: string; owner: string; schema_path: string; schema_sha256: string };
  checksum_algorithm: string;
  stage_boundary: { current: string; next: string };
  header_allowlist: string[];
  raw_html_policy: string;
  deferred_capabilities: string[];
  fixtures: Array<{ path: string; sha256: string; expected: string; validation_layer?: string }>;
};

describe("Stage A.1 consumer review bundle", () => {
  it("pins canonical identity, policy, and stage boundaries", () => {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as ReviewManifest;
    expect(manifest.contract).toMatchObject({
      name: "seo-crawl-evidence",
      version: "0.1.0",
      dialect: "https://json-schema.org/draft/2020-12/schema",
      owner: "WebsiteBotScroll",
      schema_path: "packages/evidence-contract/schema/seo-crawl-evidence/0.1.0/schema.json",
    });
    expect(manifest.checksum_algorithm).toBe("SHA-256");
    expect(manifest.stage_boundary).toEqual({ current: "A.1 contract readiness", next: "A.2 authorized synthetic producer-to-consumer exchange" });
    expect(manifest.raw_html_policy).toBe("excluded by default");
    expect(manifest.header_allowlist).toEqual([
      "location", "content-type", "x-robots-tag", "link", "content-language", "content-length", "content-encoding",
      "retry-after", "cache-control", "vary", "etag", "last-modified", "age",
    ]);
    expect(manifest.deferred_capabilities).toEqual(expect.arrayContaining(["REST", "MCP", "browser rendering", "Python consumer", "historical comparison"]));
  });

  it("pins the schema and every authoritative fixture by SHA-256", () => {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as ReviewManifest;
    const schemaPath = resolve(repositoryRoot, manifest.contract.schema_path);
    expect(manifest.contract.schema_sha256).toBe(sha256(schemaPath));

    const fixtureRoot = resolve(packageRoot, "fixtures");
    const actualPaths = ["valid", "invalid"].flatMap((kind) =>
      readdirSync(resolve(fixtureRoot, kind)).filter((name) => name.endsWith(".json")).map((name) => relative(repositoryRoot, resolve(fixtureRoot, kind, name)).replaceAll("\\", "/")),
    ).sort();
    expect(manifest.fixtures.map(({ path }) => path).sort()).toEqual(actualPaths);
    for (const fixture of manifest.fixtures) {
      expect(fixture.sha256).toBe(sha256(resolve(repositoryRoot, fixture.path)));
      expect(["valid", "invalid"]).toContain(fixture.expected);
    }
    expect(manifest.fixtures.find(({ path }) => path.endsWith("duplicate-structural-property.json"))?.validation_layer).toBe("raw_json_parser");
  });

  it("ships the architecture, preservation-gap, and entry-point documentation", () => {
    expect(existsSync(resolve(repositoryRoot, "docs", "architecture", "evidence-interoperability.md"))).toBe(true);
    expect(existsSync(resolve(repositoryRoot, "docs", "architecture", "evidence-preservation-gaps.md"))).toBe(true);
    expect(readFileSync(resolve(repositoryRoot, "README.md"), "utf8")).toContain("Evidence interoperability");
  });
});
