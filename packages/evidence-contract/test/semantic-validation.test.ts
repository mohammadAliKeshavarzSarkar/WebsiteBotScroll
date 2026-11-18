import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { validateEvidenceSemantics } from "../src/semantic-validation.js";
import type { EvidenceDocument } from "../src/types.js";
import { validateEvidence } from "../src/validate.js";

const fixtureRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "valid");
type TestObservation = {
  id: string;
  status: string;
  reasons: string[];
  value: unknown;
  provenance?: { method: string; collected_at: string; source: string };
};
type TestTransaction = { redirect_to: string | null };
type TestDocument = {
  run: { lifecycle: string; finished_at: string | null; coverage: { discovered: number; attempted: number; collected: number; failed: number } };
  pages: Array<{
    id: string;
    url_identity: { final_url: string };
    observations: Record<string, TestObservation> & {
      http: TestObservation & { value: { transactions: TestTransaction[] } | null };
      metadata: TestObservation;
      links: TestObservation;
    };
  }>;
  diagnostics: TestObservation;
  errors: Array<{ id: string; stage: string; code: string; message: string; occurred_at: string; retryable: boolean }>;
};
type Mutator = (document: TestDocument) => void;

const load = (name = "complete-page"): TestDocument => JSON.parse(readFileSync(resolve(fixtureRoot, `${name}.json`), "utf8")) as TestDocument;
const codes = (document: TestDocument): string[] => validateEvidenceSemantics(document as unknown as EvidenceDocument).map(({ code }) => code);

describe("cross-record semantic validation", () => {
  it.each([
    ["page", ((doc: TestDocument) => doc.pages.push(structuredClone(doc.pages[0]!))) satisfies Mutator, "semantic.duplicate_page_id"],
    ["observation", ((doc: TestDocument) => { doc.pages[0]!.observations.metadata.id = doc.pages[0]!.observations.http.id; }) satisfies Mutator, "semantic.duplicate_observation_id"],
    ["diagnostic", ((doc: TestDocument) => {
      doc.diagnostics = { id: "obs-diagnostics", status: "observed", reasons: [], provenance: { method: "diagnostic_engine", collected_at: "2026-11-18T10:01:00Z", source: "derived" }, value: [
        { id: "diag-1", rule_id: "title", rule_version: "1", subject_page_id: "page-home", outcome: "fail", observation_ids: ["obs-metadata-home"], limitations: [] },
        { id: "diag-1", rule_id: "heading", rule_version: "1", subject_page_id: "page-home", outcome: "fail", observation_ids: ["obs-headings-home"], limitations: [] }
      ] };
    }) satisfies Mutator, "semantic.duplicate_diagnostic_id"],
    ["error", ((doc: TestDocument) => { doc.errors = [
      { id: "error-1", stage: "http", code: "x", message: "x", occurred_at: "2026-11-18T10:00:00Z", retryable: false },
      { id: "error-1", stage: "http", code: "y", message: "y", occurred_at: "2026-11-18T10:00:01Z", retryable: false }
    ]; }) satisfies Mutator, "semantic.duplicate_error_id"],
  ])("rejects duplicate %s identities", (_kind, mutate, expected) => {
    const doc = load();
    mutate(doc);
    expect(codes(doc)).toContain(expected);
  });

  it("rejects dangling diagnostic page and observation references", () => {
    const doc = load();
    doc.diagnostics = { id: "obs-diagnostics", status: "observed", reasons: [], provenance: { method: "diagnostic_engine", collected_at: "2026-11-18T10:01:00Z", source: "derived" }, value: [
      { id: "diag-1", rule_id: "title", rule_version: "1", subject_page_id: "missing-page", outcome: "fail", observation_ids: ["missing-observation"], limitations: [] }
    ] };
    expect(codes(doc)).toEqual(expect.arrayContaining(["semantic.dangling_page_reference", "semantic.dangling_observation_reference"]));
  });

  it.each([
    ["terminal without finish", ((doc: TestDocument) => { doc.run.finished_at = null; }) satisfies Mutator, "semantic.terminal_finished_at_required"],
    ["nonterminal with finish", ((doc: TestDocument) => { doc.run.lifecycle = "running"; }) satisfies Mutator, "semantic.nonterminal_finished_at_forbidden"],
  ])("rejects %s", (_name, mutate, expected) => {
    const doc = load();
    mutate(doc);
    expect(codes(doc)).toContain(expected);
  });

  it("rejects coverage inconsistent with counters and represented pages", () => {
    const doc = load();
    doc.run.coverage.attempted = 3;
    doc.run.coverage.collected = 2;
    expect(codes(doc)).toEqual(expect.arrayContaining(["semantic.coverage_outcome_mismatch", "semantic.page_count_mismatch", "semantic.attempted_exceeds_discovered"]));
  });

  it("rejects a partial group without reasons when called directly", () => {
    const doc = load("internal-links-uninspected");
    doc.pages[0]!.observations.links.reasons = [];
    expect(codes(doc)).toContain("semantic.partial_reason_required");
  });

  it("rejects redirect chains that do not lead to the final URL", () => {
    const doc = load("redirect-repeated-headers");
    doc.pages[0]!.observations.http.value!.transactions[0]!.redirect_to = "https://example.com/wrong";
    doc.pages[0]!.url_identity.final_url = "https://example.com/also-wrong";
    expect(codes(doc)).toEqual(expect.arrayContaining(["semantic.redirect_discontinuity", "semantic.final_url_mismatch"]));
  });

  it("rejects pass diagnostics backed by unavailable evidence", () => {
    const doc = load();
    doc.diagnostics = { id: "obs-diagnostics", status: "observed", reasons: [], provenance: { method: "diagnostic_engine", collected_at: "2026-11-18T10:01:00Z", source: "derived" }, value: [
      { id: "diag-1", rule_id: "rendered-title", rule_version: "1", subject_page_id: "page-home", outcome: "pass", observation_ids: ["obs-render-home"], limitations: [] }
    ] };
    expect(codes(doc)).toContain("semantic.pass_requires_available_evidence");
  });

  it("runs semantics after structural validation through the public entry point", () => {
    const doc = load();
    doc.run.coverage.collected = 0;
    const result = validateEvidence(doc);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.errors.some(({ code }) => code === "semantic.page_count_mismatch")).toBe(true);
  });
});
