import { assertAllowedDestination, type DnsResolver, type ResolvedDestination } from "../network/resolve-public.js";
import { createEvidenceId, type EvidenceHeaderInput, type EvidenceHeaderName, type HttpTransactionInput } from "@website-bot-scroll/domain/evidence";
import type { EvidenceContext, EvidenceSink } from "../evidence/events.js";

export interface TransportRequest { url: URL; method: "GET" | "HEAD"; destination: ResolvedDestination; headers: Record<string, string>; signal: AbortSignal }
export interface TransportResponse { status: number; headers: Record<string, string | string[] | undefined>; body: AsyncIterable<Uint8Array>; compressedBytes?: number }
export interface HttpTransport { request(request: TransportRequest): Promise<TransportResponse> }

interface CommonRequest { url: URL; resolver: DnsResolver; transport: HttpTransport; timeoutMs?: number; signal?: AbortSignal; sleep?: (milliseconds: number) => Promise<void>; evidenceSink?: EvidenceSink; evidenceContext?: EvidenceContext; now?: () => Date }
export interface FetchPageRequest extends CommonRequest { attempts?: number; maxRedirects?: number; retryDelaysMs?: number[]; maxCompressedBytes?: number; maxDecompressedBytes?: number; maxOtherBytes?: number; allowedHosts?: ReadonlySet<string> }
export type FetchPageResult =
  | { kind: "html"; url: string; status: number; body: Uint8Array; compressedBytes: number; decompressedBytes: number }
  | { kind: "non-html"; url: string; status: number; contentType?: string; bytes: number }
  | { kind: "rate-limited"; url: string; status: 429 };
export interface ProbeResourceRequest extends CommonRequest { maxGetBytes?: number }
export interface ResourceObservation { url: string; status: number; contentType?: string; contentLength?: number; method: "HEAD" | "GET" }

class RetryableRequestError extends Error {}
class RequestTimeoutError extends RetryableRequestError { constructor() { super("Request timed out"); } }

const allowedHeaderNames = new Set<EvidenceHeaderName>(["location", "content-type", "x-robots-tag", "link", "content-language", "content-length", "content-encoding", "retry-after", "cache-control", "vary", "etag", "last-modified", "age"]);
const valuesOf = (value: string | string[] | undefined): string[] => value === undefined ? [] : Array.isArray(value) ? [...value] : [value];
const firstOf = (value: string | string[] | undefined): string | undefined => valuesOf(value)[0];
const evidenceHeaders = (headers: TransportResponse["headers"]): EvidenceHeaderInput[] => Object.entries(headers).flatMap(([rawName, rawValues]) => {
  const name = rawName.toLowerCase() as EvidenceHeaderName;
  const values = valuesOf(rawValues);
  return allowedHeaderNames.has(name) && values.length > 0 ? [{ name, values }] : [];
});

async function requestWithTimeout(transport: HttpTransport, request: Omit<TransportRequest, "signal">, timeoutMs: number, parentSignal?: AbortSignal): Promise<TransportResponse> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (parentSignal?.aborted) controller.abort(); else parentSignal?.addEventListener("abort", abort, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      transport.request({ ...request, signal: controller.signal }),
      new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new RequestTimeoutError()); }, timeoutMs); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function collect(body: AsyncIterable<Uint8Array>, maximum: number, label: string, signal?: AbortSignal): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  const iterator = body[Symbol.asyncIterator]();
  while (true) {
    const next = signal ? await Promise.race([
      iterator.next(),
      new Promise<never>((_, reject) => {
        const abort = () => reject(new Error("Request aborted"));
        if (signal.aborted) abort(); else signal.addEventListener("abort", abort, { once: true });
      }),
    ]) : await iterator.next();
    if (next.done) break;
    const chunk = next.value;
    total += chunk.byteLength;
    if (total > maximum) throw new Error(`${label} body exceeds limit`);
    chunks.push(chunk);
  }
  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { combined.set(chunk, offset); offset += chunk.byteLength; }
  return combined;
}

async function discard(response: TransportResponse): Promise<void> {
  await collect(response.body, 64 * 1024, "discarded response");
}

export async function fetchPage(request: FetchPageRequest): Promise<FetchPageResult> {
  const attempts = request.attempts ?? 3;
  const delays = request.retryDelaysMs ?? [5_000, 30_000, 120_000];
  const sleep = request.sleep ?? ((milliseconds) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const timeoutMs = request.timeoutMs ?? 15_000;
  let lastError: unknown;
  const now = request.now ?? (() => new Date());
  const recordTransaction = async (attempt: number, redirect: number, current: URL, response: TransportResponse, startedAt: Date, decodedBytes: number, redirectTo: string | null): Promise<void> => {
    const context = request.evidenceContext;
    if (!request.evidenceSink || !context?.pageId) return;
    const transaction: HttpTransactionInput = {
      id: createEvidenceId("transaction", [context.runId, context.pageId, String(attempt), String(redirect)]),
      requestUrl: current.href,
      responseUrl: current.href,
      method: "GET",
      statusCode: response.status,
      startedAt: startedAt.toISOString(),
      finishedAt: now().toISOString(),
      headers: evidenceHeaders(response.headers),
      transferredBytes: response.compressedBytes ?? decodedBytes,
      decodedBytes,
      redirectTo,
    };
    await request.evidenceSink.record({ kind: "http_transaction", runId: context.runId, pageId: context.pageId, transaction });
  };
  const recordError = async (error: unknown): Promise<void> => {
    if (!request.evidenceSink || !request.evidenceContext) return;
    const message = error instanceof Error ? error.message : "Page request failed";
    await request.evidenceSink.record({
      kind: "collection_error", runId: request.evidenceContext.runId, ...(request.evidenceContext.pageId ? { pageId: request.evidenceContext.pageId } : {}),
      stage: /forbidden|public address/i.test(message) ? "network_boundary" : "http_fetch",
      code: /timed out/i.test(message) ? "timeout" : "network_error", message,
      retryable: error instanceof RetryableRequestError, occurredAt: now().toISOString(),
    });
  };
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    let current = request.url;
    try {
      for (let redirect = 0; redirect <= (request.maxRedirects ?? 5); redirect += 1) {
        request.signal?.throwIfAborted();
        if (request.allowedHosts && !request.allowedHosts.has(current.hostname.toLowerCase())) throw new Error(`Destination is outside the authorized host: ${current.hostname}`);
        const destination = await assertAllowedDestination(current, request.resolver);
        request.signal?.throwIfAborted();
        const startedAt = now();
        let response: TransportResponse;
        try {
          response = await requestWithTimeout(request.transport, { url: current, method: "GET", destination, headers: {}, }, timeoutMs, request.signal);
        } catch (error) {
          if (error instanceof RequestTimeoutError) throw error;
          throw new RetryableRequestError(error instanceof Error ? error.message : "Network request failed");
        }
        if (response.status === 429) { await discard(response); await recordTransaction(attempt, redirect, current, response, startedAt, 0, null); return { kind: "rate-limited", url: current.href, status: 429 }; }
        if (response.status >= 500) { await discard(response); await recordTransaction(attempt, redirect, current, response, startedAt, 0, null); throw new RetryableRequestError(`Server returned ${response.status}`); }
        if (response.status >= 300 && response.status < 400) {
          const location = firstOf(response.headers.location);
          if (!location) throw new Error("Redirect is missing Location");
          if (redirect === (request.maxRedirects ?? 5)) throw new Error("Redirect limit exceeded");
          const redirectUrl = new URL(location, current);
          await discard(response);
          await recordTransaction(attempt, redirect, current, response, startedAt, 0, redirectUrl.href);
          current = redirectUrl;
          continue;
        }
        const contentType = firstOf(response.headers["content-type"])?.split(";", 1)[0]?.trim().toLowerCase();
        const contentEncoding = firstOf(response.headers["content-encoding"])?.trim().toLowerCase();
        if (contentEncoding && contentEncoding !== "identity") { await discard(response); throw new Error(`Unsupported content encoding: ${contentEncoding}`); }
        const compressedBytes = response.compressedBytes ?? 0;
        const html = contentType === "text/html" || contentType === "application/xhtml+xml";
        const compressedLimit = html ? (request.maxCompressedBytes ?? 5 * 1024 * 1024) : (request.maxOtherBytes ?? 10 * 1024 * 1024);
        if (compressedBytes > compressedLimit) throw new Error("compressed body exceeds limit");
        const bytes = await collect(response.body, html ? (request.maxDecompressedBytes ?? 20 * 1024 * 1024) : (request.maxOtherBytes ?? 10 * 1024 * 1024), html ? "decompressed" : "response", request.signal);
        await recordTransaction(attempt, redirect, current, response, startedAt, bytes.byteLength, null);
        if (!html) return { kind: "non-html", url: current.href, status: response.status, ...(contentType ? { contentType } : {}), bytes: bytes.byteLength };
        return { kind: "html", url: current.href, status: response.status, body: bytes, compressedBytes: compressedBytes || bytes.byteLength, decompressedBytes: bytes.byteLength };
      }
    } catch (error) {
      lastError = error;
      await recordError(error);
      if (!(error instanceof RetryableRequestError)) throw error;
      if (attempt + 1 < attempts) await sleep(delays[attempt] ?? delays.at(-1) ?? 0);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Page request failed");
}

export async function probeResource(request: ProbeResourceRequest): Promise<ResourceObservation> {
  const timeout = request.timeoutMs ?? 15_000;
  const follow = async (start: URL, method: "HEAD" | "GET", headers: Record<string, string>) => {
    let url = start;
    for (let redirects = 0; redirects <= 5; redirects += 1) {
      const destination = await assertAllowedDestination(url, request.resolver);
      const response = await requestWithTimeout(request.transport, { url, method, destination, headers }, timeout);
      if (response.status < 300 || response.status >= 400) return { response, url };
      const location = firstOf(response.headers.location);
      if (!location || redirects === 5) throw new Error("Resource redirect limit exceeded");
      url = new URL(location, url);
    }
    throw new Error("Resource redirect limit exceeded");
  };
  let method: "HEAD" | "GET" = "HEAD";
  let result = await follow(request.url, method, {});
  let response = result.response;
  if (response.status === 405 || response.status === 501) {
    method = "GET";
    result = await follow(result.url, method, { range: `bytes=0-${(request.maxGetBytes ?? 1024) - 1}` });
    response = result.response;
    await collect(response.body, request.maxGetBytes ?? 1024, "resource probe");
  }
  const contentType = firstOf(response.headers["content-type"])?.split(";", 1)[0]?.trim().toLowerCase();
  const length = Number(firstOf(response.headers["content-length"]));
  return { url: result.url.href, status: response.status, method, ...(contentType ? { contentType } : {}), ...(Number.isFinite(length) ? { contentLength: length } : {}) };
}
