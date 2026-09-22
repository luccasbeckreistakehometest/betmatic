import { readCache, writeCache } from "@/lib/cache";
import { BookWallError, RobotsDisallowedError } from "@/lib/sources/br-books/types";

/**
 * The one way a book adapter talks to the network. Politeness is enforced here, not trusted to each
 * adapter: at least one second between calls to the same host, a 10 s timeout, at most one retry
 * (and only on a network error or a 5xx), a 60 s cache by URL (ETag-aware, so a repeat inside the
 * window costs nothing and a repeat after it can be a 304), robots.txt honoured per host, and an
 * honest User-Agent that says who we are. A 403/429 or an HTML challenge page is a wall: the adapter
 * gives up on that host for the run and the registry lists the book as skipped.
 */
export const BOOKS_USER_AGENT = "Betmatic/1.0 (+https://betmatic.app; odds comparison; contato@betmatic.app)";

export const HTTP_POLICY = {
  minGapMs: 1_000,
  timeoutMs: 10_000,
  retries: 1,
  cacheMs: 60_000,
  robotsMs: 24 * 60 * 60_000,
} as const;

const lastCallAt = new Map<string, number>();
const inMemory = new Map<string, { at: number; body: string; etag: string | null; status: number }>();

/** Tests must never reach the network: the adapters are tested through their parse functions. */
export function networkAllowed(): boolean {
  return !process.env.VITEST && process.env.BR_BOOKS_OFFLINE !== "1";
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Serialises calls per host: the next request to a host waits until a second has passed. */
async function politeSlot(host: string): Promise<void> {
  const wait = (lastCallAt.get(host) ?? 0) + HTTP_POLICY.minGapMs - Date.now();
  lastCallAt.set(host, Math.max(Date.now(), (lastCallAt.get(host) ?? 0) + HTTP_POLICY.minGapMs));
  if (wait > 0) await sleep(wait);
}

/** The Disallow rules that apply to us (User-agent: * — we never claim to be anyone else). */
export function parseRobots(text: string): string[] {
  const rules: string[] = [];
  let applies = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const [key, ...rest] = line.split(":");
    const value = rest.join(":").trim();
    const k = key.trim().toLowerCase();
    if (k === "user-agent") applies = value === "*";
    else if (applies && k === "disallow" && value) rules.push(value);
  }
  return rules;
}

/** A robots pattern (`*` wildcard, `$` end anchor) against a path. */
export function robotsBlocks(rules: string[], pathname: string): boolean {
  return rules.some((rule) => {
    const anchored = rule.endsWith("$");
    const body = anchored ? rule.slice(0, -1) : rule;
    const re = new RegExp(`^${body.split("*").map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*")}${anchored ? "$" : ""}`);
    return re.test(pathname);
  });
}

const robotsCache = new Map<string, string[]>();

async function robotsFor(origin: string): Promise<string[]> {
  const hit = robotsCache.get(origin);
  if (hit) return hit;
  const key = `br-books-robots-${origin}`;
  const cached = readCache<string[]>(key, HTTP_POLICY.robotsMs);
  if (cached) { robotsCache.set(origin, cached); return cached; }
  let rules: string[] = [];
  try {
    await politeSlot(new URL(origin).host);
    const res = await fetch(`${origin}/robots.txt`, { headers: { "user-agent": BOOKS_USER_AGENT }, signal: AbortSignal.timeout(HTTP_POLICY.timeoutMs), cache: "no-store" });
    // Only a real robots file counts; a 404 or an HTML error page means "no rules".
    if (res.ok && /text\/plain/i.test(res.headers.get("content-type") ?? "")) rules = parseRobots(await res.text());
  } catch {
    rules = [];
  }
  robotsCache.set(origin, rules);
  writeCache(key, rules);
  return rules;
}

const looksLikeChallenge = (status: number, contentType: string, body: string) =>
  status === 403 || status === 429 || status === 503 && /cloudflare|challenge|captcha/i.test(body) ||
  (/text\/html/i.test(contentType) && /cf-chl|challenge-platform|Um momento|Just a moment|awswaf|captcha/i.test(body.slice(0, 4000)));

export interface BookJsonResult<T> { data: T; status: number; fromCache: boolean; ms: number }

/**
 * GET a JSON document politely. `ttlMs` widens the cache for slow-moving documents (a league tree,
 * a struct file); it never goes below the 60 s floor.
 */
export async function bookJson<T = unknown>(url: string, opts: { ttlMs?: number; headers?: Record<string, string> } = {}): Promise<BookJsonResult<T>> {
  if (!networkAllowed()) throw new Error(`network disabled for book adapters (${url})`);
  const ttl = Math.max(HTTP_POLICY.cacheMs, opts.ttlMs ?? 0);
  const parsed = new URL(url);
  const origin = `${parsed.protocol}//${parsed.host}`;
  const cacheKey = `br-books-${url}`;
  const started = Date.now();

  const mem = inMemory.get(url);
  if (mem && Date.now() - mem.at < ttl) return { data: JSON.parse(mem.body) as T, status: mem.status, fromCache: true, ms: 0 };
  const disk = readCache<{ body: string; etag: string | null; status: number }>(cacheKey, ttl);
  if (disk) {
    inMemory.set(url, { at: Date.now(), ...disk });
    return { data: JSON.parse(disk.body) as T, status: disk.status, fromCache: true, ms: 0 };
  }

  if (robotsBlocks(await robotsFor(origin), parsed.pathname)) throw new RobotsDisallowedError(url);

  // A stale copy still carries its ETag: the revalidation can come back as a free 304.
  const stale = readCache<{ body: string; etag: string | null; status: number }>(cacheKey, 7 * 24 * 60 * 60_000);
  let attempt = 0;
  let lastError: unknown = null;
  while (attempt <= HTTP_POLICY.retries) {
    attempt += 1;
    await politeSlot(parsed.host);
    try {
      const res = await fetch(url, {
        headers: { accept: "application/json", "accept-language": "pt-BR,pt;q=0.9", "user-agent": BOOKS_USER_AGENT, ...(stale?.etag ? { "if-none-match": stale.etag } : {}), ...(opts.headers ?? {}) },
        signal: AbortSignal.timeout(HTTP_POLICY.timeoutMs),
        cache: "no-store",
      });
      if (res.status === 304 && stale) {
        writeCache(cacheKey, stale);
        inMemory.set(url, { at: Date.now(), ...stale });
        return { data: JSON.parse(stale.body) as T, status: 304, fromCache: true, ms: Date.now() - started };
      }
      const body = await res.text();
      const contentType = res.headers.get("content-type") ?? "";
      if (looksLikeChallenge(res.status, contentType, body)) throw new BookWallError(parsed.host, res.status);
      if (res.status >= 500 && attempt <= HTTP_POLICY.retries) { lastError = new Error(`${parsed.host} ${res.status}`); continue; }
      if (!res.ok) throw new Error(`${parsed.host} answered ${res.status} for ${parsed.pathname}`);
      let data: T;
      try { data = JSON.parse(body) as T; } catch { throw new Error(`${parsed.host} returned non-JSON for ${parsed.pathname}`); }
      const entry = { body, etag: res.headers.get("etag"), status: res.status };
      writeCache(cacheKey, entry);
      inMemory.set(url, { at: Date.now(), ...entry });
      return { data, status: res.status, fromCache: false, ms: Date.now() - started };
    } catch (error) {
      if (error instanceof BookWallError || error instanceof RobotsDisallowedError) throw error;
      lastError = error;
      // Only a network failure or a timeout earns the single retry.
      if (attempt > HTTP_POLICY.retries) break;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError ?? "fetch failed"));
}

/** Testing seam: forget the per-host clock and the in-memory copies. */
export function resetHttpState(): void {
  lastCallAt.clear();
  inMemory.clear();
  robotsCache.clear();
}
