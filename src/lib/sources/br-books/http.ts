import { readCache, writeCache } from "@/lib/cache";
import { BookWallError, RobotsDisallowedError } from "@/lib/sources/br-books/types";

/**
 * The one way a book adapter talks to the network. Politeness is enforced here, not trusted to each
 * adapter: at least one second between calls to the same host (more when robots.txt asks for a
 * Crawl-delay), a 10 s timeout, at most one retry (and only on a network error or a 5xx), a 60 s
 * cache by URL (in memory, bounded; on disk only for slow documents such as a league tree, and
 * ETag-aware so a repeat after the window can be a free 304), robots.txt honoured per host
 * (RFC 9309: a 5xx or an unreachable robots file means "disallow for now"), and an honest
 * User-Agent that says who we are. A 403/429 or an HTML challenge page is a wall: the adapter gives
 * up on that host for the run and the registry lists the book as skipped. The caller's AbortSignal
 * cancels both the request in flight and the politeness wait, so a timed-out adapter stops for real.
 */
export const BOOKS_USER_AGENT = "Betmatic/1.0 (+https://betmatic.app; odds comparison; contato@betmatic.app)";

export const HTTP_POLICY = {
  minGapMs: 1_000,
  timeoutMs: 10_000,
  retries: 1,
  cacheMs: 60_000,
  robotsMs: 24 * 60 * 60_000,
  /** A robots file the host could not serve (5xx, network) is retried after this long; until then: disallow. */
  robotsRetryMs: 60 * 60_000,
  /** Bodies kept in memory (the per-event documents are 0.1–4 MB each; the map is bounded, not a leak). */
  memoryEntries: 120,
  /** A body kept past its TTL only for its ETag, so the revalidation can come back as a 304. */
  memoryStaleMs: 15 * 60_000,
} as const;

const lastCallAt = new Map<string, number>();
const crawlDelayMs = new Map<string, number>();
interface Entry { at: number; body: string; etag: string | null; status: number }
const inMemory = new Map<string, Entry>();

/** Insertion-ordered map as an LRU: a hit re-inserts, the oldest entry goes when the cap is reached. */
function remember(url: string, entry: Entry): void {
  inMemory.delete(url);
  inMemory.set(url, entry);
  while (inMemory.size > HTTP_POLICY.memoryEntries) {
    const oldest = inMemory.keys().next().value;
    if (oldest === undefined) break;
    inMemory.delete(oldest);
  }
}

class AbortedError extends Error {
  constructor() { super("aborted"); this.name = "AbortError"; }
}

const throwIfAborted = (signal?: AbortSignal) => { if (signal?.aborted) throw new AbortedError(); };

/** Tests must never reach the network: the adapters are tested through their parse functions. */
export function networkAllowed(): boolean {
  return !process.env.VITEST && process.env.BR_BOOKS_OFFLINE !== "1";
}

/** A wait that ends early when the caller's signal fires. */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new AbortedError());
    const timer = setTimeout(() => { signal?.removeEventListener("abort", onAbort); resolve(); }, ms);
    const onAbort = () => { clearTimeout(timer); reject(new AbortedError()); };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** Serialises calls per host: the next request to a host waits until a second (or the Crawl-delay) has passed. */
async function politeSlot(host: string, signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal);
  const gap = Math.max(HTTP_POLICY.minGapMs, crawlDelayMs.get(host) ?? 0);
  const wait = (lastCallAt.get(host) ?? 0) + gap - Date.now();
  lastCallAt.set(host, Math.max(Date.now(), (lastCallAt.get(host) ?? 0) + gap));
  if (wait > 0) await sleep(wait, signal);
}

export interface RobotsRules { disallow: string[]; crawlDelayMs: number | null }

/**
 * The rules that apply to us: the group(s) naming `*` — we never claim to be anyone else. Per
 * RFC 9309 consecutive User-agent lines form one group, so `User-agent: *` followed by another
 * User-agent line still applies; a later `User-agent` after rules starts a new group.
 */
export function parseRobots(text: string): RobotsRules {
  const out: RobotsRules = { disallow: [], crawlDelayMs: null };
  let inHeader = false, applies = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const [key, ...rest] = line.split(":");
    const value = rest.join(":").trim();
    const k = key.trim().toLowerCase();
    if (k === "user-agent") {
      // A user-agent line after rules opens a new group; one straight after another extends it.
      if (!inHeader) applies = false;
      inHeader = true;
      if (value === "*") applies = true;
      continue;
    }
    inHeader = false;
    if (!applies) continue;
    if (k === "disallow" && value) out.disallow.push(value);
    else if (k === "crawl-delay") { const s = Number(value); if (Number.isFinite(s) && s > 0) out.crawlDelayMs = Math.min(60_000, Math.round(s * 1000)); }
  }
  return out;
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

const robotsCache = new Map<string, { rules: RobotsRules; until: number }>();
const DISALLOW_ALL: RobotsRules = { disallow: ["/"], crawlDelayMs: null };

/**
 * robots.txt per host, RFC 9309: a 2xx text file is the rules; a 4xx (none published, or the host
 * answers 401/404/429 to the path — the Kambi CDN does) means no rules; a 5xx or a network failure
 * means "unreachable": complete disallow, retried after an hour rather than cached for a day.
 */
async function robotsFor(origin: string, signal?: AbortSignal): Promise<RobotsRules> {
  const hit = robotsCache.get(origin);
  if (hit && hit.until > Date.now()) return hit.rules;
  const key = `br-books-robots-${origin}`;
  const cached = readCache<RobotsRules>(key, HTTP_POLICY.robotsMs);
  if (cached && Array.isArray(cached.disallow)) { robotsCache.set(origin, { rules: cached, until: Date.now() + HTTP_POLICY.robotsMs }); return cached; }
  const host = new URL(origin).host;
  let rules: RobotsRules = { disallow: [], crawlDelayMs: null };
  let reachable = true;
  try {
    await politeSlot(host, signal);
    const res = await fetch(`${origin}/robots.txt`, { headers: { "user-agent": BOOKS_USER_AGENT }, signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(HTTP_POLICY.timeoutMs)]) : AbortSignal.timeout(HTTP_POLICY.timeoutMs), cache: "no-store" });
    if (res.status >= 500) reachable = false;
    else if (res.ok && /text\/plain/i.test(res.headers.get("content-type") ?? "")) rules = parseRobots(await res.text());
  } catch (error) {
    if (error instanceof AbortedError || (error instanceof Error && error.name === "AbortError")) throw error;
    reachable = false;
  }
  if (!reachable) {
    robotsCache.set(origin, { rules: DISALLOW_ALL, until: Date.now() + HTTP_POLICY.robotsRetryMs });
    return DISALLOW_ALL;
  }
  if (rules.crawlDelayMs) crawlDelayMs.set(host, rules.crawlDelayMs);
  robotsCache.set(origin, { rules, until: Date.now() + HTTP_POLICY.robotsMs });
  writeCache(key, rules);
  return rules;
}

const looksLikeChallenge = (status: number, contentType: string, body: string) =>
  status === 403 || status === 429 || status === 503 && /cloudflare|challenge|captcha/i.test(body) ||
  (/text\/html/i.test(contentType) && /cf-chl|challenge-platform|Um momento|Just a moment|awswaf|captcha/i.test(body.slice(0, 4000)));

export interface BookJsonResult<T> { data: T; status: number; fromCache: boolean; ms: number }

/**
 * GET a JSON document politely. `ttlMs` sets this document's cache window: left out it is the 60 s
 * default, a large value widens it for a slow-moving document (a league tree, a struct file) and
 * reaches the disk cache, and a SMALL value narrows it — which is what an in-play read passes,
 * because a live price's only value is that it is current and a minute-old number is the very
 * thing this product refuses to print. Narrowing the cache does not make us impolite: the one
 * request per second per host still holds, and a document that has not changed still comes back
 * as a free 304 through its ETag.
 */
export async function bookJson<T = unknown>(url: string, opts: { ttlMs?: number; headers?: Record<string, string>; signal?: AbortSignal } = {}): Promise<BookJsonResult<T>> {
  if (!networkAllowed()) throw new Error(`network disabled for book adapters (${url})`);
  throwIfAborted(opts.signal);
  const ttl = opts.ttlMs === undefined ? HTTP_POLICY.cacheMs : Math.max(0, opts.ttlMs);
  const onDisk = ttl > HTTP_POLICY.cacheMs;
  const parsed = new URL(url);
  const origin = `${parsed.protocol}//${parsed.host}`;
  const cacheKey = `br-books-${url}`;
  const started = Date.now();

  const mem = inMemory.get(url);
  if (mem && Date.now() - mem.at < ttl) { remember(url, mem); return { data: JSON.parse(mem.body) as T, status: mem.status, fromCache: true, ms: 0 }; }
  const disk = onDisk ? readCache<Entry>(cacheKey, ttl) : null;
  if (disk) {
    remember(url, { ...disk, at: Date.now() });
    return { data: JSON.parse(disk.body) as T, status: disk.status, fromCache: true, ms: 0 };
  }

  if (robotsBlocks((await robotsFor(origin, opts.signal)).disallow, parsed.pathname)) throw new RobotsDisallowedError(url);

  // A stale copy still carries its ETag: the revalidation can come back as a free 304.
  const stale = (mem && Date.now() - mem.at < HTTP_POLICY.memoryStaleMs ? mem : null) ?? (onDisk ? readCache<Entry>(cacheKey, 7 * 24 * 60 * 60_000) : null);
  let attempt = 0;
  let lastError: unknown = null;
  while (attempt <= HTTP_POLICY.retries) {
    attempt += 1;
    await politeSlot(parsed.host, opts.signal);
    try {
      const res = await fetch(url, {
        headers: { accept: "application/json", "accept-language": "pt-BR,pt;q=0.9", "user-agent": BOOKS_USER_AGENT, ...(stale?.etag ? { "if-none-match": stale.etag } : {}), ...(opts.headers ?? {}) },
        signal: opts.signal ? AbortSignal.any([opts.signal, AbortSignal.timeout(HTTP_POLICY.timeoutMs)]) : AbortSignal.timeout(HTTP_POLICY.timeoutMs),
        cache: "no-store",
      });
      if (res.status === 304 && stale) {
        const fresh = { ...stale, at: Date.now() };
        if (onDisk) writeCache(cacheKey, fresh);
        remember(url, fresh);
        return { data: JSON.parse(stale.body) as T, status: 304, fromCache: true, ms: Date.now() - started };
      }
      const body = await res.text();
      const contentType = res.headers.get("content-type") ?? "";
      if (looksLikeChallenge(res.status, contentType, body)) throw new BookWallError(parsed.host, res.status);
      if (res.status >= 500 && attempt <= HTTP_POLICY.retries) { lastError = new Error(`${parsed.host} ${res.status}`); continue; }
      if (!res.ok) throw new Error(`${parsed.host} answered ${res.status} for ${parsed.pathname}`);
      let data: T;
      try { data = JSON.parse(body) as T; } catch { throw new Error(`${parsed.host} returned non-JSON for ${parsed.pathname}`); }
      const entry: Entry = { at: Date.now(), body, etag: res.headers.get("etag"), status: res.status };
      if (onDisk) writeCache(cacheKey, entry);
      remember(url, entry);
      return { data, status: res.status, fromCache: false, ms: Date.now() - started };
    } catch (error) {
      if (error instanceof BookWallError || error instanceof RobotsDisallowedError || error instanceof AbortedError) throw error;
      // The caller pulled the plug (its own signal): stop, do not retry.
      if (opts.signal?.aborted) throw new AbortedError();
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
  crawlDelayMs.clear();
  inMemory.clear();
  robotsCache.clear();
}

/** Testing seam: what the bounded memory cache holds. */
export function memoryCacheSize(): number {
  return inMemory.size;
}

/** Testing seam: put a body in the memory cache the way a fetch would. */
export function rememberBody(url: string, entry: { at: number; body: string; etag: string | null; status: number }): void {
  remember(url, entry);
}

export const isAbortError = (error: unknown): boolean => error instanceof AbortedError || (error instanceof Error && error.name === "AbortError");
