export interface UrlPolicy {
  removeTrackingParameters: boolean;
}

export interface SitePolicy {
  origin: URL;
  includeSubdomains: boolean;
}

function effectivePort(url: URL): string {
  if (url.port) return url.port;
  return url.protocol === "https:" ? "443" : "80";
}

export function isSameSite(candidate: URL, policy: SitePolicy): boolean {
  const expected = policy.origin;
  if (candidate.protocol !== expected.protocol || effectivePort(candidate) !== effectivePort(expected)) {
    return false;
  }

  const candidateHost = candidate.hostname.toLowerCase();
  const expectedHost = expected.hostname.toLowerCase();
  return (
    candidateHost === expectedHost ||
    (policy.includeSubdomains && candidateHost.endsWith(`.${expectedHost}`))
  );
}
