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
  started_at: string;
  finished_at: string;
  headers: Array<{ name: string; values: string[] }>;
};

type Limitation = { page_id?: string };
type Link = { target_url: string; target_page_id: string | null };

type Page = {
  id: string;
  url_identity: {
    discovered_url: string;
    requested_url: string;
    normalized_url: string;
    final_url: string;
    canonical_urls: string[];
  };
  observations: Record<string, Observation> & {
    http: Observation & { value: null | { transactions: Transaction[]; final_transaction_id: string } };
    links: Observation & { value: Link[] | null };
    rendering: Observation & { value: null | { rendered_url: string } };
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
    started_at: string;
    finished_at: string | null;
    stop_reason: string | null;
    limitations: Limitation[];
    scope: { seed_urls: string[] };
    coverage: { discovered: number; attempted: number; collected: number; failed: number; unattempted?: number };
  };
  pages: Page[];
  diagnostics: Observation & { value: Array<Diagnostic & { limitations: Limitation[] }> | null };
  errors: Array<{ id: string; page_id?: string; observation_id?: string }>;
};

const issue = (code: string, path: string, message: string): ValidationIssue => ({ code, path, message });
const sensitiveQueryName = /^(?:x-amz-(?:signature|credential|security-token)|signature|sig|token|access_token|api_?key|auth)$/i;

const isUnsafeUrl = (raw: string): boolean => {
  const url = new URL(raw, "https://evidence.invalid/");
  if (url.username !== "" || url.password !== "") return true;
  return [...url.searchParams.keys()].some((name) => sensitiveQueryName.test(name));
};

const headerUrls = (name: string, raw: string): string[] => {
  if (name === "location") return [raw];
  if (name !== "link") return [];
  return [...raw.matchAll(/<([^>]+)>/g)].flatMap((match) => match[1] ? [match[1]] : []);
};

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
  if (value.run.lifecycle === "partial" && value.run.stop_reason === null) {
    issues.push(issue("semantic.partial_stop_reason_required", "/run/stop_reason", "Partial runs require a stop reason."));
  }
  if (value.run.lifecycle === "partial" && value.run.limitations.length === 0) {
    issues.push(issue("semantic.partial_limitation_required", "/run/limitations", "Partial runs require at least one limitation."));
  }
  if (value.run.finished_at !== null && Date.parse(value.run.finished_at) < Date.parse(value.run.started_at)) {
    issues.push(issue("semantic.run_time_order_invalid", "/run/finished_at", "finished_at cannot be earlier than started_at."));
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
      } else if (diagnostic.outcome === "pass" && referenced.status !== "observed") {
        issues.push(issue("semantic.pass_requires_available_evidence", `/diagnostics/value/${diagnosticIndex}/outcome`, "A passing diagnostic requires available evidence."));
        issues.push(issue("semantic.pass_requires_observed_page_evidence", `/diagnostics/value/${diagnosticIndex}/outcome`, "A passing diagnostic requires an observed page observation."));
      } else if (diagnostic.outcome === "pass" && observationId === value.diagnostics.id) {
        issues.push(issue("semantic.pass_requires_observed_page_evidence", `/diagnostics/value/${diagnosticIndex}/outcome`, "A diagnostic cannot use its own stage envelope as passing evidence."));
      }
    });
    diagnostic.limitations.forEach((limitation, limitationIndex) => {
      if (limitation.page_id !== undefined && !pageIds.has(limitation.page_id)) {
        issues.push(issue("semantic.dangling_page_reference", `/diagnostics/value/${diagnosticIndex}/limitations/${limitationIndex}/page_id`, "Diagnostic limitation page_id does not resolve."));
      }
    });
  });

  value.run.limitations.forEach((limitation, limitationIndex) => {
    if (limitation.page_id !== undefined && !pageIds.has(limitation.page_id)) {
      issues.push(issue("semantic.dangling_page_reference", `/run/limitations/${limitationIndex}/page_id`, "Run limitation page_id does not resolve."));
    }
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
    const urlCandidates = [
      page.url_identity.discovered_url,
      page.url_identity.requested_url,
      page.url_identity.normalized_url,
      page.url_identity.final_url,
      ...page.url_identity.canonical_urls,
    ];
    urlCandidates.forEach((url, urlIndex) => {
      if (isUnsafeUrl(url)) issues.push(issue("semantic.unsafe_url", `/pages/${pageIndex}/url_identity/${urlIndex}`, "Evidence URLs must not contain credentials or recognizable signing secrets."));
    });

    const links = page.observations.links.value ?? [];
    links.forEach((link, linkIndex) => {
      if (link.target_page_id !== null && !pageIds.has(link.target_page_id)) {
        issues.push(issue("semantic.dangling_page_reference", `/pages/${pageIndex}/observations/links/value/${linkIndex}/target_page_id`, "Link target_page_id does not resolve."));
      }
      if (isUnsafeUrl(link.target_url)) {
        issues.push(issue("semantic.unsafe_url", `/pages/${pageIndex}/observations/links/value/${linkIndex}/target_url`, "Evidence URLs must not contain credentials or recognizable signing secrets."));
      }
    });

    const rendering = page.observations.rendering.value;
    if (rendering !== null && isUnsafeUrl(rendering.rendered_url)) {
      issues.push(issue("semantic.unsafe_url", `/pages/${pageIndex}/observations/rendering/value/rendered_url`, "Evidence URLs must not contain credentials or recognizable signing secrets."));
    }

    const http = page.observations.http;
    if (http.status !== "observed" && http.status !== "partial" || http.value === null) return;
    const transactions = http.value.transactions;
    const first = transactions[0];
    if (first && first.request_url !== page.url_identity.requested_url) {
      issues.push(issue("semantic.initial_request_url_mismatch", `/pages/${pageIndex}/observations/http/value/transactions/0/request_url`, "The first transaction must start at url_identity.requested_url."));
    }
    transactions.forEach((transaction, transactionIndex) => {
      if (Date.parse(transaction.finished_at) < Date.parse(transaction.started_at)) {
        issues.push(issue("semantic.transaction_time_order_invalid", `/pages/${pageIndex}/observations/http/value/transactions/${transactionIndex}/finished_at`, "Transaction finished_at cannot be earlier than started_at."));
      }
      [transaction.request_url, transaction.response_url, ...(transaction.redirect_to === null ? [] : [transaction.redirect_to])].forEach((url) => {
        if (isUnsafeUrl(url)) issues.push(issue("semantic.unsafe_url", `/pages/${pageIndex}/observations/http/value/transactions/${transactionIndex}`, "Evidence URLs must not contain credentials or recognizable signing secrets."));
      });
      transaction.headers.forEach((header, headerIndex) => {
        header.values.flatMap((headerValue) => headerUrls(header.name, headerValue)).forEach((url) => {
          if (isUnsafeUrl(url)) issues.push(issue("semantic.sensitive_header_url", `/pages/${pageIndex}/observations/http/value/transactions/${transactionIndex}/headers/${headerIndex}`, "URL-bearing headers must redact credentials and recognizable signing secrets."));
        });
      });
    });
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

  value.run.scope.seed_urls.forEach((url, index) => {
    if (isUnsafeUrl(url)) issues.push(issue("semantic.unsafe_url", `/run/scope/seed_urls/${index}`, "Evidence URLs must not contain credentials or recognizable signing secrets."));
  });

  return issues;
};
