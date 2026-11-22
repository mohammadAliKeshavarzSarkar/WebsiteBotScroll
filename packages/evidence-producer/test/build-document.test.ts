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
});
