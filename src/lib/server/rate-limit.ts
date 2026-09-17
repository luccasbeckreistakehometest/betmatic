/**
 * In-memory sliding-window limiter. One Node process serves the app, so a process-local map is the
 * whole truth; it resets on deploy, which is acceptable for abuse control (not for billing).
 *
 * Keys are scoped: "ip:<addr>" limits are multiplied by RATE_LIMIT_IP_FACTOR (the e2e suite runs
 * every spec from one address), account-scoped limits are not.
 */
type Store = Map<string, number[]>;
const g = globalThis as unknown as { __bmRateLimit?: Store; __bmRateLimitHits?: number };
const store: Store = (g.__bmRateLimit ??= new Map());

export interface LimitRule { max: number; windowMs: number }

const MIN = 60_000;
export const RULES = {
  loginIp: { max: 40, windowMs: 15 * MIN },
  loginAccount: { max: 8, windowMs: 15 * MIN },
  signupIp: { max: 6, windowMs: 60 * MIN },
  contactIp: { max: 5, windowMs: 60 * MIN },
  passwordAccount: { max: 6, windowMs: 15 * MIN },
  accountDangerAccount: { max: 5, windowMs: 60 * MIN },
  checkoutAccount: { max: 12, windowMs: 60 * MIN },
  aiAccount: { max: 30, windowMs: 60 * MIN },
  aiIp: { max: 60, windowMs: 60 * MIN },
  slipAccount: { max: 10, windowMs: 60 * MIN },
  scanSaveAccount: { max: 30, windowMs: 60 * MIN },
  reviewAccount: { max: 20, windowMs: 60 * MIN },
  playerAccount: { max: 90, windowMs: 60 * MIN },
  liveAccount: { max: 150, windowMs: 60 * MIN },
  eventsIp: { max: 240, windowMs: 10 * MIN },
  exportAccount: { max: 5, windowMs: 60 * MIN },
  webhookIp: { max: 120, windowMs: MIN },
  tourIp: { max: 120, windowMs: MIN },
  tourAnonIp: { max: 60, windowMs: 60 * MIN },
} satisfies Record<string, LimitRule>;
export type RuleName = keyof typeof RULES;

function factorFor(key: string): number {
  if (!key.startsWith("ip:")) return 1;
  const f = Number(process.env.RATE_LIMIT_IP_FACTOR);
  return Number.isFinite(f) && f > 0 ? f : 1;
}

function prune(now: number): void {
  g.__bmRateLimitHits = (g.__bmRateLimitHits ?? 0) + 1;
  if (g.__bmRateLimitHits % 500 !== 0 && store.size < 20_000) return;
  for (const [key, hits] of store) {
    const fresh = hits.filter((t) => now - t < 60 * MIN);
    if (fresh.length) store.set(key, fresh);
    else store.delete(key);
  }
}

export interface LimitResult { ok: boolean; remaining: number; retryAfterSec: number }

function evaluate(bucket: string, rule: LimitRule, now: number, record: boolean): LimitResult {
  const scope = bucket.slice(bucket.indexOf("|") + 1);
  const max = Math.max(1, Math.round(rule.max * factorFor(scope)));
  const hits = (store.get(bucket) ?? []).filter((t) => now - t < rule.windowMs);
  if (hits.length >= max) {
    store.set(bucket, hits);
    return { ok: false, remaining: 0, retryAfterSec: Math.max(1, Math.ceil((hits[0] + rule.windowMs - now) / 1000)) };
  }
  if (record) hits.push(now);
  store.set(bucket, hits);
  return { ok: true, remaining: max - hits.length, retryAfterSec: 0 };
}

/** Counts one hit against `rule` for `key` and says whether it is allowed. */
export function hit(rule: RuleName, key: string, now = Date.now()): LimitResult {
  prune(now);
  return evaluate(`${rule}|${key}`, RULES[rule], now, true);
}

/** Checks without counting — for limits that only count failures (login). */
export function peek(rule: RuleName, key: string, now = Date.now()): LimitResult {
  return evaluate(`${rule}|${key}`, RULES[rule], now, false);
}

/** Records a hit regardless of the outcome (e.g. a failed login after a peek). */
export function record(rule: RuleName, key: string, now = Date.now()): void {
  evaluate(`${rule}|${key}`, RULES[rule], now, true);
}

export function resetRateLimits(): void {
  store.clear();
}

/**
 * Client address, taken from the LAST entry of X-Forwarded-For.
 *
 * Caddy does not replace the header: it APPENDS the peer it actually spoke to. So a caller that
 * sends `X-Forwarded-For: 1.2.3.4` turns it into `1.2.3.4, <real client>` — the first entry is
 * whatever the attacker typed, and reading it hands every per-IP limit (login, signup, contact,
 * AI cost) a fresh bucket on each request. The last entry is the only one Caddy wrote itself.
 * `x-real-ip` (single value, also written by the proxy) is the fallback, then the local bucket.
 */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const hops = forwarded?.split(",").map((h) => h.trim()).filter(Boolean) ?? [];
  const last = hops.at(-1);
  if (last) return last.slice(0, 64);
  const real = request.headers.get("x-real-ip")?.trim();
  return real ? real.slice(0, 64) : "local";
}

export const ipKey = (request: Request) => `ip:${clientIp(request)}`;
export const accountKey = (id: string) => `acct:${id.toLowerCase()}`;
