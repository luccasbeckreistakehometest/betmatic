import { stripAccents } from "@/lib/sources/br-books/normalise";
import type { BookPrice, BookSport, SelectionRef } from "@/lib/sources/br-books/types";

/**
 * "Abrir na casa com o bilhete montado": the public URL that opens a bookmaker's site with a
 * selection (or a whole ticket) already in the betslip, or — where the book's URL scheme cannot
 * carry a selection — its exact event or market page. URL construction only: nothing here logs in,
 * automates a site or places a bet; the reader clicks and the book's own client does the rest.
 *
 * Every scheme below names where the knowledge came from and whether it was verified on
 * 2026-09-22 by opening ONE real link built from that day's prices in plain headless Chromium (its
 * honest HeadlessChrome User-Agent, no cookies, one load, no retry) and reading the betslip on
 * screen (scratchpad/deeplinks-evidence/<book>.png). A book whose site answers a plain client with
 * a challenge is built from its own published scheme and marked `verified: false`; nothing was
 * done to get past a challenge, and a path a host's robots.txt disallows was never fetched.
 *
 * Affiliate tags come from the env, `BOOK_AFFILIATE_<BOOK>` (see `bookEnvKey`), and are appended
 * verbatim to the query — before the hash on the one platform whose deep link lives in the hash.
 * Nothing about the reader ever enters a URL.
 */
export type DeepLinkKind = "betslip" | "event" | "market";

export interface DeepLink {
  book: string;
  url: string;
  /** betslip = the selection(s) pre-filled; event / market = the right page, the reader picks. */
  kind: DeepLinkKind;
  /** Opened and read on the day it was built (see the registry); false = built from a published scheme only. */
  verified: boolean;
  /** How many selections the link carries. */
  selections: number;
}

export interface DeepLinkOptions {
  /** `bookEnvKey(book)` → the tag to append ("btag=abc"). Missing or empty = no tag. */
  affiliate?: Record<string, string>;
}

export interface DeepLinkScheme {
  /** Adapter family, or family:tenant for the Altenar books. */
  platform: string;
  book: string;
  kind: DeepLinkKind | "none";
  /** Whether one link can carry every leg of a ticket. */
  multi: boolean;
  verified: boolean;
  /** The URL form, with the ids it needs. */
  scheme: string;
  /** Where the form came from: a public document, or the site's own links, observed on a date. */
  source: string;
  notes?: string;
}

const OBSERVED = "observed on 2026-09-22";

/** Documented so nobody re-derives a scheme — or trusts one this list says was never opened. */
export const DEEP_LINK_REGISTRY: DeepLinkScheme[] = [
  {
    platform: "superbet", book: "Superbet", kind: "betslip", multi: true, verified: true,
    scheme: "https://superbet.bet.br/betslip?bets[]=<eventId>,<outcomeId>,<specialBetValue>,0,<oddUuid>[&bets[]=…]&type=simple&target_screen=soccer_event_details",
    source: `the site's own share-ticket builder in its public bundle (static/js/async/bootstrap.*.js: addSelectionsFromUrl reads bets[] as "matchId,oddId,specialBetValue,fix,oddUuid" on the /betslip route; target_screen=soccer_event_details then lands on the event page); event URL form from https://superbet.bet.br/sitemap/events.xml; ${OBSERVED}`,
    notes: "verified with one and with two selections (the slip listed both and priced the double); the event page /odds/<sport>/<slug>-<eventId> renders whatever the slug says",
  },
  {
    platform: "kambi", book: "KTO", kind: "betslip", multi: true, verified: false,
    scheme: "https://www.kto.bet.br/app/esportes/#?coupon=combination|<outcomeId>[,<outcomeId>…]|0|replace",
    source: `KTO's own promo cards in Kambi's public startup settings (https://settings-api.kambicdn.com/ktobr__startup.json, read ${OBSERVED.replace("observed on ", "")}: ".../app/esportes/#?coupon=combination|<outcomeId>|10|replace"), the form FDJ United's "Sportsbook deeplinking" guide documents for the Kambi client (developer.kindredgroup.com: coupon=<type>|<outcomeIds, comma-separated>|<stake>|replace)`,
    notes: "NOT verified: www.kto.bet.br answers a Cloudflare challenge to a plain client and its robots.txt disallows /app/*, so the link was never opened; the outcome ids are Kambi's own, read from the same CDN the site reads",
  },
  // The five Altenar tenants share one widget (sb2wsdk-altenar2.biahosted.com/altenarWSDK.js) whose
  // content only renders after a token-validation script (wsdk-core: ZW5jb2RlZF9zY3JpcHQv1.min.js)
  // has run — a plain client sees the shell, never an event, so no event URL could be observed and
  // none is guessed. The widget's JS API takes `oddIds` (an operator page can pre-fill the slip from
  // it), but no tenant exposed a URL parameter that reaches it.
  {
    platform: "altenar:lotogreen", book: "LotoGreen", kind: "none", multi: false, verified: false,
    scheme: "", source: `the site's own anchors stop at the sport and championship pages (/sports/<sport>/s-<sportId>, /sports/<sport>/<country>/c-<champId>), ${OBSERVED}`,
    notes: "no event page route was exposed to a plain client; no link is built rather than a guessed one",
  },
  {
    platform: "altenar:estrelabet", book: "EstrelaBet", kind: "none", multi: false, verified: false,
    scheme: "", source: `/aposta-esportiva rendered for a plain client (the site's front door answered a Cloudflare challenge on an earlier day) but its widget exposed no event anchors, ${OBSERVED}`,
    notes: "no link is built rather than a guessed one",
  },
  {
    platform: "altenar:apostaganha", book: "Aposta Ganha", kind: "none", multi: false, verified: false,
    scheme: "", source: `/esportes/home#/overview rendered its shell only (the widget stayed on "Carregando…"), ${OBSERVED}`,
    notes: "no link is built rather than a guessed one",
  },
  {
    platform: "altenar:betpix365", book: "BetPix365", kind: "none", multi: false, verified: false,
    scheme: "", source: `/sports rendered its shell only, no event anchors, ${OBSERVED}`,
    notes: "no link is built rather than a guessed one",
  },
  {
    platform: "altenar:vaidebet", book: "Vaidebet", kind: "none", multi: false, verified: false,
    scheme: "", source: `/sports rendered its shell only, no event anchors, ${OBSERVED}`,
    notes: "no link is built rather than a guessed one",
  },
  {
    platform: "betfair-exchange", book: "Betfair Exchange", kind: "market", multi: false, verified: true,
    scheme: "https://www.betfair.bet.br/exchange/plus/<basketball|football>/market/<marketId>",
    source: `the exchange's own event page: its market anchors are href="basketball/market/<marketId>" under <base href="/exchange/plus/">, ${OBSERVED}`,
    notes: "an exchange has no pre-filled back or lay by URL; the market page opens with the runners on screen",
  },
  {
    platform: "sportingbet", book: "Sportingbet", kind: "betslip", multi: true, verified: true,
    scheme: "https://www.sportingbet.bet.br/pt-br/sports?options=<fixtureId>-<gameId>-<resultId>[,…]&type=single|combo",
    source: `Entain's public deep-link documents (https://sportsapi.bwin.com/restapi/elementsdeeplink.html and .../generatedeeplink.html: options=<fixtureId>-<marketId>-<optionId>, triplets comma-separated, type=combo, on /<culture>/sports); the ids are the ones the CDS fixture list prints (V1 fixtures, no "2:" prefix); ${OBSERVED}`,
    notes: "verified with one and with two selections; the event page (/pt-br/sports/eventos/<slug>-<fixtureId>) drops the query on its canonical-slug redirect, so the slip link is the sports-home form",
  },
  {
    platform: "betnacional", book: "Betnacional", kind: "event", multi: false, verified: true,
    scheme: "https://betnacional.bet.br/event/<sportId 2=basketball,1=football>/0/<eventId>",
    source: `the site's Next.js build manifest (/event/[sportId]/[isLive]/[eventId]) and its home page's own anchors (/event/1/0/<eventId>), ${OBSERVED}`,
    notes: "the page's title and breadcrumb named the event; its odds body answered 503 to the plain client at verification time",
  },
  {
    platform: "betano", book: "Betano", kind: "none", multi: false, verified: false,
    scheme: "", source: "no Betano prices are read (Cloudflare challenge on the site and 403 on its odds API), so there is no event or selection id to link",
  },
];

/** "Aposta Ganha" → APOSTA_GANHA, "Betfair Exchange" → BETFAIR_EXCHANGE: the env suffix of BOOK_AFFILIATE_*. */
export function bookEnvKey(book: string): string {
  return stripAccents(book).toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

/** `BOOK_AFFILIATE_<BOOK>=btag=…` from the env, empty values dropped. */
export function affiliateTagsFromEnv(env: Record<string, string | undefined> = process.env): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    const m = k.match(/^BOOK_AFFILIATE_([A-Z0-9_]+)$/);
    const tag = (v ?? "").trim();
    if (m && tag) out[m[1]] = tag;
  }
  return out;
}

/**
 * Appends a tag verbatim: a query fragment goes before the hash (a deep link that lives in the
 * hash must stay last); a tag that starts with "#" is a hash fragment and goes at the end.
 */
export function withAffiliate(url: string, tag: string | undefined): string {
  const t = (tag ?? "").trim().replace(/^[?&]/, "");
  if (!t) return url;
  if (t.startsWith("#")) return `${url}${t}`;
  const hashAt = url.indexOf("#");
  const base = hashAt >= 0 ? url.slice(0, hashAt) : url;
  const hash = hashAt >= 0 ? url.slice(hashAt) : "";
  return `${base}${base.includes("?") ? "&" : "?"}${t}${hash}`;
}

const slug = (s: string) => stripAccents(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

const SUPERBET_SPORT: Record<BookSport, string> = { basketball: "basquete", soccer: "futebol" };
const BETFAIR_SPORT: Record<BookSport, string> = { basketball: "basketball", soccer: "football" };
const BETNACIONAL_SPORT: Record<BookSport, string> = { basketball: "2", soccer: "1" };

const ref = (p: BookPrice): SelectionRef => p.ref ?? {};
const has = (r: SelectionRef, ...keys: (keyof SelectionRef)[]) => keys.every((k) => typeof r[k] === "string" && r[k]!.length > 0);
const eventIdOf = (p: BookPrice, ext: string): string | undefined => ref(p).eventId ?? p.event.externalIds[ext];

// ---- per platform -----------------------------------------------------------------------------------

/**
 * Superbet: bets[] = "matchId,oddId,specialBetValue,fix,oddUuid", as its own share builder writes
 * it — the special-bet value percent-encoded before the comma join (a player line's "Amoore,
 * Georgia-7.5" carries a comma of its own, and the loader splits the field on commas), the whole
 * value encoded again by URLSearchParams, exactly the double encoding the site's links carry.
 */
function superbetSlip(prices: BookPrice[]): string | null {
  const params = new URLSearchParams();
  for (const p of prices) {
    const r = ref(p);
    const eventId = eventIdOf(p, "superbet");
    if (!eventId || !has(r, "outcomeId", "uuid")) return null;
    params.append("bets[]", `${eventId},${r.outcomeId},${encodeURIComponent(r.specialBetValue ?? "")},0,${r.uuid}`);
  }
  params.set("type", "simple");
  params.set("target_screen", "soccer_event_details");
  return `https://superbet.bet.br/betslip?${params.toString()}`;
}

function superbetEventPage(p: BookPrice): string | null {
  const eventId = eventIdOf(p, "superbet");
  if (!eventId) return null;
  return `https://superbet.bet.br/odds/${SUPERBET_SPORT[p.sport]}/${slug(p.event.home)}-x-${slug(p.event.away)}-${eventId}`;
}

/** KTO (Kambi client): coupon=combination|<outcomeIds>|<stake>|replace, as KTO's own promo cards are written. */
function kambiSlip(prices: BookPrice[]): string | null {
  const ids = prices.map((p) => ref(p).outcomeId);
  if (ids.some((id) => !id)) return null;
  return `https://www.kto.bet.br/app/esportes/#?coupon=combination|${ids.join(",")}|0|replace`;
}

function betfairMarket(p: BookPrice): string | null {
  const r = ref(p);
  if (!has(r, "marketId")) return null;
  return `https://www.betfair.bet.br/exchange/plus/${BETFAIR_SPORT[p.sport]}/market/${r.marketId}`;
}

/** Sportingbet (Entain): options=<fixtureId>-<gameId>-<resultId>[,…]&type=single|combo on the sports home. */
function sportingbetSlip(prices: BookPrice[]): string | null {
  const triplets: string[] = [];
  for (const p of prices) {
    const r = ref(p);
    const fixtureId = eventIdOf(p, "sportingbet");
    if (!fixtureId || !has(r, "marketId", "outcomeId")) return null;
    triplets.push(`${fixtureId}-${r.marketId}-${r.outcomeId}`);
  }
  return `https://www.sportingbet.bet.br/pt-br/sports?options=${triplets.join(",")}&type=${triplets.length > 1 ? "combo" : "single"}`;
}

function betnacionalEvent(p: BookPrice): string | null {
  const eventId = eventIdOf(p, "betnacional");
  if (!eventId) return null;
  return `https://betnacional.bet.br/event/${BETNACIONAL_SPORT[p.sport]}/0/${eventId}`;
}

// ---- the two entry points ---------------------------------------------------------------------------

const link = (book: string, url: string | null, kind: DeepLinkKind, verified: boolean, selections: number, opts: DeepLinkOptions): DeepLink | null =>
  url ? { book, url: withAffiliate(url, opts.affiliate?.[bookEnvKey(book)]), kind, verified, selections } : null;

/**
 * The link for one selection at its book: the betslip pre-filled where the platform's URL scheme
 * carries a selection, else the event or market page; null when the row lacks the ids or the
 * platform has no usable scheme (the Altenar tenants today).
 */
export function deepLinkFor(price: BookPrice, opts: DeepLinkOptions = {}): DeepLink | null {
  const book = price.book;
  switch (price.platform) {
    case "superbet":
      return link(book, superbetSlip([price]), "betslip", true, 1, opts) ?? link(book, superbetEventPage(price), "event", true, 0, opts);
    case "kambi":
      return link(book, kambiSlip([price]), "betslip", false, 1, opts);
    case "betfair-exchange":
      return link(book, betfairMarket(price), "market", true, 0, opts);
    case "sportingbet":
      return link(book, sportingbetSlip([price]), "betslip", true, 1, opts);
    case "betnacional":
      return link(book, betnacionalEvent(price), "event", true, 0, opts);
    default:
      return null;
  }
}

/**
 * Every leg of a ticket in one betslip at one book. Only the platforms whose scheme takes several
 * selections (Superbet, KTO, Sportingbet) can; the rows must all be that book's, and each must
 * carry its ids. One row is the single-selection link.
 */
export function ticketDeepLinkFor(prices: BookPrice[], opts: DeepLinkOptions = {}): DeepLink | null {
  if (!prices.length) return null;
  const [first] = prices;
  if (prices.some((p) => p.book !== first.book || p.platform !== first.platform)) return null;
  if (prices.length === 1) return deepLinkFor(first, opts);
  const n = prices.length;
  switch (first.platform) {
    case "superbet":
      return link(first.book, superbetSlip(prices), "betslip", true, n, opts);
    case "kambi":
      return link(first.book, kambiSlip(prices), "betslip", false, n, opts);
    case "sportingbet":
      return link(first.book, sportingbetSlip(prices), "betslip", true, n, opts);
    default:
      return null;
  }
}

/** Whether one link at this platform can carry a whole ticket. */
export function supportsTicketLink(platform: string): boolean {
  return platform === "superbet" || platform === "kambi" || platform === "sportingbet";
}

/** A link, and exactly which of the selections it was asked for the URL itself pre-fills. */
export interface SelectionsLink {
  link: DeepLink;
  /** Indices into the `prices` array given, in order. Empty when the link is a page. */
  carried: number[];
}

/**
 * The best link one book can give for a set of selections it prices — the entry point the
 * best-effort ticket link uses, where "best effort" means: as much of the ticket as this book's own
 * URL scheme can carry, and never a claim beyond it.
 *
 * The slip with every selection where the platform takes several (Superbet, KTO, Sportingbet); the
 * event or market page where it takes one (Betfair Exchange, Betnacional), which is still the right
 * page with the runners on screen; null where the platform exposes no URL at all (the five Altenar
 * tenants) or the first row lacks the ids.
 *
 * `carried` is the whole point of the return shape. A whole-ticket slip needs EVERY row to carry
 * the platform's ids (`SelectionRef` is optional by design: rows stored before deep links existed
 * have none), and one row without them drops the link to the single-selection fallback — the same
 * book, the same coverage, a URL with ONE bet in it. The caller must be able to tell those apart
 * without re-deriving the rule, because the difference is a reader clicking "o bilhete inteiro" and
 * landing on a single. It is deliberately NOT the number of legs the book prices: the caller counts
 * coverage itself and the two numbers are shown to the reader separately, so "3 das 4 linhas" and
 * "página do jogo" can both be true of the same link.
 */
export function linkForSelections(prices: BookPrice[], opts: DeepLinkOptions = {}): SelectionsLink | null {
  if (!prices.length) return null;
  const [first] = prices;
  if (prices.some((p) => p.book !== first.book || p.platform !== first.platform)) return null;
  const whole = ticketDeepLinkFor(prices, opts);
  if (whole && whole.selections === prices.length) return { link: whole, carried: prices.map((_, i) => i) };
  // Either the whole-slip attempt failed, or it came back as a page (a one-row ticket at a book
  // whose scheme carries nothing). Both land on the same fallback, and the fallback is built from
  // `prices[0]`, so the one selection it can pre-fill is the first — never a later one.
  const link = whole ?? deepLinkFor(first, opts);
  if (!link) return null;
  return { link, carried: link.selections > 0 ? [0] : [] };
}
