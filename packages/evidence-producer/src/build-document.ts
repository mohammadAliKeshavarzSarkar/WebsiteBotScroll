/* eslint-disable @typescript-eslint/no-explicit-any */
import type { EvidenceDocument } from "@website-bot-scroll/evidence-contract/types";

const SUPPORTED = new Set(["page.http@1.0.0", "page.metadata@1.0.0", "page.headings@1.0.0", "page.structured_data@1.0.0", "page.content@1.0.0", "page.links@1.0.0", "page.rendering@1.0.0"]);
type Snapshot = { id: string; payload: Record<string, any> };

const provenance = (record: any, method: string) => record.provenance && Object.keys(record.provenance).length ? {
  method: record.provenance.method ?? record.provenance.collector ?? method,
  collected_at: record.provenance.collected_at ?? record.provenance.collectedAt ?? record.collectedAt,
  source: record.provenance.source ?? (method === "http" ? "http" : "source_html"),
  version: record.provenance.version ?? "1.0.0",
} : undefined;
const mapObservation = (record: any, method: string, transactions: any[]) => ({
  id: record.id, status: record.status, value: method === "http" && record.payload ? { ...record.payload, transactions, final_transaction_id: record.payload.final_transaction_id } : record.payload,
  reasons: record.reasons ?? [], ...(provenance(record, method) ? { provenance: provenance(record, method) } : {}),
});
const mapTransaction = (transaction: any) => ({ id: transaction.id, request_url: transaction.requestUrl, response_url: transaction.responseUrl, method: transaction.method, status_code: transaction.statusCode, started_at: transaction.startedAt, finished_at: transaction.finishedAt, headers: transaction.headers.map((header: any) => ({ name: header.name, values: header.values.map((value: any) => value.value) })), transferred_bytes: Number(transaction.transferredBytes), decoded_bytes: Number(transaction.decodedBytes), redirect_to: transaction.redirectTo });

export function buildEvidenceDocument(snapshot: Snapshot, identity: { producerVersion: string }): EvidenceDocument {
  const payload = snapshot.payload; const run = payload.run;
  for (const observation of payload.observations ?? []) if (!SUPPORTED.has(`${observation.definition.key}@${observation.definition.version}`)) throw new Error("unsupported observation definition version");
  const subjects = new Map((payload.subjects ?? []).map((subject: any) => [subject.id, subject]));
  const recordsByPage = new Map<string, any[]>();
  for (const record of payload.observations ?? []) {
    const pageId = (subjects.get(record.subjectId) as any)?.identity?.pageId;
    if (pageId) recordsByPage.set(pageId, [...(recordsByPage.get(pageId) ?? []), record]);
  }
  const pages = (payload.evidencePages ?? []).map((page: any) => {
    const records = recordsByPage.get(page.id) ?? []; const observations: Record<string, unknown> = {};
    const transactions = (page.transactions ?? []).map(mapTransaction);
    for (const record of records) { const method = record.definition.key.replace(/^page\./, ""); observations[method] = mapObservation(record, method, transactions); }
    return { id: page.id, depth: page.depth, url_identity: { discovered_url: page.discoveredUrl, requested_url: page.requestedUrl, normalized_url: page.normalizedUrl, final_url: page.finalUrl, canonical_urls: page.canonicalUrls }, observations };
  });
  const limitations = (payload.evidenceLimitations ?? []).map((item: any) => ({ code: item.code, message: item.message }));
  const diagnosticExecutions = new Map((payload.diagnosticExecutions ?? []).map((execution: any) => [execution.id, execution]));
  const diagnosticValue = (payload.diagnosticResults ?? []).map((result: any) => {
    const execution = diagnosticExecutions.get(result.executionId) as any; const subject = subjects.get(result.subjectId) as any;
    const memberPageIds = (subject?.members ?? []).map((member: any) => (subjects.get(member.memberSubjectId) as any)?.identity?.pageId).filter(Boolean);
    const directPageId = subject?.identity?.pageId; const subjectPageId = directPageId ?? memberPageIds[0];
    return { id: result.id, rule_id: execution.rule.key, rule_version: execution.rule.version, policy_version: execution.rule.policyVersion, evidence_scope: subject.kind === "cross_page" ? "cross_page" : "subject_page", related_page_ids: subject.kind === "cross_page" ? memberPageIds.slice(1) : [], subject_page_id: subjectPageId, outcome: result.outcome, observation_ids: result.inputs.map((input: any) => input.observationId), limitations: result.limitations };
  });
  const diagnostics = diagnosticValue.length === 0 ? { id: `diagnostics-${run.id}`, status: "not_collected", value: null, reasons: ["incomplete_evidence"] } : { id: `diagnostics-${run.id}`, status: "observed", reasons: [], provenance: { method: "diagnostic_engine", collected_at: run.finishedAt, source: "derived", version: "1.0.0" }, value: diagnosticValue };
  return {
    contract: { name: "seo-crawl-evidence", version: "0.1.0" }, producer: { name: "WebsiteBotScroll", version: identity.producerVersion, schema_version: "0.1.0", ...(run.normalizationPolicyVersion ? { normalization_policy_version: run.normalizationPolicyVersion } : {}), ...(run.extractorVersion ? { extractor_version: run.extractorVersion } : {}), ...(diagnosticValue.length ? { diagnostic_rule_version: "1.0.0" } : {}) },
    run: { id: run.id, trigger: run.trigger, lifecycle: run.status, started_at: run.startedAt, finished_at: run.finishedAt, scope: run.scope, limits: run.limits, coverage: run.coverage, stop_reason: run.stopReason, limitations },
    pages, diagnostics,
    errors: (payload.evidenceErrors ?? []).map((error: any) => ({ id: error.id, stage: error.stage, code: error.code, message: error.message, occurred_at: error.occurredAt, retryable: error.retryable, ...(error.pageId ? { page_id: error.pageId } : {}), ...(error.observationId ? { observation_id: error.observationId } : {}) })),
  };
}
