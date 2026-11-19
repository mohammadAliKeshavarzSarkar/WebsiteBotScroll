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
        { id: "diag-1", rule_id: "title", rule_version: "1", policy_version: "1", subject_page_id: "page-home", outcome: "fail", observation_ids: ["obs-metadata-home"], limitations: [] },
        { id: "diag-1", rule_id: "heading", rule_version: "1", policy_version: "1", subject_page_id: "page-home", outcome: "fail", observation_ids: ["obs-headings-home"], limitations: [] }
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
      { id: "diag-1", rule_id: "title", rule_version: "1", policy_version: "1", subject_page_id: "missing-page", outcome: "fail", observation_ids: ["missing-observation"], limitations: [] }
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
      { id: "diag-1", rule_id: "rendered-title", rule_version: "1", policy_version: "1", subject_page_id: "page-home", outcome: "pass", observation_ids: ["obs-render-home"], limitations: [] }
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

  it("rejects dangling link and limitation page references", () => {
    const doc = load("internal-links-uninspected");
    const links = doc.pages[0]!.observations.links.value as Array<{ target_page_id: string | null }>;
    links[0]!.target_page_id = "missing-page";
    Object.assign(doc.run, { limitations: [{ code: "run", message: "run", page_id: "missing-page" }] });
    doc.diagnostics = {
      id: "obs-diagnostics", status: "observed", reasons: [],
      provenance: { method: "diagnostic_engine", collected_at: "2026-11-18T10:01:00Z", source: "derived" },
      value: [{ id: "diag-1", rule_id: "links", rule_version: "1", policy_version: "1", subject_page_id: "page-links", outcome: "fail", observation_ids: ["obs-links"], limitations: [{ code: "diag", message: "diag", page_id: "missing-page" }] }],
    };
    expect(codes(doc).filter((code) => code === "semantic.dangling_page_reference")).toHaveLength(3);
  });

  it("rejects unexplained partial runs and reverse chronology", () => {
    const doc = load("partial-crawl") as unknown as TestDocument & { run: { stop_reason: string | null; limitations: unknown[]; started_at: string; finished_at: string | null } };
    doc.run.stop_reason = null;
    doc.run.limitations = [];
    doc.run.finished_at = "2026-11-18T09:59:59Z";
    expect(codes(doc)).toEqual(expect.arrayContaining([
      "semantic.partial_stop_reason_required",
      "semantic.partial_limitation_required",
      "semantic.run_time_order_invalid",
    ]));
  });

  it("rejects transaction end times before start times", () => {
    const doc = load("redirect-repeated-headers") as unknown as TestDocument & { pages: Array<{ observations: { http: { value: { transactions: Array<{ started_at: string; finished_at: string }> } } } }> };
    doc.pages[0]!.observations.http.value.transactions[0]!.finished_at = "2026-11-18T09:59:59Z";
    expect(codes(doc)).toContain("semantic.transaction_time_order_invalid");
  });

  it("rejects diagnostics that pass using their own envelope or partial evidence", () => {
    const selfSupported = load();
    selfSupported.diagnostics = { id: "obs-diagnostics", status: "observed", reasons: [], provenance: { method: "diagnostic_engine", collected_at: "2026-11-18T10:01:00Z", source: "derived" }, value: [
      { id: "diag-self", rule_id: "self", rule_version: "1", policy_version: "1", subject_page_id: "page-home", outcome: "pass", observation_ids: ["obs-diagnostics"], limitations: [] },
    ] };
    expect(codes(selfSupported)).toContain("semantic.pass_requires_observed_page_evidence");

    const partial = load("internal-links-uninspected");
    partial.diagnostics = { id: "obs-diagnostics", status: "observed", reasons: [], provenance: { method: "diagnostic_engine", collected_at: "2026-11-18T10:01:00Z", source: "derived" }, value: [
      { id: "diag-partial", rule_id: "absence", rule_version: "1", policy_version: "1", subject_page_id: "page-links", outcome: "pass", observation_ids: ["obs-links"], limitations: [] },
    ] };
    expect(codes(partial)).toContain("semantic.pass_requires_observed_page_evidence");
  });

  it("rejects credential-bearing and recognizable signed URLs", () => {
    const doc = load();
    const unsafe = doc as unknown as { run: { scope: { seed_urls: string[] } } };
    unsafe.run.scope.seed_urls[0] = "https://user:secret@example.com/";
    expect(codes(doc)).toContain("semantic.unsafe_url");

    const signed = load("redirect-repeated-headers") as unknown as TestDocument & { pages: Array<{ observations: { http: { value: { transactions: Array<{ headers: Array<{ name: string; values: string[] }> }> } } } }> };
    signed.pages[0]!.observations.http.value.transactions[0]!.headers.push({ name: "location", values: ["https://example.com/final?X-Amz-Signature=secret"] });
    expect(codes(signed)).toContain("semantic.sensitive_header_url");
  });

  it("rejects redirect histories attributed to a different requested URL", () => {
    const doc = load("redirect-repeated-headers") as unknown as TestDocument & { pages: Array<{ url_identity: { requested_url: string }; observations: { http: { value: { transactions: Array<{ request_url: string }> } } } }> };
    doc.pages[0]!.url_identity.requested_url = "https://example.com/unrelated";
    expect(codes(doc)).toContain("semantic.initial_request_url_mismatch");
  });

  it("applies URL-secret validation to metadata canonical declarations", () => {
    const doc = load();
    const metadata = doc.pages[0]!.observations.metadata.value as { canonical_urls: string[] };
    metadata.canonical_urls = ["https://user:secret@example.com/private"];
    expect(codes(doc)).toContain("semantic.unsafe_url");
  });

  it("returns a structured issue instead of throwing for an unparseable URL", () => {
    const doc = load();
    const unsafe = doc as unknown as { run: { scope: { seed_urls: string[] } } };
    unsafe.run.scope.seed_urls = ["http://[::1"];
    expect(() => codes(doc)).not.toThrow();
    expect(codes(doc)).toContain("semantic.url_parse_error");
  });

  it("rejects duplicate transaction and link identities in their run-local namespaces", () => {
    const redirect = load("redirect-repeated-headers") as unknown as TestDocument & { pages: Array<{ observations: { http: { value: { transactions: Array<{ id: string }> } } } }> };
    redirect.pages[0]!.observations.http.value.transactions[1]!.id = redirect.pages[0]!.observations.http.value.transactions[0]!.id;
    expect(codes(redirect)).toContain("semantic.duplicate_transaction_id");

    const links = load("internal-links-uninspected");
    const values = links.pages[0]!.observations.links.value as Array<Record<string, unknown>>;
    values.push(structuredClone(values[0]!));
    expect(codes(links)).toContain("semantic.duplicate_link_id");
  });

  it("enforces subject-page and explicit cross-page diagnostic evidence scope", () => {
    const doc = load();
    const second = structuredClone(doc.pages[0]!);
    second.id = "page-second";
    for (const observation of Object.values(second.observations)) observation.id = `${observation.id}-second`;
    doc.pages.push(second);
    doc.run.coverage.discovered = 2;
    doc.run.coverage.attempted = 2;
    doc.run.coverage.collected = 2;
    doc.diagnostics = { id: "obs-diagnostics", status: "observed", reasons: [], provenance: { method: "diagnostic_engine", collected_at: "2026-11-18T10:01:00Z", source: "derived" }, value: [
      { id: "diag-scope", rule_id: "same-page", rule_version: "1", policy_version: "1", evidence_scope: "subject_page", related_page_ids: [], subject_page_id: "page-home", outcome: "fail", observation_ids: ["obs-metadata-home-second"], limitations: [] },
    ] };
    expect(codes(doc)).toContain("semantic.diagnostic_evidence_scope_mismatch");

    const diagnostic = (doc.diagnostics.value as Array<Record<string, unknown>>)[0]!;
    diagnostic.evidence_scope = "cross_page";
    diagnostic.related_page_ids = ["page-second"];
    expect(codes(doc)).not.toContain("semantic.diagnostic_evidence_scope_mismatch");
  });

  it("rejects missing, duplicate, and overlapping field override pointers", () => {
    const doc = load();
    Object.assign(doc.pages[0]!.observations.metadata, {
      field_overrides: [
        { path: "/missing", provenance: { method: "override", collected_at: "2026-11-18T10:00:02Z", source: "derived" } },
        { path: "/title", provenance: { method: "override", collected_at: "2026-11-18T10:00:02Z", source: "derived" } },
        { path: "/title", provenance: { method: "override", collected_at: "2026-11-18T10:00:02Z", source: "derived" } },
        { path: "/canonical_urls", provenance: { method: "override", collected_at: "2026-11-18T10:00:02Z", source: "derived" } },
        { path: "/canonical_urls/0", provenance: { method: "override", collected_at: "2026-11-18T10:00:02Z", source: "derived" } },
      ],
    });
    expect(codes(doc)).toEqual(expect.arrayContaining([
      "semantic.field_override_target_missing",
      "semantic.duplicate_field_override",
      "semantic.overlapping_field_override",
    ]));
  });
});
