import type { UrlPolicy } from "./policy.js";

export type NormalizedUrl = string & { readonly __normalizedUrl: unique symbol };

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
