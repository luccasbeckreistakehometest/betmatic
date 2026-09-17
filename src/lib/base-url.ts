/**
 * The public origin of the app. Read with a dynamic lookup on purpose: `process.env.NEXT_PUBLIC_*`
 * written literally is frozen into the bundle at build time, and the Docker build no longer sees the
 * server's .env. Reading it this way picks up the container's runtime value.
 */
const env = process.env;

export const FALLBACK_PUBLIC_URL = "https://betmatic.marqa.online";

function clean(value: string | undefined): string | null {
  const v = (value ?? "").trim().replace(/\/+$/, "");
  return /^https?:\/\//.test(v) ? v : null;
}

/** APP_URL, then NEXT_PUBLIC_BASE_URL; null when neither is a real URL. */
export function configuredBaseUrl(): string | null {
  return clean(env["APP_URL"]) ?? clean(env["NEXT_PUBLIC_BASE_URL"]);
}

/** For links that must be absolute (payments, messages). Throws instead of pointing at localhost. */
export function requireBaseUrl(): string {
  const base = configuredBaseUrl();
  if (!base) throw new Error("APP_URL / NEXT_PUBLIC_BASE_URL is not set — refusing to build absolute links to localhost.");
  return base;
}

/** For metadata, sitemap and share links: the configured origin, else the production domain. */
export function publicBaseUrl(): string {
  return configuredBaseUrl() ?? FALLBACK_PUBLIC_URL;
}

/** Same as configuredBaseUrl but "" when unset, for links that may stay relative. */
export function baseUrlOrEmpty(): string {
  return configuredBaseUrl() ?? "";
}

/** A same-origin path from untrusted input (?next=), or null. Blocks "//host" and "/\\host". */
export function safeNextPath(value: string | null | undefined): string | null {
  if (!value || typeof value !== "string") return null;
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return null;
  if (/[\r\n]/.test(value) || value.length > 300) return null;
  return value;
}
