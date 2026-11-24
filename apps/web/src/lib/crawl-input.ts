const MAX_RESPONSE_BYTES: 5242880 = 5_242_880;

type CrawlControls = {
  maxPages: number;
  maxDepth: number;
  maxDurationMs: number;
  maxResponseBytes: 5242880;
};

function asRecord(value: unknown): Record<string, unknown> {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Crawl controls must be submitted as form fields");
  }
  return value as Record<string, unknown>;
}

function parseBoundedInteger(
  value: unknown,
  defaultValue: number,
  minimum: number,
  maximum: number,
  message: string,
): number {
  if (value === undefined || value === "") return defaultValue;
  if (typeof value !== "string" || !/^(0|[1-9]\d*)$/.test(value)) throw new TypeError(message);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) throw new TypeError(message);
  return parsed;
}

export function parseAuthorizationInput(value: unknown): { declarationAccepted: true } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Confirm that you are authorized to crawl this website");
  }
  const record = value as Record<string, unknown>;
  if (record.declaration !== "on") {
    throw new TypeError("Confirm that you are authorized to crawl this website");
  }
  return { declarationAccepted: true };
}

export function parseStartCrawlInput(value: unknown): CrawlControls {
  const record = asRecord(value);
  const maxPages = parseBoundedInteger(
    record.maxPages,
    25,
    1,
    100,
    "Maximum pages must be a whole number from 1 to 100",
  );
  const maxDepth = parseBoundedInteger(
    record.maxDepth,
    1,
    0,
    3,
    "Maximum depth must be a whole number from 0 to 3",
  );
  const maxDurationSeconds = parseBoundedInteger(
    record.maxDurationSeconds,
    60,
    10,
    300,
    "Maximum duration must be a whole number from 10 to 300 seconds",
  );

  return {
    maxPages,
    maxDepth,
    maxDurationMs: maxDurationSeconds * 1000,
    maxResponseBytes: MAX_RESPONSE_BYTES,
  };
}
