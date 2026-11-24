import { EventEmitter } from "node:events";
import { createServer } from "node:http";
import { Readable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDnsResolver, createNodeHttpTransport } from "./network.js";

const servers: Array<{ close(callback: (error?: Error) => void): void }> = [];
afterEach(async () => { await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())))); });

describe("production network adapters", () => {
  it("resolves all addresses verbatim", async () => {
    const lookup = vi.fn(async () => [{ address: "93.184.216.34", family: 4 }, { address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 }]);
    await expect(createDnsResolver(lookup).resolve("example.com")).resolves.toEqual(["93.184.216.34", "2606:2800:220:1:248:1893:25c8:1946"]);
    expect(lookup).toHaveBeenCalledWith("example.com", { all: true, verbatim: true });
  });

  it("connects HTTP to the validated address while preserving Host, repeated headers, and streaming", async () => {
    let receivedHost = ""; let receivedAgent = "";
    const server = createServer((request, response) => { receivedHost = request.headers.host ?? ""; receivedAgent = request.headers["user-agent"] ?? ""; response.setHeader("link", ["</fa>; rel=alternate", "</en>; rel=alternate"]); response.write("first"); response.end("second"); });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address(); if (!address || typeof address === "string") throw new Error("missing test port");
    const url = new URL(`http://origin.example:${address.port}/page`);
    const response = await createNodeHttpTransport("https://crawler.example/contact").request({ url, method: "GET", destination: { hostname: "origin.example", address: "127.0.0.1", family: 4 }, headers: {}, signal: new AbortController().signal });
    const chunks: string[] = []; for await (const chunk of response.body) chunks.push(new TextDecoder().decode(chunk));
    expect(receivedHost).toBe(`origin.example:${address.port}`);
    expect(receivedAgent).toContain("https://crawler.example/contact");
    expect(response.headers.link).toEqual(["</fa>; rel=alternate", "</en>; rel=alternate"]);
    expect(chunks.join("")).toBe("firstsecond");
  });

  it("preserves the original HTTPS hostname for SNI and Host", async () => {
    let options: Record<string, unknown> = {};
    const httpsRequest = vi.fn((input: Record<string, unknown>, callback: (response: Readable & { statusCode?: number; rawHeaders?: string[] }) => void) => {
      options = input; const request = new EventEmitter() as EventEmitter & { end(): void; destroy(error?: Error): void };
      request.end = () => queueMicrotask(() => { const response = Readable.from([]) as Readable & { statusCode?: number; rawHeaders?: string[] }; response.statusCode = 204; response.rawHeaders = []; callback(response); });
      request.destroy = (error) => request.emit("error", error);
      return request;
    });
    await createNodeHttpTransport("https://crawler.example/contact", { httpsRequest: httpsRequest as never }).request({ url: new URL("https://secure.example/path"), method: "GET", destination: { hostname: "secure.example", address: "93.184.216.34", family: 4 }, headers: {}, signal: new AbortController().signal });
    expect(options).toMatchObject({ hostname: "93.184.216.34", servername: "secure.example" });
    expect(options.headers).toMatchObject({ host: "secure.example" });
  });

  it("aborts an in-flight request", async () => {
    const server = createServer(() => undefined); servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address(); if (!address || typeof address === "string") throw new Error("missing test port");
    const controller = new AbortController();
    const pending = createNodeHttpTransport("https://crawler.example/contact").request({ url: new URL(`http://origin.example:${address.port}/hang`), method: "GET", destination: { hostname: "origin.example", address: "127.0.0.1", family: 4 }, headers: {}, signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toThrow();
  });
});
