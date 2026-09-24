import { altenarAdapters } from "@/lib/sources/br-books/altenar";
import { betfairExchangeAdapter } from "@/lib/sources/br-books/betfair-exchange";
import { betnacionalAdapter } from "@/lib/sources/br-books/betnacional";
import { ktoAdapter } from "@/lib/sources/br-books/kambi";
import { sportingbetAdapter } from "@/lib/sources/br-books/sportingbet";
import { superbetAdapter } from "@/lib/sources/br-books/superbet";
import type { BookAdapter } from "@/lib/sources/br-books/types";

/**
 * THE RULE, decided once so the distinction is deliberate: we read an endpoint only when it answers
 * a plain client — an honest User-Agent, no token of ours, no cookie, no challenge — and the host's
 * robots.txt does not disallow the path. A challenge anywhere on the path we would have to take
 * means skip; we never solve, spoof, rotate or impersonate to get past one. KTO (through the Kambi
 * offering CDN) and the Altenar tenants (through biahosted) meet the test: their HTML front doors
 * sit behind Cloudflare, but the odds API their pages call has no wall and answers the plain client
 * directly, so it is read and the front door is never touched. Betano and bet365 do not: their odds
 * calls refuse the plain client (403 / challenge), so they are out, not worked around. Betfair's
 * `_ak` and Sportingbet's `x-bwin-accessid` are the site builds' public identifiers, captured from
 * anonymous headless sessions of their public pages (scratchpad/books/api-betfair-ex.json,
 * api-sportingbet.json) — every visitor's browser sends them, nobody logged in.
 *
 * THE SAME TEST DECIDES THE IN-PLAY FEED, and it is asked separately: serving a pre-game list to a
 * plain client says nothing about whether the live board is open to one. Probed 24/09/2026:
 * Superbet (`index=live` plus the same per-event document), KTO through Kambi
 * (`event/live/open.json` plus the same bet-offer document) and the Altenar tenants
 * (`GetLiveEvents` plus the same `GetEventDetails`) all answer the plain client in play, so they
 * carry `fetchLiveOdds`. Betnacional, which answered the plain client in September, now returns a
 * Cloudflare challenge page (403) on its events BFF for pre-game AND live alike — it is skipped by
 * the rule, not worked around, and its adapter is left in place for the day the wall comes down.
 * Sportingbet and Betfair Exchange were re-checked on the same day and still answer 403: no live
 * feed is attempted for either.
 *
 * Every adapter that passed the test on 22/09/2026 is listed below, and so is every book that did
 * not, with the reason. The env decides which run: `BR_BOOKS=superbet,kambi:kto,altenar:estrelabet`
 * names them, `all` means every adapter, and unset or `none` means none — a deploy that never
 * edited its .env reads nobody. The admin panel adds a per-book switch on top (server/book-prices.ts).
 */
export const ALL_ADAPTERS: BookAdapter[] = [
  superbetAdapter,
  ktoAdapter,
  ...altenarAdapters,
  betfairExchangeAdapter,
  sportingbetAdapter,
  betnacionalAdapter,
];

/** Books probed and left out, with the reason — listed so nobody re-discovers the wall. */
export const SKIPPED_BOOKS: { book: string; reason: string }[] = [
  { book: "Betano", reason: "Cloudflare challenge on the site and 403 on the odds API for a plain client" },
  { book: "bet365", reason: "Cloudflare challenge; the SPA never hydrates without a real browser session" },
  { book: "Novibet", reason: "Cloudflare challenge" },
  { book: "Rivalo", reason: "403 + Cloudflare challenge on the front page" },
  { book: "7k", reason: "Cloudflare challenge" },
  { book: "F12", reason: "Cloudflare challenge" },
  { book: "Betão", reason: "Cloudflare challenge; odds only over a websocket (swarm)" },
  { book: "Betsson", reason: "CloudFront 403 on the odds API (AWS WAF token required)" },
  { book: "Betfair Sportsbook", reason: "Cloudflare challenge (the Exchange is read instead)" },
  { book: "VBet", reason: "odds only over a websocket (BetConstruct swarm), no JSON endpoint" },
  { book: "Esportes da Sorte", reason: "Sportingtech platform with signed/base64 request bodies — not attempted" },
  { book: "Stake", reason: "same Kambi feed and event ids as KTO; not duplicated" },
  { book: "Betfast / Tivo", reason: "odds served from a private cache API on a third-party host; not attempted" },
  { book: "Betnacional", reason: "answered a plain client in September; on 24/09/2026 its events BFF returns a Cloudflare challenge (403) for pre-game and live alike — the adapter stays, disabled by the wall" },
  { book: "Brazino777, Blaze, BetVIP, Papigames, BR4, Reals, MC Games, Bateu", reason: "casino-first; no WNBA/NBA player props exposed on their front pages" },
];

export const ADAPTER_IDS = ALL_ADAPTERS.map((a) => a.id);

/** Adapter ids the env enables: unset or `none` → none, `all` → all, else the listed ids (unknown ones ignored). */
export function enabledAdapterIds(env: Record<string, string | undefined>): string[] {
  const raw = (env.BR_BOOKS ?? "").trim().toLowerCase();
  if (!raw || raw === "none") return [];
  if (raw === "all") return ADAPTER_IDS;
  return raw.split(",").map((s) => s.trim()).filter((id) => ADAPTER_IDS.includes(id));
}

export function adaptersFor(env: Record<string, string | undefined> = process.env): BookAdapter[] {
  const ids = new Set(enabledAdapterIds(env));
  return ALL_ADAPTERS.filter((a) => ids.has(a.id));
}

export function findAdapter(id: string): BookAdapter | null {
  return ALL_ADAPTERS.find((a) => a.id === id) ?? null;
}

/** Tunables with their defaults; documented in .env.example. */
export function booksConfig(env: Record<string, string | undefined> = process.env) {
  const num = (v: string | undefined, d: number) => { const n = Number(v); return v !== undefined && v.trim() !== "" && Number.isFinite(n) ? n : d; };
  return {
    /** A book is "out of step" when its price on a player line sits this far (in %) from the median of the other books. */
    dispersionPct: Math.max(1, num(env.BOOKS_DISPERSION_PCT, 7)),
    /** How far ahead the refresh looks for events. */
    horizonHours: Math.max(1, num(env.BOOKS_HORIZON_HOURS, 48)),
    /** One adapter may not hold the cron longer than this (its requests are aborted at the deadline). */
    adapterTimeoutMs: Math.max(5_000, num(env.BOOKS_ADAPTER_TIMEOUT_MS, 90_000)),
    /** The whole tick's budget: adapters whose turn comes after it wait for the next tick. */
    jobBudgetMs: Math.max(30_000, num(env.BOOKS_JOB_BUDGET_MS, 8 * 60_000)),
    /** Days of price history kept after kickoff; older games are deleted with their rows. */
    retentionDays: Math.max(1, Math.min(90, num(env.BOOKS_RETENTION_DAYS, 14))),
  };
}
