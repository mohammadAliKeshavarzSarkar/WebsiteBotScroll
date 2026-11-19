import type { UrlPolicy } from "./policy.js";

export type NormalizedUrl = string & { readonly __normalizedUrl: unique symbol };

export interface NormalizedUrlIdentity {
  discoveredUrl: string;
  requestedUrl: string;
  normalizedUrl: NormalizedUrl;
  finalUrl: string;
  canonicalUrls: string[];
  normalizationPolicyVersion: string;
}

function isTrackingParameter(name: string): boolean {
  const normalized = name.toLowerCase();
  return normalized === "gclid" || normalized.startsWith("utm_");
}

export function normalizeUrl(input: string, policy: UrlPolicy): NormalizedUrl {
  const url = new URL(input);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new TypeError(`Unsupported URL scheme: ${url.protocol}`);
  }
  if (url.username || url.password) {
    throw new TypeError("Credentials are not allowed in crawl URLs");
  }

  url.hash = "";
  if (policy.removeTrackingParameters) {
    for (const name of [...url.searchParams.keys()]) {
      if (isTrackingParameter(name)) url.searchParams.delete(name);
    }
  }
  url.searchParams.sort();

  return url.href as NormalizedUrl;
}

export function normalizeUrlIdentity(input: string, policy: UrlPolicy, normalizationPolicyVersion: string): NormalizedUrlIdentity {
  const normalizedUrl = normalizeUrl(input, policy);
  return {
    discoveredUrl: input,
    requestedUrl: input,
    normalizedUrl,
    finalUrl: normalizedUrl,
    canonicalUrls: [],
    normalizationPolicyVersion,
  };
}
