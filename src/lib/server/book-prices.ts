import { getDb, newId, nowIso } from "@/lib/server/db";
import { logEvent, reportError } from "@/lib/server/ops-log";
import { adaptersFor, booksConfig, findAdapter, ALL_ADAPTERS } from "@/lib/sources/br-books/registry";
import { isAbortError } from "@/lib/sources/br-books/http";
import { matchEvent, type EventMatch, type MatchableGame } from "@/lib/sources/br-books/match";
import { teamKey } from "@/lib/sources/br-books/normalise";
import { BookWallError, RobotsDisallowedError, type BookAdapter, type BookEvent, type BookPrice, type BookSport, type SelectionRef } from "@/lib/sources/br-books/types";
import { espnDateKey, getSlate, shiftKey } from "@/lib/sources/espn";
import { SOLD_SPORTS } from "@/lib/sports";
import type { Game } from "@/lib/types";

/**
 * Where the books' prices live and the job that fills them.
 *
 * The tables are additive and every statement is idempotent: production SQLite is live and the
 * schema below is created lazily the first time this module is used, never by a destructive step.
 * `book_prices` keeps history — a row is appended only when a price changes, so opening (first row),
 * current (`current = 1`) and closing (the last row before kickoff) can be compared later — and
 * `book_events` remembers how each book's fixture was tied to an ESPN game, including the ones
 * the matcher could not tie, which the admin panel lists.
 */
type Db = ReturnType<typeof getDb>;
let ready = false;

export function ensureBooksSchema(d: Db = getDb()): void {
  if (ready) return;
  d.exec(`
    CREATE TABLE IF NOT EXISTS book_events (
      key TEXT PRIMARY KEY,                         -- <platform>:<book>:<platform event id>
      book TEXT NOT NULL,
      platform TEXT NOT NULL,
      sport TEXT NOT NULL,                          -- basketball | soccer
      sportKey TEXT,
      home TEXT NOT NULL,
      away TEXT NOT NULL,
      startsAt TEXT NOT NULL,
      league TEXT,
      externalIds TEXT NOT NULL DEFAULT '{}',
      gameId TEXT,                                  -- ESPN event id once matched
      matchedBy TEXT,                               -- external | names | manual
      swapped INTEGER NOT NULL DEFAULT 0,           -- the book lists ESPN's home side as away
      url TEXT,
      firstSeenAt TEXT NOT NULL,
      lastSeenAt TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_book_events_game ON book_events(gameId);
    CREATE INDEX IF NOT EXISTS idx_book_events_starts ON book_events(startsAt);

    CREATE TABLE IF NOT EXISTS book_prices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      eventKey TEXT NOT NULL REFERENCES book_events(key) ON DELETE CASCADE,
      book TEXT NOT NULL,
      platform TEXT NOT NULL,
      market TEXT NOT NULL,                         -- moneyline | spread | total | player_prop
      player TEXT,
      stat TEXT,
      line REAL,
      side TEXT,
      kind TEXT,
      decimal REAL NOT NULL,
      lay REAL,
      url TEXT,
      fetchedAt TEXT NOT NULL,                      -- when this price was first seen
      seenAt TEXT NOT NULL,                         -- when it was last confirmed
      current INTEGER NOT NULL DEFAULT 1            -- 1 = the book still posts this price
    );
    CREATE INDEX IF NOT EXISTS idx_book_prices_event ON book_prices(eventKey, current);
    -- The key includes the kind: an over/under pair and an "N+" rung at the same line are two prices.
    DROP INDEX IF EXISTS idx_book_prices_key;
    CREATE INDEX IF NOT EXISTS idx_book_prices_key2 ON book_prices(eventKey, book, market, player, stat, line, side, kind);
    -- The admin header counts current rows; a partial index keeps that off the history.
    CREATE INDEX IF NOT EXISTS idx_book_prices_current ON book_prices(market) WHERE current = 1;

    CREATE TABLE IF NOT EXISTS book_adapter_status (
      id TEXT PRIMARY KEY,
      book TEXT NOT NULL,
      platform TEXT NOT NULL,
      enabled INTEGER,                              -- NULL = follow BR_BOOKS
      lastRunAt TEXT,
      lastOkAt TEXT,
      lastStatus TEXT NOT NULL DEFAULT 'idle',      -- idle | ok | empty | error | wall | timeout | robots | off
      lastMs INTEGER NOT NULL DEFAULT 0,
      lastRows INTEGER NOT NULL DEFAULT 0,
      lastEvents INTEGER NOT NULL DEFAULT 0,
      lastMatched INTEGER NOT NULL DEFAULT 0,
      lastError TEXT NOT NULL DEFAULT ''
    );

    -- A book's spelling of a team the matcher did not recognise, fixed by hand once.
    CREATE TABLE IF NOT EXISTS book_team_aliases (
      sportKey TEXT NOT NULL,
      alias TEXT NOT NULL,                          -- normalised (teamKey)
      teamName TEXT NOT NULL,                       -- ESPN displayName
      createdAt TEXT NOT NULL,
      PRIMARY KEY (sportKey, alias)
    );
  `);
  // Additive, idempotent: the platform's own ids of a selection (deeplinks.ts), as JSON. A row
  // stored before the column existed keeps NULL until the next read confirms its price.
  const columns = (d.prepare("PRAGMA table_info(book_prices)").all() as { name: string }[]).map((c) => c.name);
  if (!columns.includes("ref")) d.exec("ALTER TABLE book_prices ADD COLUMN ref TEXT");
  ready = true;
}

const db = (): Db => { const d = getDb(); ensureBooksSchema(d); return d; };

export interface AdapterStatusRow {
  id: string; book: string; platform: string; enabled: number | null; lastRunAt: string | null; lastOkAt: string | null;
  lastStatus: string; lastMs: number; lastRows: number; lastEvents: number; lastMatched: number; lastError: string;
}

/** The env list with the admin's per-book switch on top. */
export function activeAdapters(env: Record<string, string | undefined> = process.env): BookAdapter[] {
  const overrides = new Map((db().prepare("SELECT id, enabled FROM book_adapter_status WHERE enabled IS NOT NULL").all() as { id: string; enabled: number }[]).map((r) => [r.id, r.enabled === 1]));
  const fromEnv = new Set(adaptersFor(env).map((a) => a.id));
  return ALL_ADAPTERS.filter((a) => (overrides.has(a.id) ? overrides.get(a.id) : fromEnv.has(a.id)));
}

export function setAdapterEnabled(id: string, enabled: boolean | null): boolean {
  const adapter = findAdapter(id);
  if (!adapter) return false;
  db().prepare("INSERT INTO book_adapter_status (id, book, platform, enabled) VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET enabled = excluded.enabled")
    .run(id, adapter.book, adapter.platform, enabled === null ? null : enabled ? 1 : 0);
  return true;
}

export function listAdapterStatus(env: Record<string, string | undefined> = process.env): (AdapterStatusRow & { active: boolean; coverage: string; sports: string[] })[] {
  const rows = new Map((db().prepare("SELECT * FROM book_adapter_status").all() as AdapterStatusRow[]).map((r) => [r.id, r]));
  const active = new Set(activeAdapters(env).map((a) => a.id));
  return ALL_ADAPTERS.map((a) => ({
    id: a.id, book: a.book, platform: a.platform, enabled: null, lastRunAt: null, lastOkAt: null, lastStatus: "idle", lastMs: 0, lastRows: 0, lastEvents: 0, lastMatched: 0, lastError: "",
    ...(rows.get(a.id) ?? {}),
    active: active.has(a.id), coverage: a.coverage, sports: a.sports,
  }));
}

function recordStatus(adapter: BookAdapter, patch: Partial<AdapterStatusRow>): void {
  db().prepare(`INSERT INTO book_adapter_status (id, book, platform, lastRunAt, lastOkAt, lastStatus, lastMs, lastRows, lastEvents, lastMatched, lastError)
    VALUES (@id, @book, @platform, @lastRunAt, @lastOkAt, @lastStatus, @lastMs, @lastRows, @lastEvents, @lastMatched, @lastError)
    ON CONFLICT(id) DO UPDATE SET lastRunAt = excluded.lastRunAt, lastOkAt = COALESCE(excluded.lastOkAt, book_adapter_status.lastOkAt), lastStatus = excluded.lastStatus,
      lastMs = excluded.lastMs, lastRows = excluded.lastRows, lastEvents = excluded.lastEvents, lastMatched = excluded.lastMatched, lastError = excluded.lastError`)
    .run({ id: adapter.id, book: adapter.book, platform: adapter.platform, lastRunAt: nowIso(), lastOkAt: null, lastStatus: "idle", lastMs: 0, lastRows: 0, lastEvents: 0, lastMatched: 0, lastError: "", ...patch });
}

// ---- matching ---------------------------------------------------------------------------------------

/** External ids of every fixture already tied to a game: the join other books inherit. */
function knownExternalIds(): Map<string, string> {
  const out = new Map<string, string>();
  const rows = db().prepare("SELECT externalIds, gameId FROM book_events WHERE gameId IS NOT NULL AND startsAt > ?").all(new Date(Date.now() - 2 * 86_400_000).toISOString()) as { externalIds: string; gameId: string }[];
  for (const r of rows) {
    let ids: Record<string, string> = {};
    try { ids = JSON.parse(r.externalIds); } catch { ids = {}; }
    for (const [k, v] of Object.entries(ids)) if (k !== "superbet" && k !== "altenar" && k !== "kambi" && k !== "sportingbet" && k !== "betnacional" && k !== "betfair") out.set(`${k}:${v}`, r.gameId);
  }
  return out;
}

function aliasMap(sportKey: string): Map<string, string> {
  return new Map((db().prepare("SELECT alias, teamName FROM book_team_aliases WHERE sportKey = ?").all(sportKey) as { alias: string; teamName: string }[]).map((r) => [r.alias, r.teamName]));
}

export function addTeamAlias(sportKey: string, alias: string, teamName: string): void {
  db().prepare("INSERT INTO book_team_aliases (sportKey, alias, teamName, createdAt) VALUES (?,?,?,?) ON CONFLICT(sportKey, alias) DO UPDATE SET teamName = excluded.teamName")
    .run(sportKey, teamKey(alias), teamName, nowIso());
}

/** Ties one book event to a game by hand; the external ids it carries then match every other book. */
export function assignEventGame(eventKey: string, gameId: string | null, swapped = false): boolean {
  const res = db().prepare("UPDATE book_events SET gameId = ?, matchedBy = ?, swapped = ? WHERE key = ?").run(gameId, gameId ? "manual" : null, swapped ? 1 : 0, eventKey);
  return res.changes > 0;
}

const toMatchable = (g: Game): MatchableGame => ({ id: g.id, startsAt: g.startsAt, home: g.home, away: g.away });

// ---- persistence --------------------------------------------------------------------------------------

interface PriceKeyRow { id: number; decimal: number; lay: number | null }

/**
 * Writes one adapter's rows for one sport. Events are upserted and matched; a price row is appended
 * only when the number moved; a line the book no longer posts loses its `current` flag.
 */
export function persistPrices(prices: BookPrice[], sportKey: string, games: Game[], now = new Date()): { events: number; matched: number; rows: number; changed: number } {
  const d = db();
  const at = now.toISOString();
  const matchable = games.map(toMatchable);
  const known = knownExternalIds();
  const aliases = aliasMap(sportKey);
  const withAliases = (e: BookEvent): BookEvent => ({ ...e, home: aliases.get(teamKey(e.home)) ?? e.home, away: aliases.get(teamKey(e.away)) ?? e.away });

  const upsertEvent = d.prepare(`INSERT INTO book_events (key, book, platform, sport, sportKey, home, away, startsAt, league, externalIds, gameId, matchedBy, swapped, url, firstSeenAt, lastSeenAt)
    VALUES (@key, @book, @platform, @sport, @sportKey, @home, @away, @startsAt, @league, @externalIds, @gameId, @matchedBy, @swapped, @url, @at, @at)
    ON CONFLICT(key) DO UPDATE SET lastSeenAt = excluded.lastSeenAt, startsAt = excluded.startsAt, externalIds = excluded.externalIds, url = COALESCE(excluded.url, book_events.url),
      gameId = CASE WHEN book_events.matchedBy = 'manual' THEN book_events.gameId ELSE COALESCE(excluded.gameId, book_events.gameId) END,
      matchedBy = CASE WHEN book_events.matchedBy = 'manual' THEN book_events.matchedBy ELSE COALESCE(excluded.matchedBy, book_events.matchedBy) END,
      swapped = CASE WHEN book_events.matchedBy = 'manual' OR excluded.gameId IS NULL THEN book_events.swapped ELSE excluded.swapped END`);
  const findCurrent = d.prepare(`SELECT id, decimal, lay FROM book_prices WHERE eventKey = ? AND book = ? AND market = ? AND COALESCE(player,'') = ? AND COALESCE(stat,'') = ? AND COALESCE(line, 0) = ? AND COALESCE(side,'') = ? AND COALESCE(kind,'') = ? AND current = 1`);
  // An unchanged price is only touched — and, if it was stored before the ids existed, given them.
  const touch = d.prepare("UPDATE book_prices SET seenAt = ?, ref = COALESCE(?, ref) WHERE id = ?");
  const retire = d.prepare("UPDATE book_prices SET current = 0 WHERE id = ?");
  const insert = d.prepare(`INSERT INTO book_prices (eventKey, book, platform, market, player, stat, line, side, kind, decimal, lay, url, ref, fetchedAt, seenAt, current)
    VALUES (@eventKey, @book, @platform, @market, @player, @stat, @line, @side, @kind, @decimal, @lay, @url, @ref, @at, @at, 1)`);
  const retireStale = d.prepare("UPDATE book_prices SET current = 0 WHERE eventKey = ? AND book = ? AND current = 1 AND seenAt < ?");

  let events = 0, matched = 0, rows = 0, changed = 0;
  const seenEvents = new Map<string, { book: string }>();
  d.transaction(() => {
    for (const p of prices) {
      if (!seenEvents.has(p.event.key)) {
        const ev = withAliases(p.event);
        const m: EventMatch | null = matchEvent(ev, matchable, known);
        if (m) { matched += 1; for (const [k, v] of Object.entries(ev.externalIds)) known.set(`${k}:${v}`, m.gameId); }
        upsertEvent.run({ key: ev.key, book: p.book, platform: p.platform, sport: ev.sport, sportKey, home: ev.home, away: ev.away, startsAt: ev.startsAt, league: ev.league ?? null, externalIds: JSON.stringify(ev.externalIds), gameId: m?.gameId ?? null, matchedBy: m?.matchedBy ?? null, swapped: m?.swapped ? 1 : 0, url: ev.url ?? null, at });
        seenEvents.set(p.event.key, { book: p.book });
        events += 1;
      }
      const cur = findCurrent.get(p.event.key, p.book, p.market, p.player ?? "", p.stat ?? "", p.line ?? 0, p.side ?? "", p.kind ?? "") as PriceKeyRow | undefined;
      rows += 1;
      const ref = p.ref ? JSON.stringify(p.ref) : null;
      if (cur && Math.abs(cur.decimal - p.decimal) < 0.0005 && (cur.lay ?? null) === (p.lay ?? null)) { touch.run(at, ref, cur.id); continue; }
      if (cur) retire.run(cur.id);
      insert.run({ eventKey: p.event.key, book: p.book, platform: p.platform, market: p.market, player: p.player ?? null, stat: p.stat ?? null, line: p.line ?? null, side: p.side ?? null, kind: p.kind ?? null, decimal: p.decimal, lay: p.lay ?? null, url: p.url ?? null, ref, at });
      changed += 1;
    }
    for (const [key, { book }] of seenEvents) retireStale.run(key, book, at);
  }).immediate();
  return { events, matched, rows, changed };
}

// ---- reading ----------------------------------------------------------------------------------------

interface EventRow { key: string; book: string; platform: string; sport: BookSport; sportKey: string | null; home: string; away: string; startsAt: string; league: string | null; externalIds: string; gameId: string | null; matchedBy: string | null; swapped: number; url: string | null; firstSeenAt: string; lastSeenAt: string }
interface PriceRow { id: number; eventKey: string; book: string; platform: string; market: BookPrice["market"]; player: string | null; stat: string | null; line: number | null; side: BookPrice["side"] | null; kind: BookPrice["kind"] | null; decimal: number; lay: number | null; url: string | null; ref?: string | null; fetchedAt: string; seenAt: string; current: number }

function parseRef(raw: string | null | undefined): SelectionRef | undefined {
  if (!raw) return undefined;
  try {
    const v = JSON.parse(raw) as Record<string, unknown>;
    if (!v || typeof v !== "object") return undefined;
    const out: SelectionRef = {};
    for (const k of ["eventId", "marketId", "outcomeId", "uuid", "specialBetValue", "handicap"] as const) if (typeof v[k] === "string" && v[k]) out[k] = v[k] as string;
    return Object.keys(out).length ? out : undefined;
  } catch {
    return undefined;
  }
}

const flip = (side: BookPrice["side"] | null): BookPrice["side"] | undefined => (side === "home" ? "away" : side === "away" ? "home" : side ?? undefined);

function toPrice(r: PriceRow, ev: EventRow): BookPrice {
  const event: BookEvent = { key: ev.key, home: ev.home, away: ev.away, startsAt: ev.startsAt, externalIds: JSON.parse(ev.externalIds || "{}"), league: ev.league ?? undefined, sport: ev.sport, url: ev.url ?? undefined };
  return {
    book: r.book, platform: r.platform, sport: ev.sport, event, market: r.market,
    player: r.player ?? undefined, stat: r.stat ?? undefined, line: r.line ?? undefined,
    // A book that lists ESPN's home side as away has its sides flipped here, once, at read time.
    side: ev.swapped ? flip(r.side) : r.side ?? undefined,
    decimal: r.decimal, lay: r.lay ?? undefined, kind: r.kind ?? undefined, fetchedAt: r.fetchedAt, url: r.url ?? undefined,
    ref: parseRef(r.ref),
  };
}

/**
 * Every current price the books post on one ESPN game, sides already in ESPN's home/away frame.
 * A game that has kicked off has no current price: the books' pre-game numbers are references at
 * best, and nothing here is read in play.
 */
export function pricesForGame(gameId: string, now = new Date()): BookPrice[] {
  const d = db();
  const events = d.prepare("SELECT * FROM book_events WHERE gameId = ? AND startsAt > ?").all(gameId, now.toISOString()) as EventRow[];
  if (!events.length) return [];
  const rows = d.prepare(`SELECT * FROM book_prices WHERE current = 1 AND eventKey IN (${events.map(() => "?").join(",")})`).all(...events.map((e) => e.key)) as PriceRow[];
  const byKey = new Map(events.map((e) => [e.key, e]));
  return rows.map((r) => toPrice(r, byKey.get(r.eventKey)!));
}

/** Which books priced a game and when they were last read. */
export function booksForGame(gameId: string, now = new Date()): { books: string[]; fetchedAt: string | null } {
  const rows = db().prepare(`SELECT p.book, MAX(p.seenAt) AS seenAt FROM book_prices p JOIN book_events e ON e.key = p.eventKey WHERE e.gameId = ? AND e.startsAt > ? AND p.current = 1 GROUP BY p.book`).all(gameId, now.toISOString()) as { book: string; seenAt: string }[];
  return { books: rows.map((r) => r.book).sort(), fetchedAt: rows.length ? rows.map((r) => r.seenAt).sort().pop()! : null };
}

/** The price trail of one selection at one book: opening first, current last. */
export function priceHistory(eventKey: string, q: { book: string; market: string; player?: string; stat?: string; line?: number; side?: string; kind?: string }): { decimal: number; lay: number | null; fetchedAt: string; seenAt: string; current: boolean }[] {
  return (db().prepare(`SELECT decimal, lay, fetchedAt, seenAt, current FROM book_prices WHERE eventKey = ? AND book = ? AND market = ? AND COALESCE(player,'') = ? AND COALESCE(stat,'') = ? AND COALESCE(line,0) = ? AND COALESCE(side,'') = ? AND (? = '' OR COALESCE(kind,'') = ?) ORDER BY fetchedAt`)
    .all(eventKey, q.book, q.market, q.player ?? "", q.stat ?? "", q.line ?? 0, q.side ?? "", q.kind ?? "", q.kind ?? "") as { decimal: number; lay: number | null; fetchedAt: string; seenAt: string; current: number }[])
    .map((r) => ({ ...r, current: r.current === 1 }));
}

export interface UnmatchedEvent { key: string; book: string; platform: string; sportKey: string | null; home: string; away: string; startsAt: string; league: string | null; externalIds: Record<string, string>; lastSeenAt: string; prices: number }

/** Book fixtures the matcher could not tie to a game, newest kickoff first — the admin's to-do list. */
export function listUnmatchedEvents(limit = 60): UnmatchedEvent[] {
  return (db().prepare(`SELECT e.*, (SELECT COUNT(*) FROM book_prices p WHERE p.eventKey = e.key AND p.current = 1) AS prices
    FROM book_events e WHERE e.gameId IS NULL AND e.startsAt > ? ORDER BY e.startsAt ASC LIMIT ?`).all(new Date(Date.now() - 6 * 3_600_000).toISOString(), limit) as (EventRow & { prices: number })[])
    .map((e) => ({ key: e.key, book: e.book, platform: e.platform, sportKey: e.sportKey, home: e.home, away: e.away, startsAt: e.startsAt, league: e.league, externalIds: JSON.parse(e.externalIds || "{}"), lastSeenAt: e.lastSeenAt, prices: e.prices }));
}

export interface MatchedEventSummary { gameId: string; sportKey: string | null; startsAt: string; books: string[]; prices: number; props: number }

/** Matched games with how many books and prop rows they carry: the admin's coverage table. */
export function listCoverage(limit = 40): MatchedEventSummary[] {
  return (db().prepare(`SELECT e.gameId, e.sportKey, MIN(e.startsAt) AS startsAt, GROUP_CONCAT(DISTINCT e.book) AS books,
      (SELECT COUNT(*) FROM book_prices p JOIN book_events x ON x.key = p.eventKey WHERE x.gameId = e.gameId AND p.current = 1) AS prices,
      (SELECT COUNT(*) FROM book_prices p JOIN book_events x ON x.key = p.eventKey WHERE x.gameId = e.gameId AND p.current = 1 AND p.market = 'player_prop') AS props
    FROM book_events e WHERE e.gameId IS NOT NULL AND e.startsAt > ? GROUP BY e.gameId ORDER BY startsAt ASC LIMIT ?`).all(new Date(Date.now() - 6 * 3_600_000).toISOString(), limit) as { gameId: string; sportKey: string | null; startsAt: string; books: string; prices: number; props: number }[])
    .map((r) => ({ ...r, books: r.books.split(",").sort() }));
}

/** Totals for the admin header. Counts run over the partial index of current rows, not the history. */
export function booksStats(): { events: number; matched: number; unmatched: number; prices: number; props: number; lastSeenAt: string | null } {
  const d = db();
  const since = new Date(Date.now() - 6 * 3_600_000).toISOString();
  const ev = d.prepare("SELECT COUNT(*) n, SUM(gameId IS NOT NULL) m FROM book_events WHERE startsAt > ?").get(since) as { n: number; m: number | null };
  const pr = d.prepare("SELECT COUNT(*) n FROM book_prices WHERE current = 1").get() as { n: number };
  const props = d.prepare("SELECT COUNT(*) n FROM book_prices WHERE current = 1 AND market = 'player_prop'").get() as { n: number };
  const last = d.prepare("SELECT MAX(lastSeenAt) t FROM book_events").get() as { t: string | null };
  return { events: ev.n, matched: ev.m ?? 0, unmatched: ev.n - (ev.m ?? 0), prices: pr.n, props: props.n, lastSeenAt: last.t };
}

/**
 * What the store lets go of, every tick. Kick-off retires a game's prices — from then on nothing is
 * "current" — and the rows of games older than the retention window are deleted with their events
 * (the history of a decided game is only worth keeping for the closing-line study, and two weeks
 * cover that). A fixture no book has posted for a day is gone with it: it was either a league the
 * adapter stopped selecting or a fixture the book pulled, and either way it was noise in the
 * unmatched list. ~40 MB a day of WNBA rows is what this bounds.
 */
export function cleanupBooks(now = new Date(), retentionDays = 14, unseenHours = 24): { retired: number; events: number; prices: number } {
  const d = db();
  const at = now.toISOString();
  const cutoff = new Date(now.getTime() - retentionDays * 86_400_000).toISOString();
  const unseen = new Date(now.getTime() - unseenHours * 3_600_000).toISOString();
  return d.transaction(() => {
    const retired = d.prepare("UPDATE book_prices SET current = 0 WHERE current = 1 AND eventKey IN (SELECT key FROM book_events WHERE startsAt <= ?)").run(at).changes;
    const doomed = d.prepare("SELECT key FROM book_events WHERE startsAt < ? OR (gameId IS NULL AND lastSeenAt < ?)").all(cutoff, unseen) as { key: string }[];
    let prices = 0;
    const delPrices = d.prepare("DELETE FROM book_prices WHERE eventKey = ?");
    const delEvent = d.prepare("DELETE FROM book_events WHERE key = ?");
    for (const { key } of doomed) { prices += delPrices.run(key).changes; delEvent.run(key); }
    return { retired, events: doomed.length, prices };
  }).immediate();
}

// ---- the job ----------------------------------------------------------------------------------------

export interface BooksJobAdapterResult { id: string; book: string; status: "ok" | "empty" | "error" | "wall" | "timeout" | "robots" | "budget" | "off"; rows: number; events: number; matched: number; ms: number; error?: string }
export interface BooksJobResult { runId: string; status: "ok" | "error" | "skipped"; adapters: BooksJobAdapterResult[]; rows: number; events: number; matched: number; games: number; ms: number; note: string; cleanup?: { retired: number; events: number; prices: number } }

class AdapterTimeout extends Error {
  constructor(ms: number) { super(`timed out after ${ms} ms`); this.name = "AdapterTimeout"; }
}

/**
 * Runs one adapter call against a deadline. The deadline fires the AbortSignal the adapter passed
 * to every request, so a slow book stops asking (and stops holding its host's politeness slot) the
 * moment the job gives up on it — a race that merely stops listening would leave it running.
 */
async function withDeadline<T>(run: (signal: AbortSignal) => Promise<T>, ms: number): Promise<T> {
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new AdapterTimeout(ms)); }, ms); });
  try {
    return await Promise.race([run(controller.signal), deadline]);
  } finally {
    clearTimeout(timer);
  }
}

/** Upcoming games per sport inside the horizon, from the cached ESPN scoreboards (today, tomorrow, the day after). */
export async function upcomingGames(sportKeys: string[], now: Date, horizonHours: number, slate: (dateKey: string, sportKey: string) => Promise<Game[]> = (k, s) => getSlate(k, false, s)): Promise<Map<string, Game[]>> {
  const out = new Map<string, Game[]>();
  const lo = now.getTime(), hi = lo + horizonHours * 3_600_000;
  // One scoreboard per ESPN day the horizon touches (two days for the default 48 h), at most two weeks.
  const span = Math.min(14, Math.ceil(horizonHours / 24) + 1);
  const days = Array.from({ length: span }, (_, i) => shiftKey(espnDateKey(now), i));
  for (const sportKey of sportKeys) {
    const games: Game[] = [];
    for (const day of days) {
      const list = await slate(day, sportKey).catch(() => [] as Game[]);
      for (const g of list) {
        const t = Date.parse(g.startsAt);
        if (g.status === "scheduled" && t >= lo && t <= hi && !games.some((x) => x.id === g.id)) games.push(g);
      }
    }
    if (games.length) out.set(sportKey, games);
  }
  return out;
}

/**
 * The `?job=books` tick. For every enabled adapter and every sport with a game in the next 48 h,
 * fetch, match, persist. One adapter can neither block the others (per-adapter timeout) nor break
 * the run (per-adapter catch, logged to the ops log). In-play events are left to a later round.
 */
export async function runBooksJob(opts: { now?: Date; sports?: string[]; adapters?: BookAdapter[]; env?: Record<string, string | undefined>; slate?: (dateKey: string, sportKey: string) => Promise<Game[]> } = {}): Promise<BooksJobResult> {
  const now = opts.now ?? new Date();
  const env = opts.env ?? process.env;
  const cfg = booksConfig(env);
  const runId = newId("books");
  const started = Date.now();
  const adapters = opts.adapters ?? activeAdapters(env);
  const sportKeys = (opts.sports?.length ? opts.sports : SOLD_SPORTS.map((s) => s.key)).filter((k) => SOLD_SPORTS.some((s) => s.key === k));
  const results: BooksJobAdapterResult[] = [];
  if (!adapters.length) {
    const note = "no book adapter enabled (BR_BOOKS)";
    logEvent("job.books", { runId, status: "skipped", note });
    return { runId, status: "skipped", adapters: [], rows: 0, events: 0, matched: 0, games: 0, ms: Date.now() - started, note };
  }
  const games = await upcomingGames(sportKeys, now, cfg.horizonHours, opts.slate);
  const gameCount = [...games.values()].reduce((n, g) => n + g.length, 0);
  const from = new Date(now.getTime() - 60 * 60_000).toISOString();
  const to = new Date(now.getTime() + cfg.horizonHours * 3_600_000).toISOString();
  // A host that answered with a wall once this run is not asked again by the adapters sharing it
  // (the five Altenar tenants are one host); a second wall in one tick is just another request.
  const walled = new Set<string>();

  for (const adapter of adapters) {
    const t0 = Date.now();
    const r: BooksJobAdapterResult = { id: adapter.id, book: adapter.book, status: "empty", rows: 0, events: 0, matched: 0, ms: 0 };
    const wallHit = (adapter.hosts ?? []).find((h) => walled.has(h));
    if (wallHit) {
      r.status = "wall"; r.error = `${wallHit} answered with a wall earlier this run`;
    } else if (Date.now() - started > cfg.jobBudgetMs) {
      // The tick is sequential and shared with every other job: past the budget the rest wait for the next one.
      r.status = "budget"; r.error = `job budget of ${cfg.jobBudgetMs} ms spent before this adapter's turn`;
    } else {
      try {
        // The whole adapter — every sport it lists — shares one deadline, so the run never exceeds
        // adapters × timeout however many leagues have games.
        await withDeadline(async (signal) => {
          for (const [sportKey, list] of games) {
            if (!adapter.sports.includes(sportKey)) continue;
            const prices = await adapter.fetchBookOdds({ sportKey, from, to, signal });
            // Rows on events that have already started are dropped here: in-play prices are a later round.
            const pre = prices.filter((p) => Date.parse(p.event.startsAt) > now.getTime());
            const saved = persistPrices(pre, sportKey, list, now);
            r.rows += saved.rows; r.events += saved.events; r.matched += saved.matched;
          }
        }, cfg.adapterTimeoutMs);
        r.status = r.rows ? "ok" : "empty";
      } catch (error) {
        if (error instanceof BookWallError) { r.status = "wall"; walled.add(error.host); }
        else if (error instanceof RobotsDisallowedError) r.status = "robots";
        else if (error instanceof AdapterTimeout || isAbortError(error)) r.status = "timeout";
        else r.status = "error";
        r.error = reportError(`job.books.${adapter.id}`, error, { adapter: adapter.id }, r.status === "wall" || r.status === "robots" ? "warn" : "error");
      }
    }
    r.ms = Date.now() - t0;
    recordStatus(adapter, { lastStatus: r.status, lastMs: r.ms, lastRows: r.rows, lastEvents: r.events, lastMatched: r.matched, lastError: r.error ?? "", lastOkAt: r.status === "ok" ? nowIso() : null });
    results.push(r);
  }

  const cleanup = cleanupBooks(now, cfg.retentionDays);
  const rows = results.reduce((n, r) => n + r.rows, 0);
  const events = results.reduce((n, r) => n + r.events, 0);
  const matched = results.reduce((n, r) => n + r.matched, 0);
  const failed = results.filter((r) => r.status === "error" || r.status === "timeout").length;
  const status: BooksJobResult["status"] = failed > 0 && rows === 0 ? "error" : "ok";
  const note = results.map((r) => `${r.id}:${r.status}${r.rows ? ` ${r.rows}` : ""}`).join(" | ");
  const ms = Date.now() - started;
  logEvent("job.books", { runId, status, games: gameCount, rows, events, matched, failed, ms, cleanup });
  return { runId, status, adapters: results, rows, events, matched, games: gameCount, ms, note, cleanup };
}
