import { lookup as nodeLookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import type { IncomingMessage, RequestOptions } from "node:http";
import type { DnsResolver } from "@website-bot-scroll/crawler/network/resolve-public";
import type { HttpTransport, TransportRequest, TransportResponse } from "@website-bot-scroll/crawler/http/fetch-page";

type Lookup = (hostname: string, options: { all: true; verbatim: true }) => Promise<Array<{ address: string; family: number }>>;
type NodeRequest = (options: RequestOptions, callback: (response: IncomingMessage) => void) => { end(): void; destroy(error?: Error): void; once(event: "error", listener: (error: Error) => void): unknown };

export function createDnsResolver(lookup: Lookup = nodeLookup as Lookup): DnsResolver {
  return { resolve: async (hostname) => (await lookup(hostname, { all: true, verbatim: true })).map(({ address }) => address) };
}

function responseHeaders(response: IncomingMessage): Record<string, string | string[] | undefined> {
  const headers: Record<string, string | string[]> = {};
  for (let index = 0; index < response.rawHeaders.length; index += 2) {
    const name = response.rawHeaders[index]!.toLowerCase();
    const value = response.rawHeaders[index + 1] ?? "";
    const current = headers[name];
    headers[name] = current === undefined ? value : Array.isArray(current) ? [...current, value] : [current, value];
  }
  return headers;
}

function hostHeader(url: URL): string {
  const defaultPort = (url.protocol === "https:" && (url.port === "" || url.port === "443")) || (url.protocol === "http:" && (url.port === "" || url.port === "80"));
  return defaultPort ? url.hostname : url.host;
}

export function createNodeHttpTransport(contactUrl: string, dependencies: { httpRequest?: NodeRequest; httpsRequest?: NodeRequest } = {}): HttpTransport {
  const requestHttp = dependencies.httpRequest ?? (httpRequest as unknown as NodeRequest);
  const requestHttps = dependencies.httpsRequest ?? (httpsRequest as unknown as NodeRequest);
  return {
    request(input: TransportRequest): Promise<TransportResponse> {
      return new Promise((resolve, reject) => {
        const secure = input.url.protocol === "https:";
        const headers = { ...input.headers, host: hostHeader(input.url), "user-agent": `WebsiteBotScroll/1.0 (+${contactUrl})` };
        const options: RequestOptions = {
          protocol: input.url.protocol, hostname: input.destination.address, family: input.destination.family,
          port: input.url.port ? Number(input.url.port) : secure ? 443 : 80,
          path: `${input.url.pathname}${input.url.search}`, method: input.method, headers,
          ...(secure ? { servername: input.url.hostname } : {}),
        };
        const request = (secure ? requestHttps : requestHttp)(options, (response) => resolve({
          status: response.statusCode ?? 0,
          headers: responseHeaders(response),
          body: response as unknown as AsyncIterable<Uint8Array>,
        }));
        request.once("error", reject);
        const abort = () => request.destroy(new Error("Request aborted"));
        if (input.signal.aborted) abort(); else input.signal.addEventListener("abort", abort, { once: true });
        request.end();
      });
    },
  };
}
