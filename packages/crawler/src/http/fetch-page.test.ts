import { describe, expect, it, vi } from "vitest";

import type { DnsResolver } from "../network/resolve-public.js";
import { fetchPage, probeResource, type HttpTransport, type TransportResponse } from "./fetch-page.js";

const resolver: DnsResolver = { resolve: vi.fn().mockResolvedValue(["93.184.216.34"]) };
const body = (...chunks: string[]): AsyncIterable<Uint8Array> => ({ async *[Symbol.asyncIterator]() { for (const chunk of chunks) yield new TextEncoder().encode(chunk); } });
const response = (status: number, options: Partial<TransportResponse> = {}): TransportResponse => ({ status, headers: { "content-type": "text/html" }, body: body("<html></html>"), compressedBytes: 13, ...options });

describe("fetchPage", () => {
  it("revalidates every redirect and returns inert HTML bytes", async () => {
    const transport: HttpTransport = { request: vi.fn().mockResolvedValueOnce(response(302, { headers: { location: "https://www.example.com/a" } })).mockResolvedValueOnce(response(200)) };
    const result = await fetchPage({ url: new URL("https://example.com"), resolver, transport, sleep: async () => undefined });
    expect(result.kind).toBe("html");
    expect(transport.request).toHaveBeenCalledTimes(2);
    expect(resolver.resolve).toHaveBeenCalledWith("example.com");
    expect(resolver.resolve).toHaveBeenCalledWith("www.example.com");
  });

  it("rejects a redirect that resolves to a private address before sending it", async () => {
    const changingResolver: DnsResolver = { resolve: vi.fn().mockResolvedValueOnce(["93.184.216.34"]).mockResolvedValueOnce(["127.0.0.1"]) };
    const transport: HttpTransport = { request: vi.fn().mockResolvedValue(response(302, { headers: { location: "http://internal.example/" } })) };
    await expect(fetchPage({ url: new URL("https://example.com"), resolver: changingResolver, transport })).rejects.toThrow("forbidden");
    expect(transport.request).toHaveBeenCalledTimes(1);
  });

  it("retries network and 5xx failures with the configured exponential delays", async () => {
    const sleeps: number[] = [];
    const transport: HttpTransport = { request: vi.fn().mockRejectedValueOnce(new Error("reset")).mockResolvedValueOnce(response(503)).mockResolvedValueOnce(response(200)) };
    const result = await fetchPage({ url: new URL("https://example.com"), resolver, transport, retryDelaysMs: [5, 30, 120], sleep: async (ms) => { sleeps.push(ms); } });
    expect(result.kind).toBe("html");
    expect(sleeps).toEqual([5, 30]);
  });

  it("stops on 429 and reports timeout, non-HTML, and decompression overflow", async () => {
    const rateLimited: HttpTransport = { request: vi.fn().mockResolvedValue(response(429)) };
    expect((await fetchPage({ url: new URL("https://example.com"), resolver, transport: rateLimited })).kind).toBe("rate-limited");
    const nonHtml: HttpTransport = { request: vi.fn().mockResolvedValue(response(200, { headers: { "content-type": "application/pdf" } })) };
    expect((await fetchPage({ url: new URL("https://example.com/x.pdf"), resolver, transport: nonHtml })).kind).toBe("non-html");
    const huge: HttpTransport = { request: vi.fn().mockResolvedValue(response(200, { body: body("12345", "67890") })) };
    await expect(fetchPage({ url: new URL("https://example.com"), resolver, transport: huge, maxDecompressedBytes: 9 })).rejects.toThrow("decompressed");
    const hanging: HttpTransport = { request: vi.fn(() => new Promise<TransportResponse>(() => undefined)) };
    await expect(fetchPage({ url: new URL("https://example.com"), resolver, transport: hanging, timeoutMs: 5, attempts: 1 })).rejects.toThrow("timed out");
  });
});

describe("probeResource", () => {
  it("falls back from HEAD to a bounded GET", async () => {
    const transport: HttpTransport = { request: vi.fn().mockResolvedValueOnce(response(405)).mockResolvedValueOnce(response(200, { headers: { "content-type": "image/png", "content-length": "123" }, body: body("x") })) };
    const result = await probeResource({ url: new URL("https://example.com/image.png"), resolver, transport });
    expect(result).toMatchObject({ status: 200, contentType: "image/png", contentLength: 123, method: "GET" });
    expect(transport.request).toHaveBeenNthCalledWith(1, expect.objectContaining({ method: "HEAD" }));
    expect(transport.request).toHaveBeenNthCalledWith(2, expect.objectContaining({ method: "GET" }));
  });

  it("revalidates resource redirects", async () => {
    const changingResolver: DnsResolver = { resolve: vi.fn().mockResolvedValueOnce(["93.184.216.34"]).mockResolvedValueOnce(["127.0.0.1"]) };
    const transport: HttpTransport = { request: vi.fn().mockResolvedValue(response(302, { headers: { location: "http://internal.example/image" } })) };
    await expect(probeResource({ url: new URL("https://example.com/image"), resolver: changingResolver, transport })).rejects.toThrow("forbidden");
    expect(transport.request).toHaveBeenCalledTimes(1);
  });
});
