export const failureFixtures = {
  rateLimited: { status: 429, headers: { "retry-after": "60" }, body: "" },
  serverError: { status: 503, headers: {}, body: "temporarily unavailable" },
  redirectToMetadata: { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data/" }, body: "" },
  nonHtml: { status: 200, headers: { "content-type": "application/pdf" }, body: "%PDF" },
} as const;
