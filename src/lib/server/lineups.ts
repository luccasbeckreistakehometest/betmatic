import { cached } from "@/lib/cache";
import { getDb, newId, nowIso } from "@/lib/server/db";
import { pendingEntries } from "@/lib/ledger/store";
import { diffLineup, lineupAlertText, lineupNoticeText, lineupSnapshot, type LegAlert, type WatchedLeg } from "@/lib/live/lineup";
import { getGameDetail } from "@/lib/sources/espn";
import { espnJson } from "@/lib/sources/espn-http";
import { deliver, followersOf } from "@/lib/server/telegram";
import { findById, toPublic } from "@/lib/server/users";
import { visibleSuggestionIds } from "@/lib/server/entitlement";
import { logEvent, reportError } from "@/lib/server/ops-log";
import { baseUrlOrEmpty } from "@/lib/base-url";
import { normaliseLang } from "@/lib/i18n";
import { normaliseName } from "@/lib/resolve/names";
import { getSport, SPORTS } from "@/lib/sports";
import type { Settlement } from "@/lib/types";

/**
 * Vigia de escalação. Every tick: pending tickets (generated, custom or scanned) whose game starts in
 * the next 100 minutes or began less than 20 minutes ago are checked against the published lineup and
 * the injury report. A leg that lost its player gets one leg_alerts row; the people who saved that
 * ticket or follow the teams hear once (never while paused). ESPN only, capped per tick.
 */
const WINDOW_AHEAD_MS = 100 * 60_000;
const WINDOW_BEHIND_MS = 20 * 60_000;

interface GameWatch { gameId: string; sportKey: string; legs: WatchedLeg[]; savers: Map<string, Set<string>>; selections: Map<string, string> }

export interface LineupResult { runId: string; games: number; alerts: number; notified: number; note: string }

function collect(now: number): Map<string, GameWatch> {
  const games = new Map<string, GameWatch>();
  const inWindow = (startsAt: string | null | undefined) => {
    const t = startsAt ? Date.parse(startsAt) : NaN;
    return Number.isFinite(t) && t - now <= WINDOW_AHEAD_MS && now - t <= WINDOW_BEHIND_MS;
  };
  const get = (gameId: string, sportKey: string) => {
    const key = `${sportKey}:${gameId}`;
    if (!games.has(key)) games.set(key, { gameId, sportKey, legs: [], savers: new Map(), selections: new Map() });
    return games.get(key)!;
  };
  // Who saved which ticket: a saver hears about the legs of their own ticket, never another's.
  const addSaver = (g: GameWatch, ledgerId: string, userId: string) => {
    if (!g.savers.has(ledgerId)) g.savers.set(ledgerId, new Set());
    g.savers.get(ledgerId)!.add(userId);
  };
  const db = getDb();
  for (const e of pendingEntries()) {
    // Cross-game tickets carry a slate key, not an ESPN id; their legs are watched through bankroll legs.
    if (!/^\d+$/.test(e.gameId) || !inWindow(e.startsAt) || !SPORTS.some((s) => s.key === e.sportKey)) continue;
    const g = get(e.gameId, e.sportKey);
    e.legs.forEach((leg, legIndex) => {
      g.legs.push({ ledgerId: e.id, legIndex, suggestionId: e.suggestionId, selection: leg.selection, settlement: leg.settlement });
      g.selections.set(`${e.id}:${legIndex}`, leg.selection);
    });
    for (const row of db.prepare("SELECT userId FROM bankroll_entries WHERE ledgerId=? AND outcome='pending'").all(e.id) as { userId: string }[]) addSaver(g, e.id, row.userId);
  }
  const legRows = db.prepare(`SELECT l.entryId, l.idx, l.selection, l.gameId, l.sportKey, l.startsAt, l.settlement, b.userId FROM bankroll_legs l
    JOIN bankroll_entries b ON b.id = l.entryId WHERE l.outcome='pending' AND l.gameId IS NOT NULL AND l.settlement IS NOT NULL`).all() as
    { entryId: string; idx: number; selection: string; gameId: string; sportKey: string | null; startsAt: string | null; settlement: string; userId: string }[];
  for (const r of legRows) {
    if (!r.sportKey || !inWindow(r.startsAt)) continue;
    const g = get(r.gameId, r.sportKey);
    g.legs.push({ ledgerId: `bl:${r.entryId}`, legIndex: r.idx, selection: r.selection, settlement: JSON.parse(r.settlement) as Settlement });
    g.selections.set(`bl:${r.entryId}:${r.idx}`, r.selection);
    addSaver(g, `bl:${r.entryId}`, r.userId);
  }
  return games;
}

export async function runLineupWatch(opts: { now?: Date; maxGames?: number } = {}): Promise<LineupResult> {
  const now = (opts.now ?? new Date()).getTime();
  const db = getDb();
  const runId = newId("job");
  db.prepare("INSERT INTO job_runs (id,job,status,startedAt) VALUES (?,?,?,?)").run(runId, "lineups", "running", nowIso());
  const watches = [...collect(now).values()].slice(0, opts.maxGames ?? 30);
  let alerts = 0;
  let notified = 0;
  const notes: string[] = [];
  const base = baseUrlOrEmpty();
  for (const w of watches) {
    try {
      const sport = getSport(w.sportKey);
      const detail = await getGameDetail(w.gameId, false, w.sportKey).catch(() => null);
      if (!detail) continue;
      const summary = sport.group === "soccer"
        ? await cached(`lineup-summary-${w.sportKey}-${w.gameId}`, 5 * 60_000, () => espnJson(`https://site.api.espn.com/apis/site/v2/sports/${sport.espnSport}/${sport.espnLeague}/summary?event=${w.gameId}`)).catch(() => ({}))
        : {};
      const snap = lineupSnapshot(summary, detail.injuries, detail.leaders);
      const found = diffLineup(w.legs, snap);
      const fresh: LegAlert[] = [];
      for (const a of found) {
        const inserted = db.prepare("INSERT OR IGNORE INTO leg_alerts (ledgerId, legIndex, gameId, sportKey, suggestionId, kind, player, detail, detectedAt) VALUES (?,?,?,?,?,?,?,?,?)")
          .run(a.ledgerId, a.legIndex, w.gameId, w.sportKey, a.suggestionId ?? null, a.kind, a.player, a.detail, new Date(now).toISOString()).changes > 0;
        if (inserted) fresh.push(a);
      }
      alerts += fresh.length;
      if (!fresh.length) continue;
      const matchup = `${detail.game.away.displayName} @ ${detail.game.home.displayName}`;
      const gameUrl = (lang: string) => `${base}/app/game/${w.gameId}?sport=${w.sportKey}&lang=${lang}`;
      // Per person, one message per player and kind, whatever number of tickets carried the leg. A leg
      // text only reaches someone who saved that ticket or whose plan shows it on the page; other
      // followers of the teams get one pick-free notice for the game.
      const outbox = new Map<string, { legs: Map<string, LegAlert>; notice: boolean }>();
      const entry = (userId: string) => outbox.get(userId) ?? outbox.set(userId, { legs: new Map(), notice: false }).get(userId)!;
      const playerKey = (a: LegAlert) => `${normaliseName(a.player)}:${a.kind}`;
      for (const a of fresh) {
        for (const userId of w.savers.get(a.ledgerId) ?? []) {
          const e = entry(userId);
          if (!e.legs.has(playerKey(a))) e.legs.set(playerKey(a), a);
        }
      }
      for (const userId of followersOf(w.sportKey, [detail.game.home.id, detail.game.away.id])) {
        const row = findById(userId);
        if (!row || row.disabledAt) continue;
        const viewer = toPublic(row);
        const visible = new Set<string>();
        for (const lang of ["pt", "en"] as const) for (const id of visibleSuggestionIds(viewer, { sportKey: w.sportKey, gameId: w.gameId, lang, now })) visible.add(id);
        const e = entry(userId);
        for (const a of fresh) {
          if (a.suggestionId && visible.has(a.suggestionId)) { if (!e.legs.has(playerKey(a))) e.legs.set(playerKey(a), a); }
          else e.notice = true;
        }
      }
      for (const [userId, e] of outbox) {
        const user = findById(userId);
        if (!user) continue;
        const lang = normaliseLang(user.lang);
        for (const [key, a] of e.legs) {
          const selection = w.selections.get(`${a.ledgerId}:${a.legIndex}`) ?? "";
          const text = lineupAlertText(a, selection, matchup, lang);
          const where = await deliver({ userId, kind: "lineup", dedupeKey: `lineup:${w.gameId}:${key}`, title: text.title, body: text.body, url: gameUrl(lang) });
          if (where) notified += 1;
        }
        if (e.notice && !e.legs.size) {
          const text = lineupNoticeText(matchup, lang);
          const where = await deliver({ userId, kind: "lineup", dedupeKey: `lineup:${w.gameId}:notice`, title: text.title, body: `${text.body}\n${gameUrl(lang)}`, url: gameUrl(lang) });
          if (where) notified += 1;
        }
      }
    } catch (error) {
      notes.push(`${w.gameId}: ${reportError("job.lineups", error, { gameId: w.gameId }, "warn")}`);
    }
  }
  const note = [`${watches.length} games`, ...notes].join(" | ");
  db.prepare("UPDATE job_runs SET status=?, finishedAt=?, gamesProcessed=?, note=? WHERE id=?").run(notes.length && !alerts ? "error" : "ok", nowIso(), watches.length, note.slice(0, 500), runId);
  logEvent("job.lineups", { runId, games: watches.length, alerts, notified });
  return { runId, games: watches.length, alerts, notified, note };
}

export interface LegAlertRow { ledgerId: string; legIndex: number; suggestionId: string | null; kind: string; player: string; detectedAt: string }

export function alertsForGame(gameId: string): LegAlertRow[] {
  return getDb().prepare("SELECT ledgerId, legIndex, suggestionId, kind, player, detectedAt FROM leg_alerts WHERE gameId=? ORDER BY detectedAt").all(gameId) as LegAlertRow[];
}

/** Alert counts per bankroll entry (by the ticket it saved, or its own legs). */
export function alertsForEntries(entries: { id: string; ledgerId: string | null }[]): Map<string, { kind: string; player: string }[]> {
  const out = new Map<string, { kind: string; player: string }[]>();
  const stmt = getDb().prepare("SELECT kind, player FROM leg_alerts WHERE ledgerId=?");
  for (const e of entries) {
    const rows = [...(e.ledgerId ? stmt.all(e.ledgerId) : []), ...stmt.all(`bl:${e.id}`)] as { kind: string; player: string }[];
    if (rows.length) out.set(e.id, rows);
  }
  return out;
}
