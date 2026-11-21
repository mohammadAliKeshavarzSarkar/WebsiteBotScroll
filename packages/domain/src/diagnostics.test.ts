import { describe, expect, it } from "vitest";
import { defineDiagnosticResult, defineDiagnosticRule } from "./diagnostics.js";

const rule = () => ({
  key: "seo.title.consistency", version: "1.0.0", policyVersion: "2026-11",
  configurationSchema: { type: "object", additionalProperties: false },
  acceptedInputs: [{ observationKey: "page.metadata", observationVersion: "1.0.0", scopes: ["page", "cross_page"] as const, required: true }],
  outcomes: ["pass", "fail", "unknown"], supportsUnavailableInputs: false,
});

describe("diagnostic definitions", () => {
  it("pins immutable input versions, scopes, outcomes, policy, and configuration schema", () => {
    const defined = defineDiagnosticRule(rule());
    expect(defined.configurationSchemaSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(defined.acceptedInputs[0]).toEqual({ observationKey: "page.metadata", observationVersion: "1.0.0", scopes: ["page", "cross_page"], required: true });
    expect(defined.policyVersion).toBe("2026-11");
  });

  it.each([
    [{ ...rule(), outcomes: [] }, "outcome"],
    [{ ...rule(), outcomes: ["pass", "pass"] }, "outcome"],
    [{ ...rule(), acceptedInputs: [] }, "input"],
    [{ ...rule(), policyVersion: "" }, "policy"],
  ])("rejects invalid rule definitions", (input, message) => expect(() => defineDiagnosticRule(input)).toThrow(message));

  it("requires limitations when a diagnostic outcome is unknown", () => {
    expect(() => defineDiagnosticResult({ outcome: "unknown", limitations: [] })).toThrow("limitation");
    expect(defineDiagnosticResult({ outcome: "unknown", limitations: ["required_input_unavailable"] })).toEqual({ outcome: "unknown", limitations: ["required_input_unavailable"] });
  });
});
