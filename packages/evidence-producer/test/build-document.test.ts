/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from "vitest";
import { validateEvidence } from "@website-bot-scroll/evidence-contract";
import { buildEvidenceDocument } from "../src/build-document.js";

const snapshot = { id: "snapshot-1", payload: { run: { id: "run-1", trigger: "manual", status: "completed", startedAt: "2026-11-21T00:00:00.000Z", finishedAt: "2026-11-21T00:00:01.000Z", scope: { seed_urls: ["https://example.test/"], allowed_hosts: ["example.test"] }, limits: { max_pages: 1, max_depth: 0, max_duration_ms: 1000 }, producerRevision: "a".repeat(40), normalizationPolicyVersion: "1.0.0", extractorVersion: "1.0.0", stopReason: "frontier_exhausted", coverage: { discovered: 0, attempted: 0, collected: 0, failed: 0, unattempted: 0 } }, subjects: [], observations: [], diagnosticExecutions: [], diagnosticResults: [], evidencePages: [], evidenceLimitations: [], evidenceErrors: [] } };

describe("canonical evidence projection", () => {
  it("maps missing diagnostics to unavailable evidence and remains contract-valid", () => {
    const document = buildEvidenceDocument(snapshot, { producerVersion: "0.1.0" });
    expect(document.diagnostics).toEqual({ id: "diagnostics-run-1", status: "not_collected", value: null, reasons: ["incomplete_evidence"] });
    expect(validateEvidence(document)).toEqual({ valid: true });
  });

  it("rejects unsupported observation definition versions", () => {
    const changed: any = structuredClone(snapshot); changed.payload.observations = [{ definition: { key: "page.metadata", version: "2.0.0" } }];
    expect(() => buildEvidenceDocument(changed, { producerVersion: "0.1.0" })).toThrow("unsupported observation definition");
  });

  it("projects only the exact ordered HTTP transaction references and rejects dangling IDs", () => {
    const changed: any = structuredClone(snapshot);
    changed.payload.run.coverage = { discovered: 1, attempted: 1, collected: 1, failed: 0, unattempted: 0 };
    changed.payload.subjects = [{ id: "subject-1", kind: "page", identity: { pageId: "page-1" }, members: [] }];
    changed.payload.observations = [{ id: "legacy-http", subjectId: "subject-1", status: "observed", payload: { transactions: ["tx-2"], final_transaction_id: "tx-2" }, reasons: [], provenance: { collector: "http", version: "1.0.0", collectedAt: "2026-11-21T00:00:00.500Z" }, collectedAt: "2026-11-21T00:00:00.500Z", definition: { key: "page.http", version: "1.0.0" } }];
    const transaction = (id: string, position: number) => ({ id, position, requestUrl: `https://example.test/${id}`, responseUrl: `https://example.test/${id}`, method: "GET", statusCode: 200, startedAt: "2026-11-21T00:00:00.100Z", finishedAt: "2026-11-21T00:00:00.200Z", headers: [], transferredBytes: 1, decodedBytes: 1, redirectTo: null });
    changed.payload.evidencePages = [{ id: "page-1", depth: 0, discoveredUrl: "https://example.test/", requestedUrl: "https://example.test/", normalizedUrl: "https://example.test/", finalUrl: "https://example.test/tx-2", canonicalUrls: [], transactions: [transaction("tx-1", 0), transaction("tx-2", 1)] }];
    const document = buildEvidenceDocument(changed, { producerVersion: "0.1.0" });
    const pages = document.pages as any[];
    expect(pages[0].observations.http.value.transactions.map(({ id }: { id: string }) => id)).toEqual(["tx-2"]);
    changed.payload.observations[0].payload.transactions = ["missing"];
    expect(() => buildEvidenceDocument(changed, { producerVersion: "0.1.0" })).toThrow("transaction reference");
  });

  it("preserves page scope for collection limitations", () => {
    const changed: any = structuredClone(snapshot);
    changed.payload.evidenceLimitations = [{ code: "page_blocked", message: "Blocked", pageId: "page-1" }];
    expect((buildEvidenceDocument(changed, { producerVersion: "0.1.0" }) as any).run.limitations[0]).toEqual({ code: "page_blocked", message: "Blocked", page_id: "page-1" });
  });
});
