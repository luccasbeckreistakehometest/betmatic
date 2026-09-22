import { getGameDetail, getPlayerHistory, getSeasonRole } from "@/lib/sources/espn";
import { getPropPrices, PROP_BOOK, type PostedProp, type PropFeed } from "@/lib/sources/espn-props";
import { getLiveBoxScore, type LiveBoxScore } from "@/lib/props/box-score";
import { describeDropped, guardProps, type StaleVerdict } from "@/lib/props/stale";
import { measureProp } from "@/lib/props/history";
import { buildRoleFromStarts, buildRoleProfile, volumeSupports, type RoleProfile } from "@/lib/props/role";
import { getSport, type MarketDef, type SportDef } from "@/lib/sports";
import type { GameDetail, PlayerHistory, PropRow } from "@/lib/types";

/** Lines sit on the half-point so they cannot push, mirroring how books price them. */
function candidateLine(median: number): number {
  return Math.max(0.5, Math.round(median) - 0.5);
}

export interface PlayerContext { athleteId: string; name: string; team: string; history: PlayerHistory | null; role: RoleProfile | null }

export interface CandidateSet {
  /** Gated, ranked, at most `limit`. Priced rows first. */
  props: PropRow[];
  roles: RoleProfile[];
  /** Players removed by the minutes/role gate before the prompt. */
  dropped: string[];
  feed: PropFeed["status"];
  posted: PostedProp[];
  players: PlayerContext[];
  /** Legs the stale line guard removed because the box score had already decided them. */
  staleDropped: string[];
  /** Set while the game is in progress: the box score the guard judged the lines against. */
  live: LiveBoxScore | null;
}

/** The fair chance a price implies: the no-vig one for a two-sided market, the raw one otherwise. */
export const marketFair = (row: Pick<PropRow, "noVigFair" | "decimal">): number =>
  row.noVigFair ?? (row.decimal && row.decimal > 1 ? 1 / row.decimal : NaN);

/** How far the measured rate sits above what the price asks: the ranking key for priced rows. */
export const measuredGap = (row: PropRow): number => (row.measured ? row.measured.impliedFair - marketFair(row) : -Infinity);

/**
 * The minutes/role gate, applied in code before the model ever sees a candidate: a soft matchup is
 * worth nothing to a player who will not be on the floor long enough to reach the line.
 */
export function gateByRole(rows: PropRow[], roles: Map<string, RoleProfile | null>, sportGroup: string): { kept: PropRow[]; dropped: string[] } {
  const dropped = new Set<string>();
  const kept = rows.filter((row) => {
    const ok = volumeSupports(roles.get(row.player) ?? null, sportGroup);
    if (!ok) dropped.add(row.player);
    return ok;
  });
  return { kept, dropped: [...dropped] };
}

/** Ranks priced rows by measured-minus-market gap, keeps two rungs per player+market, then unpriced. */
export function rankCandidates(rows: PropRow[], limit = 40): PropRow[] {
  const priced = rows.filter((r) => r.priced).sort((a, b) => measuredGap(b) - measuredGap(a));
  const perKey = new Map<string, number>();
  const trimmed = priced.filter((r) => {
    const k = `${r.player}|${r.marketKey ?? r.market}|${r.side}`;
    const n = perKey.get(k) ?? 0;
    perKey.set(k, n + 1);
    return n < 2;
  });
  const unpriced = rows.filter((r) => !r.priced).sort((a, b) => (b.measured?.impliedFair ?? 0) - (a.measured?.impliedFair ?? 0));
  return [...trimmed, ...unpriced].slice(0, limit);
}

/** ESPN numbers these leagues' seasons by the year they END (NBA 2025-26 is season=2026). */
const END_YEAR_LEAGUES = new Set(["nba"]);

/**
 * The `season` parameter of the season before the current one. WNBA and football are numbered by the
 * year they start, so that is last calendar year; the NBA tips off in October, and from then on the
 * current season ends next year, so the previous one is this year's number.
 */
export function previousSeasonParam(sportKey: string, now = new Date()): number {
  const year = now.getUTCFullYear();
  if (!END_YEAR_LEAGUES.has(getSport(sportKey).espnLeague)) return year - 1;
  const currentEnds = now.getUTCMonth() >= 9 ? year + 1 : year;
  return currentEnds - 1;
}

export async function historyFor(sportKey: string, athleteId: string): Promise<PlayerHistory | null> {
  const current = await getPlayerHistory(sportKey, athleteId).catch(() => null);
  if (current && current.games.length >= 8) return current;
  // Early in a season the current log is a rumour; the previous season is the sample to lean on.
  const previous = await getPlayerHistory(sportKey, athleteId, false, previousSeasonParam(sportKey)).catch(() => null);
  if (!previous?.games.length) return current;
  const seen = new Set((current?.games ?? []).map((g) => g.eventId));
  return {
    athleteId, player: "", team: "",
    games: [...(current?.games ?? []), ...previous.games.filter((g) => !seen.has(g.eventId))].sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "")),
    availableStats: current?.availableStats.length ? current.availableStats : previous.availableStats,
  };
}

export async function roleFor(sport: SportDef, player: { athleteId: string; name: string }, history: PlayerHistory | null): Promise<RoleProfile | null> {
  if (sport.group === "basketball") return buildRoleProfile(history, player.name, "basketball");
  if (sport.group === "soccer") return buildRoleFromStarts(player.name, await getSeasonRole(sport.key, player.athleteId).catch(() => null));
  return null;
}

function pricedRow(sport: SportDef, market: MarketDef, player: PlayerContext, posted: PostedProp, live?: { verdict: StaleVerdict; box: LiveBoxScore } | null): PropRow | null {
  if (!player.history || posted.decimal < 1.15 || posted.decimal > 8) return null;
  const measured = measureProp(player.history, market.key, posted.line, posted.side, sport.key);
  if (!measured || measured.season.of < 3) return null;
  const inPlay = live && live.verdict.state === "alive" && live.verdict.current !== null && live.verdict.remaining !== null
    ? { current: live.verdict.current, remaining: live.verdict.remaining, minutesLeft: live.box.minutesLeft }
    : null;
  return {
    player: player.name, team: player.team, athleteId: player.athleteId,
    market: market.label.en, marketKey: market.key, line: posted.line, side: posted.side,
    odds: posted.decimal.toFixed(2), decimal: posted.decimal, book: posted.book,
    openDecimal: posted.openDecimal, noVigFair: posted.noVigFair, priced: true,
    note: [
      posted.openDecimal && posted.openDecimal !== posted.decimal ? `opened ${posted.openDecimal.toFixed(2)}` : "",
      posted.noVigFair !== null ? `no-vig ${(posted.noVigFair * 100).toFixed(0)}%` : "one-sided ladder, price includes the full margin",
      measured.sampleNote,
      inPlay ? `live: ${live!.verdict.reason?.en ?? ""}` : "",
    ].filter(Boolean).join(" · "),
    measured,
    live: inPlay,
  };
}

function unpricedRows(sport: SportDef, player: PlayerContext): PropRow[] {
  if (!player.history) return [];
  const out: PropRow[] = [];
  for (const market of sport.markets) {
    if (!market.statLabels.length || market.key === "minutes") continue;
    const probe = measureProp(player.history, market.key, 0.5, "over", sport.key);
    if (!probe || !Number.isFinite(probe.median)) continue;
    const line = market.binary ? 0.5 : candidateLine(probe.median);
    const measured = measureProp(player.history, market.key, line, "over", sport.key);
    if (!measured || measured.season.of < 3) continue;
    out.push({
      player: player.name, team: player.team, athleteId: player.athleteId, market: market.label.en, marketKey: market.key,
      line, side: "over", odds: undefined, book: undefined, priced: false,
      note: `candidate from game logs — no market price attached · ${measured.sampleNote}`, measured,
    });
  }
  return out;
}

/**
 * Player legs at the price the book actually posted. With a price feed the players are the ones the
 * book priced; each posted line is measured at that exact number against the game logs. Without one
 * (feed down, league not covered) the old behaviour remains: the statistical leaders, measured at
 * their median, flagged as unpriced — the builder never lets an unpriced leg into a ticket.
 */
export async function buildPropCandidates(
  detail: GameDetail,
  opts: { maxPlayers?: number; limit?: number; feed?: PropFeed; box?: LiveBoxScore | null } = {},
): Promise<CandidateSet> {
  const sport = getSport(detail.game.sportKey);
  const empty: CandidateSet = { props: [], roles: [], dropped: [], feed: "empty", posted: [], players: [], staleDropped: [], live: null };
  if (!sport.hasPlayerGamelog) return empty;
  const feed = opts.feed ?? (await getPropPrices(sport.key, detail.game.id));
  const roster = detail.rosters.flatMap((r) => (r.athletes ?? []).map((a) => ({ ...a, team: r.teamAbbreviation })));
  const byId = new Map(roster.map((a) => [a.id, a]));

  // The stale line guard, applied before anything else sees the feed. ESPN's prop prices are
  // pre-game and never move once the ball is up, so a game in progress can be carrying lines the
  // box score has already settled — a leg nobody could have taken. Those are dropped outright; the
  // survivors carry what they still need. A failed or missing box score decides nothing.
  const box = opts.box !== undefined ? opts.box : detail.game.status === "live" ? await getLiveBoxScore(sport.key, detail.game.id) : null;
  const guard = guardProps(feed.props, box?.totals ?? null);
  const posted = guard.kept.map((k) => k.prop);
  const verdicts = new Map(guard.kept.map((k) => [k.prop, k.verdict]));
  const named = (id: string) => byId.get(id)?.name;
  const staleDropped = describeDropped(guard.dropped.map((d) => ({ ...d, prop: { ...d.prop, player: named(d.prop.athleteId) } })));

  let picks: { athleteId: string; name: string; team: string }[];
  if (posted.length) {
    const counts = new Map<string, number>();
    for (const p of posted) counts.set(p.athleteId, (counts.get(p.athleteId) ?? 0) + 1);
    picks = [...counts.entries()]
      .filter(([id]) => byId.has(id))
      .sort((a, b) => b[1] - a[1])
      .slice(0, opts.maxPlayers ?? 10)
      .map(([id]) => ({ athleteId: id, name: byId.get(id)!.name, team: byId.get(id)!.team }));
  } else {
    // The statistical leaders are the players books usually post props on.
    const leaderNames = new Set(detail.leaders.map((l) => l.player));
    picks = [];
    for (const r of detail.rosters) {
      for (const a of (r.athletes ?? []).filter((x) => leaderNames.has(x.name)).slice(0, 3)) picks.push({ athleteId: a.id, name: a.name, team: r.teamAbbreviation });
    }
  }
  if (!picks.length) return { ...empty, feed: feed.status, staleDropped, live: box };

  const players: PlayerContext[] = [];
  for (const pick of picks) {
    const history = await historyFor(sport.key, pick.athleteId);
    players.push({ ...pick, history, role: await roleFor(sport, pick, history) });
  }

  const rows: PropRow[] = [];
  for (const player of players) {
    const mine = posted.filter((p) => p.athleteId === player.athleteId);
    // A player whose every line was already decided keeps no fallback: an unpriced candidate in a
    // game under way is a pre-game median, which is exactly the number the guard exists to refuse.
    if (!mine.length) { if (!box) rows.push(...unpricedRows(sport, player)); continue; }
    for (const p of mine) {
      const market = sport.markets.find((m) => m.key === p.marketKey);
      const verdict = verdicts.get(p);
      const row = market ? pricedRow(sport, market, player, p, box && verdict ? { verdict, box } : null) : null;
      if (row) rows.push(row);
    }
  }

  const roleMap = new Map(players.map((p) => [p.name, p.role]));
  const { kept, dropped } = gateByRole(rows, roleMap, sport.group);
  return {
    props: rankCandidates(kept, opts.limit ?? 40),
    roles: players.map((p) => p.role).filter((r): r is RoleProfile => r !== null),
    dropped,
    feed: feed.status,
    posted,
    players,
    staleDropped,
    live: box,
  };
}

/** For a single player page or a slip check: the detail is fetched here when the caller has none. */
export async function candidatesForGame(sportKey: string, gameId: string): Promise<CandidateSet | null> {
  const detail = await getGameDetail(gameId, false, sportKey).catch(() => null);
  return detail ? buildPropCandidates(detail) : null;
}

export { PROP_BOOK };
