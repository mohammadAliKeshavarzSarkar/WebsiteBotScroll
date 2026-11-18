import type { EvidenceDocument, ValidationIssue } from "./types.js";

type Observation = {
  id: string;
  status: string;
  value: unknown;
  reasons: string[];
};

type Transaction = {
  id: string;
  request_url: string;
  response_url: string;
  redirect_to: string | null;
};

type Page = {
  id: string;
  url_identity: { final_url: string };
  observations: Record<string, Observation> & {
    http: Observation & { value: null | { transactions: Transaction[]; final_transaction_id: string } };
  };
};

type Diagnostic = {
  id: string;
  subject_page_id: string;
  outcome: string;
  observation_ids: string[];
};

type ContractDocument = {
  run: {
    lifecycle: string;
    finished_at: string | null;
    coverage: { discovered: number; attempted: number; collected: number; failed: number; unattempted?: number };
  };
  pages: Page[];
  diagnostics: Observation & { value: Diagnostic[] | null };
  errors: Array<{ id: string; page_id?: string; observation_id?: string }>;
};

const issue = (code: string, path: string, message: string): ValidationIssue => ({ code, path, message });

const duplicateIssues = (
  values: Array<{ id: string; path: string }>,
  code: string,
  noun: string,
): ValidationIssue[] => {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  const issues: ValidationIssue[] = [];
  for (const value of values) {
    if (seen.has(value.id) && !duplicates.has(value.id)) {
      duplicates.add(value.id);
      issues.push(issue(code, value.path, `Duplicate ${noun} ID: ${value.id}`));
    }
    seen.add(value.id);
  }
  return issues;
};

export const validateEvidenceSemantics = (document: EvidenceDocument): ValidationIssue[] => {
  const value = document as unknown as ContractDocument;
  const issues: ValidationIssue[] = [];
  const terminal = new Set(["completed", "partial", "failed", "cancelled"]);

  issues.push(...duplicateIssues(value.pages.map((page, index) => ({ id: page.id, path: `/pages/${index}/id` })), "semantic.duplicate_page_id", "page"));

  const observations: Array<{ observation: Observation; path: string }> = [];
  value.pages.forEach((page, pageIndex) => {
    Object.entries(page.observations).forEach(([name, observation]) => {
      observations.push({ observation, path: `/pages/${pageIndex}/observations/${name}` });
    });
  });
  observations.push({ observation: value.diagnostics, path: "/diagnostics" });
  issues.push(...duplicateIssues(observations.map(({ observation, path }) => ({ id: observation.id, path: `${path}/id` })), "semantic.duplicate_observation_id", "observation"));

  const diagnostics = value.diagnostics.value ?? [];
  issues.push(...duplicateIssues(diagnostics.map((diagnostic, index) => ({ id: diagnostic.id, path: `/diagnostics/value/${index}/id` })), "semantic.duplicate_diagnostic_id", "diagnostic"));
  issues.push(...duplicateIssues(value.errors.map((error, index) => ({ id: error.id, path: `/errors/${index}/id` })), "semantic.duplicate_error_id", "error"));

  if (terminal.has(value.run.lifecycle) && value.run.finished_at === null) {
    issues.push(issue("semantic.terminal_finished_at_required", "/run/finished_at", "Terminal runs require finished_at."));
  }
  if (!terminal.has(value.run.lifecycle) && value.run.finished_at !== null) {
    issues.push(issue("semantic.nonterminal_finished_at_forbidden", "/run/finished_at", "Nonterminal runs must not have finished_at."));
  }

  const coverage = value.run.coverage;
  if (coverage.collected + coverage.failed !== coverage.attempted) {
    issues.push(issue("semantic.coverage_outcome_mismatch", "/run/coverage", "collected + failed must equal attempted."));
  }
  if (coverage.attempted > coverage.discovered) {
    issues.push(issue("semantic.attempted_exceeds_discovered", "/run/coverage/attempted", "attempted cannot exceed discovered."));
  }
  if (coverage.unattempted !== undefined && coverage.unattempted !== coverage.discovered - coverage.attempted) {
    issues.push(issue("semantic.unattempted_mismatch", "/run/coverage/unattempted", "unattempted must equal discovered - attempted."));
  }
  if (coverage.collected !== value.pages.length) {
    issues.push(issue("semantic.page_count_mismatch", "/run/coverage/collected", "collected must equal the number of represented pages."));
  }

  for (const { observation, path } of observations) {
    if (observation.status === "partial" && observation.reasons.length === 0) {
      issues.push(issue("semantic.partial_reason_required", `${path}/reasons`, "Partial observations require at least one reason."));
    }
  }

  const pageIds = new Set(value.pages.map(({ id }) => id));
  const observationById = new Map(observations.map(({ observation }) => [observation.id, observation]));
  diagnostics.forEach((diagnostic, diagnosticIndex) => {
    if (!pageIds.has(diagnostic.subject_page_id)) {
      issues.push(issue("semantic.dangling_page_reference", `/diagnostics/value/${diagnosticIndex}/subject_page_id`, "Diagnostic subject_page_id does not resolve."));
    }
    diagnostic.observation_ids.forEach((observationId, referenceIndex) => {
      const referenced = observationById.get(observationId);
      if (!referenced) {
        issues.push(issue("semantic.dangling_observation_reference", `/diagnostics/value/${diagnosticIndex}/observation_ids/${referenceIndex}`, "Diagnostic observation ID does not resolve."));
      } else if (diagnostic.outcome === "pass" && !["observed", "partial"].includes(referenced.status)) {
        issues.push(issue("semantic.pass_requires_available_evidence", `/diagnostics/value/${diagnosticIndex}/outcome`, "A passing diagnostic requires available evidence."));
      }
    });
  });

  value.errors.forEach((error, errorIndex) => {
    if (error.page_id !== undefined && !pageIds.has(error.page_id)) {
      issues.push(issue("semantic.dangling_page_reference", `/errors/${errorIndex}/page_id`, "Error page_id does not resolve."));
    }
    if (error.observation_id !== undefined && !observationById.has(error.observation_id)) {
      issues.push(issue("semantic.dangling_observation_reference", `/errors/${errorIndex}/observation_id`, "Error observation_id does not resolve."));
    }
  });

  value.pages.forEach((page, pageIndex) => {
    const http = page.observations.http;
    if (http.status !== "observed" && http.status !== "partial" || http.value === null) return;
    const transactions = http.value.transactions;
    for (let index = 0; index < transactions.length - 1; index += 1) {
      const current = transactions[index];
      const next = transactions[index + 1];
      if (current && next && current.redirect_to !== next.request_url) {
        issues.push(issue("semantic.redirect_discontinuity", `/pages/${pageIndex}/observations/http/value/transactions/${index}/redirect_to`, "Redirect target must equal the next request URL."));
      }
    }
    const final = transactions.at(-1);
    if (final && (http.value.final_transaction_id !== final.id || final.response_url !== page.url_identity.final_url)) {
      issues.push(issue("semantic.final_url_mismatch", `/pages/${pageIndex}/url_identity/final_url`, "The final transaction and final URL must agree."));
    }
  });

  return issues;
};
