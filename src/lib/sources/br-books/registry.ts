import { altenarAdapters } from "@/lib/sources/br-books/altenar";
import { betfairExchangeAdapter } from "@/lib/sources/br-books/betfair-exchange";
import { betnacionalAdapter } from "@/lib/sources/br-books/betnacional";
import { ktoAdapter } from "@/lib/sources/br-books/kambi";
import { sportingbetAdapter } from "@/lib/sources/br-books/sportingbet";
import { superbetAdapter } from "@/lib/sources/br-books/superbet";
import type { BookAdapter } from "@/lib/sources/br-books/types";

/**
 * Every adapter that answered a plain client on 22/09/2026, and the books that did not. The env
 * decides which run (`BR_BOOKS=superbet,kambi:kto,altenar:estrelabet`); unset means every adapter
 * below, `none` means none, and a test process gets none unless a test names them. The admin
 * panel adds a per-book switch on top of this (server/book-prices.ts).
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
  { book: "Brazino777, Blaze, BetVIP, Papigames, BR4, Reals, MC Games, Bateu", reason: "casino-first; no WNBA/NBA player props exposed on their front pages" },
];

export const ADAPTER_IDS = ALL_ADAPTERS.map((a) => a.id);

/** Adapter ids the env enables. Pure so it is unit-tested; unknown ids are ignored, not fatal. */
export function enabledAdapterIds(env: Record<string, string | undefined>): string[] {
  const raw = (env.BR_BOOKS ?? "").trim();
  if (raw.toLowerCase() === "none") return [];
  if (!raw) return env.VITEST ? [] : ADAPTER_IDS;
  return raw.split(",").map((s) => s.trim().toLowerCase()).filter((id) => ADAPTER_IDS.includes(id));
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
    /** One adapter may not hold the cron longer than this. */
    adapterTimeoutMs: Math.max(5_000, num(env.BOOKS_ADAPTER_TIMEOUT_MS, 90_000)),
  };
}
