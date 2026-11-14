import { describe, expect, it, vi } from "vitest";

import {
  assertAllowedDestination,
  type DnsResolver,
  UnsafeDestinationError,
} from "./resolve-public.js";

function resolverFor(...addresses: string[]): DnsResolver {
  return { resolve: vi.fn().mockResolvedValue(addresses) };
}

describe("assertAllowedDestination", () => {
  it("returns a public address pinned to the validated connection target", async () => {
    const result = await assertAllowedDestination(new URL("https://example.com/path"), resolverFor("93.184.216.34"));

    expect(result).toEqual({
      hostname: "example.com",
      address: "93.184.216.34",
      family: 4,
    });
  });

  it.each([
    "0.0.0.0",
    "10.0.0.1",
    "100.64.0.1",
    "127.0.0.1",
    "169.254.169.254",
    "172.16.0.1",
    "192.0.0.1",
    "192.168.0.1",
    "198.18.0.1",
    "224.0.0.1",
    "255.255.255.255",
    "::",
    "::1",
    "::ffff:127.0.0.1",
    "64:ff9b:1::1",
    "100::1",
    "2001:db8::1",
    "fc00::1",
    "fe80::1",
    "ff02::1",
  ])("rejects non-public address %s", async (address) => {
    await expect(assertAllowedDestination(new URL("https://example.com"), resolverFor(address))).rejects.toBeInstanceOf(
      UnsafeDestinationError,
    );
  });

  it("rejects every mixed answer instead of selecting its public member", async () => {
    await expect(
      assertAllowedDestination(new URL("https://example.com"), resolverFor("93.184.216.34", "127.0.0.1")),
    ).rejects.toBeInstanceOf(UnsafeDestinationError);
  });

  it("validates a redirect destination independently", async () => {
    const resolver = resolverFor("93.184.216.34");
    await expect(assertAllowedDestination(new URL("https://example.com"), resolver)).resolves.toBeDefined();

    await expect(
      assertAllowedDestination(new URL("https://redirected.example"), resolverFor("169.254.169.254")),
    ).rejects.toBeInstanceOf(UnsafeDestinationError);
  });

  it("does not trust a previous DNS answer when the resolver changes", async () => {
    const resolve = vi.fn().mockResolvedValueOnce(["93.184.216.34"]).mockResolvedValueOnce(["127.0.0.1"]);
    const resolver: DnsResolver = { resolve };

    await expect(assertAllowedDestination(new URL("https://example.com"), resolver)).resolves.toBeDefined();
    await expect(assertAllowedDestination(new URL("https://example.com"), resolver)).rejects.toBeInstanceOf(
      UnsafeDestinationError,
    );
    expect(resolve).toHaveBeenCalledTimes(2);
  });

  it("rejects empty, malformed, and literal private destinations", async () => {
    await expect(assertAllowedDestination(new URL("https://example.com"), resolverFor())).rejects.toBeInstanceOf(
      UnsafeDestinationError,
    );
    await expect(assertAllowedDestination(new URL("https://example.com"), resolverFor("not-an-ip"))).rejects.toBeInstanceOf(
      UnsafeDestinationError,
    );
    await expect(
      assertAllowedDestination(new URL("http://127.0.0.1"), resolverFor("93.184.216.34")),
    ).rejects.toBeInstanceOf(UnsafeDestinationError);
  });
});
