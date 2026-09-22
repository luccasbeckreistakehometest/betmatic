/**
 * Brazilian licensed sportsbooks, read through the public JSON their own web frontends call.
 *
 * Every adapter turns one platform's payloads into the same `BookPrice` rows, so the comparison
 * layer (compare.ts), the store (server/book-prices.ts) and the model's consensus slot never know
 * which book a number came from until they print it. Ground rules, decided before the first line
 * of code and not negotiable in a follow-up: plain HTTPS with an honest User-Agent, one request per
 * second per host, no header forgery, no stealth, no challenge solving. A book that answers a plain
 * client with a wall is skipped and listed as skipped (see registry.ts).
 */

/** The repo's own sport groups a book can price. Tennis is listed on the slate but never priced. */
export type BookSport = "basketball" | "soccer";

export type BookMarket = "moneyline" | "spread" | "total" | "player_prop";

/** One side of a two-way (or three-way) market. Player props are always over/under. */
export type BookSide = "home" | "away" | "draw" | "over" | "under";

export interface BookEvent {
  /** Stable within the platform: `<platform>:<book>:<platform event id>`. */
  key: string;
  home: string;
  away: string;
  /** ISO kickoff. */
  startsAt: string;
  /** Feed ids other books also carry (betradar, sportradar, the platform's own id). */
  externalIds: Record<string, string>;
  league?: string;
  sport: BookSport;
  url?: string;
}

export interface BookPrice {
  /** Display name: "Superbet", "KTO", "EstrelaBet", "Betfair Exchange". Shown to users. */
  book: string;
  /** Adapter family: "superbet", "kambi", "altenar", "betfair-exchange", "sportingbet", "betnacional". */
  platform: string;
  sport: BookSport;
  event: BookEvent;
  market: BookMarket;
  /** Player props only, "First Last" order. */
  player?: string;
  /** Player props only: MarketDef.key in the repo's vocabulary (points, rebounds, pra, shots…). */
  stat?: string;
  /** Spread: the handicap applied to `side` (home −7.5 / away +7.5). Total and props: the line. */
  line?: number;
  side?: BookSide;
  /** Decimal price. On an exchange this is the best price available to back. */
  decimal: number;
  /** Exchange only: best price available to lay, when there is one. */
  lay?: number;
  /** "milestone" = an "N+" rung priced as over N−0.5; "total" = a posted over/under pair. */
  kind?: "total" | "milestone";
  fetchedAt: string;
  url?: string;
}

export interface FetchArgs {
  /** Repo sport key (nba, wnba, soccer-bra, …). */
  sportKey: string;
  /** ISO window; adapters return only events that start inside it. */
  from: string;
  to: string;
}

export interface BookAdapter {
  /** Registry id, also the BR_BOOKS token: "superbet", "kambi:kto", "altenar:estrelabet". */
  id: string;
  book: string;
  platform: string;
  /** Sport keys the adapter knows how to list. */
  sports: string[];
  /** Human note for the admin panel (what the platform exposes to a plain client). */
  coverage: string;
  fetchBookOdds(args: FetchArgs): Promise<BookPrice[]>;
}

/** A book refused the plain client (challenge page, 403, 429): the caller records it and moves on. */
export class BookWallError extends Error {
  constructor(public host: string, public status: number, message = `${host} answered ${status} to a plain client`) {
    super(message);
    this.name = "BookWallError";
  }
}

/** The host's robots.txt disallows the path: the caller must not fetch it. */
export class RobotsDisallowedError extends Error {
  constructor(public url: string) {
    super(`robots.txt disallows ${url}`);
    this.name = "RobotsDisallowedError";
  }
}
