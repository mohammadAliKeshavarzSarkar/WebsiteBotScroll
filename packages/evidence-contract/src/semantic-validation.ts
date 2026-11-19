import type { EvidenceDocument, ValidationIssue } from "./types.js";

type Observation = {
  id: string;
  status: string;
  value: unknown;
  reasons: string[];
  field_overrides?: Array<{ path: string }>;
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
type Link = { id: string; target_url: string; target_page_id: string | null };

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
    metadata: Observation & { value: null | { canonical_urls: string[] } };
    rendering: Observation & { value: null | { rendered_url: string } };
  };
};

type Diagnostic = {
  id: string;
  subject_page_id: string;
  outcome: string;
  observation_ids: string[];
  evidence_scope: "subject_page" | "cross_page";
  related_page_ids: string[];
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

const classifyUrl = (raw: string): "unsafe" | "parse_error" | undefined => {
  try {
    const url = new URL(raw, "https://evidence.invalid/");
    if (url.username !== "" || url.password !== "") return "unsafe";
    return [...url.searchParams.keys()].some((name) => sensitiveQueryName.test(name)) ? "unsafe" : undefined;
  } catch {
    return "parse_error";
  }
};

const addUrlIssue = (issues: ValidationIssue[], path: string, raw: string, unsafeCode = "semantic.unsafe_url"): void => {
  const classification = classifyUrl(raw);
  if (classification === "parse_error") {
    issues.push(issue("semantic.url_parse_error", path, "URL parsing failed."));
  } else if (classification === "unsafe") {
    issues.push(issue(unsafeCode, path, "Evidence URLs must not contain credentials or recognizable signing secrets."));
  }
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

const decodePointerSegment = (segment: string): string => segment.replaceAll("~1", "/").replaceAll("~0", "~");

const pointerResolves = (root: unknown, pointer: string): boolean => {
  let current = root;
  for (const encoded of pointer.slice(1).split("/")) {
    const segment = decodePointerSegment(encoded);
    if (Array.isArray(current)) {
      if (!/^(?:0|[1-9]\d*)$/.test(segment)) return false;
      const index = Number(segment);
      if (index >= current.length) return false;
      current = current[index];
    } else if (current !== null && typeof current === "object" && Object.hasOwn(current, segment)) {
      current = (current as Record<string, unknown>)[segment];
    } else {
      return false;
    }
  }
  return true;
};

const pointersOverlap = (left: string, right: string): boolean =>
  left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);

export const validateEvidenceSemantics = (document: EvidenceDocument): ValidationIssue[] => {
  const value = document as unknown as ContractDocument;
  const issues: ValidationIssue[] = [];
  const terminal = new Set(["completed", "partial", "failed", "cancelled"]);

  issues.push(...duplicateIssues(value.pages.map((page, index) => ({ id: page.id, path: `/pages/${index}/id` })), "semantic.duplicate_page_id", "page"));

  const observations: Array<{ observation: Observation; path: string }> = [];
  const observationOwnerById = new Map<string, string>();
  value.pages.forEach((page, pageIndex) => {
    Object.entries(page.observations).forEach(([name, observation]) => {
      observations.push({ observation, path: `/pages/${pageIndex}/observations/${name}` });
      observationOwnerById.set(observation.id, page.id);
    });
  });
  observations.push({ observation: value.diagnostics, path: "/diagnostics" });
  issues.push(...duplicateIssues(observations.map(({ observation, path }) => ({ id: observation.id, path: `${path}/id` })), "semantic.duplicate_observation_id", "observation"));

  const diagnostics = value.diagnostics.value ?? [];
  issues.push(...duplicateIssues(diagnostics.map((diagnostic, index) => ({ id: diagnostic.id, path: `/diagnostics/value/${index}/id` })), "semantic.duplicate_diagnostic_id", "diagnostic"));
  issues.push(...duplicateIssues(value.errors.map((error, index) => ({ id: error.id, path: `/errors/${index}/id` })), "semantic.duplicate_error_id", "error"));

  const transactions = value.pages.flatMap((page, pageIndex) =>
    (page.observations.http.value?.transactions ?? []).map((transaction, transactionIndex) => ({ id: transaction.id, path: `/pages/${pageIndex}/observations/http/value/transactions/${transactionIndex}/id` })),
  );
  issues.push(...duplicateIssues(transactions, "semantic.duplicate_transaction_id", "transaction"));
  const links = value.pages.flatMap((page, pageIndex) =>
    (page.observations.links.value ?? []).map((link, linkIndex) => ({ id: link.id, path: `/pages/${pageIndex}/observations/links/value/${linkIndex}/id` })),
  );
  issues.push(...duplicateIssues(links, "semantic.duplicate_link_id", "link"));

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
    const overrides = observation.field_overrides ?? [];
    overrides.forEach((override, overrideIndex) => {
      if (!pointerResolves(observation.value, override.path)) {
        issues.push(issue("semantic.field_override_target_missing", `${path}/field_overrides/${overrideIndex}/path`, "Field override path must resolve within the observation value."));
      }
      const earlier = overrides.slice(0, overrideIndex);
      if (earlier.some((candidate) => candidate.path === override.path)) {
        issues.push(issue("semantic.duplicate_field_override", `${path}/field_overrides/${overrideIndex}/path`, "Field override paths must be unique."));
      } else if (earlier.some((candidate) => pointersOverlap(candidate.path, override.path))) {
        issues.push(issue("semantic.overlapping_field_override", `${path}/field_overrides/${overrideIndex}/path`, "Parent and child field overrides conflict."));
      }
    });
  }

  const pageIds = new Set(value.pages.map(({ id }) => id));
  const observationById = new Map(observations.map(({ observation }) => [observation.id, observation]));
  diagnostics.forEach((diagnostic, diagnosticIndex) => {
    if (!pageIds.has(diagnostic.subject_page_id)) {
      issues.push(issue("semantic.dangling_page_reference", `/diagnostics/value/${diagnosticIndex}/subject_page_id`, "Diagnostic subject_page_id does not resolve."));
    }
    const evidenceScope = diagnostic.evidence_scope ?? "subject_page";
    const relatedPageIds = diagnostic.related_page_ids ?? [];
    const allowedPages = new Set([diagnostic.subject_page_id, ...(evidenceScope === "cross_page" ? relatedPageIds : [])]);
    relatedPageIds.forEach((relatedPageId, relatedIndex) => {
      if (!pageIds.has(relatedPageId)) {
        issues.push(issue("semantic.dangling_page_reference", `/diagnostics/value/${diagnosticIndex}/related_page_ids/${relatedIndex}`, "Diagnostic related_page_id does not resolve."));
      }
    });
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
      const owner = observationOwnerById.get(observationId);
      if (owner === undefined || !allowedPages.has(owner)) {
        issues.push(issue("semantic.diagnostic_evidence_scope_mismatch", `/diagnostics/value/${diagnosticIndex}/observation_ids/${referenceIndex}`, "Diagnostic evidence must belong to the subject page or an explicitly related cross-page subject."));
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
    const identityUrlCandidates = [
      ["discovered_url", page.url_identity.discovered_url],
      ["requested_url", page.url_identity.requested_url],
      ["normalized_url", page.url_identity.normalized_url],
      ["final_url", page.url_identity.final_url],
    ] as const;
    identityUrlCandidates.forEach(([field, url]) => addUrlIssue(issues, `/pages/${pageIndex}/url_identity/${field}`, url));
    page.url_identity.canonical_urls.forEach((url, urlIndex) =>
      addUrlIssue(issues, `/pages/${pageIndex}/url_identity/canonical_urls/${urlIndex}`, url),
    );
    (page.observations.metadata.value?.canonical_urls ?? []).forEach((url, urlIndex) =>
      addUrlIssue(issues, `/pages/${pageIndex}/observations/metadata/value/canonical_urls/${urlIndex}`, url),
    );

    const links = page.observations.links.value ?? [];
    links.forEach((link, linkIndex) => {
      if (link.target_page_id !== null && !pageIds.has(link.target_page_id)) {
        issues.push(issue("semantic.dangling_page_reference", `/pages/${pageIndex}/observations/links/value/${linkIndex}/target_page_id`, "Link target_page_id does not resolve."));
      }
      addUrlIssue(issues, `/pages/${pageIndex}/observations/links/value/${linkIndex}/target_url`, link.target_url);
    });

    const rendering = page.observations.rendering.value;
    if (rendering !== null) addUrlIssue(issues, `/pages/${pageIndex}/observations/rendering/value/rendered_url`, rendering.rendered_url);

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
        addUrlIssue(issues, `/pages/${pageIndex}/observations/http/value/transactions/${transactionIndex}`, url);
      });
      transaction.headers.forEach((header, headerIndex) => {
        header.values.flatMap((headerValue) => headerUrls(header.name, headerValue)).forEach((url) => {
          addUrlIssue(issues, `/pages/${pageIndex}/observations/http/value/transactions/${transactionIndex}/headers/${headerIndex}`, url, "semantic.sensitive_header_url");
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
    addUrlIssue(issues, `/run/scope/seed_urls/${index}`, url);
  });

  return issues;
};
