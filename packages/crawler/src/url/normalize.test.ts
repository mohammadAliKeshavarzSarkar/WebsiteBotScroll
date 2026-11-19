import { describe, expect, it } from "vitest";

import { normalizeUrl, normalizeUrlIdentity } from "./normalize.js";
import { isSameSite, type SitePolicy, type UrlPolicy } from "./policy.js";

const policy: UrlPolicy = {
  removeTrackingParameters: true,
};

describe("normalizeUrl", () => {
  it("preserves distinct URL identity components and policy version", () => {
    expect(normalizeUrlIdentity("https://example.com/a?utm_source=x#part", policy, "normalize/1")).toEqual({
      discoveredUrl: "https://example.com/a?utm_source=x#part",
      requestedUrl: "https://example.com/a?utm_source=x#part",
      normalizedUrl: "https://example.com/a",
      finalUrl: "https://example.com/a",
      canonicalUrls: [],
      normalizationPolicyVersion: "normalize/1",
    });
  });
  it("creates a deterministic identity for equivalent URLs", () => {
    const normalized = normalizeUrl(
      "HTTPS://BÜCHER.Example:443/a/../b/./?z=2&utm_source=x&a=3&a=1&gclid=y#part",
      policy,
    );

    expect(normalized).toBe("https://xn--bcher-kva.example/b/?a=3&a=1&z=2");
    expect(normalizeUrl(normalized, policy)).toBe(normalized);
  });

  it("keeps tracking parameters when configured", () => {
    expect(
      normalizeUrl("http://EXAMPLE.com:80/?utm_medium=email&b=2&a=1", {
        removeTrackingParameters: false,
      }),
    ).toBe("http://example.com/?a=1&b=2&utm_medium=email");
  });

  it.each(["ftp://example.com/file", "mailto:owner@example.com", "https://user:pass@example.com/"])(
    "rejects unsupported or credential-bearing input %s",
    (input) => expect(() => normalizeUrl(input, policy)).toThrow(),
  );
});

describe("isSameSite", () => {
  const sitePolicy: SitePolicy = {
    origin: new URL("https://example.com"),
    includeSubdomains: false,
  };

  it("matches the configured origin and respects ports and subdomain policy", () => {
    expect(isSameSite(new URL("https://example.com/page"), sitePolicy)).toBe(true);
    expect(isSameSite(new URL("http://example.com/page"), sitePolicy)).toBe(false);
    expect(isSameSite(new URL("https://www.example.com/page"), sitePolicy)).toBe(false);
    expect(isSameSite(new URL("https://www.example.com/page"), { ...sitePolicy, includeSubdomains: true })).toBe(true);
    expect(isSameSite(new URL("https://notexample.com/page"), { ...sitePolicy, includeSubdomains: true })).toBe(false);
  });
});
