export function parseCreateSiteInput(value: unknown): { name: string; origin: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Website details are required");
  const record = value as Record<string, unknown>;
  const name = typeof record.name === "string" ? record.name.trim() : "";
  if (!name) throw new TypeError("Website name is required");
  if (name.length > 80) throw new TypeError("Website name must be 80 characters or fewer");

  if (typeof record.origin !== "string" || !record.origin.trim()) throw new TypeError("Enter an absolute HTTP(S) URL");
  let parsed: URL;
  try { parsed = new URL(record.origin.trim()); }
  catch { throw new TypeError("Enter an absolute HTTP(S) URL, including https://"); }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new TypeError("Website URL must use HTTP or HTTPS");
  if (parsed.username || parsed.password) throw new TypeError("Website URL must not contain credentials");
  if (!parsed.hostname) throw new TypeError("Website URL must include a hostname");
  return { name, origin: parsed.origin };
}
