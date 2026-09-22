import { getGameDetail, getPlayerHistory, getSeasonRole } from "@/lib/sources/espn";
import { getPropPrices, PROP_BOOK, type PostedProp, type PropFeed } from "@/lib/sources/espn-props";
import { getLiveBoxScore, type LiveBoxScore } from "@/lib/props/box-score";
import { describeDropped, guardProps, type StaleVerdict } from "@/lib/props/stale";
import { measureProp } from "@/lib/props/history";
import { blendedProbability, fitRate, liveRate, projectLeg, seriesFor, type RateFit, type RateSample } from "@/lib/props/model";
import { listingAvailability, projectMinutes, projectRemainingMinutes, type AbsentTeammate, type MinutesProjection } from "@/lib/props/minutes";
import { buildRoleFromStarts, buildRoleProfile, volumeSupports, type RoleProfile } from "@/lib/props/role";
import { bookLine, regulationMinutes } from "@/lib/signals/environment";
import { normaliseName } from "@/lib/resolve/names";
import { getSport, type MarketDef, type SportDef } from "@/lib/sports";
import type { GameDetail, InjuryEntry, PlayerHistory, PropModel, PropRow } from "@/lib/types";

/** Lines sit on the half-point so they cannot push, mirroring how books price them. */
function candidateLine(median: number): number {
  return Math.max(0.5, Math.round(median) - 0.5);
}

export interface PlayerContext {
  athleteId: string;
  name: string;
  team: string;
  history: PlayerHistory | null;
  role: RoleProfile | null;
  /** Pre-game minutes projection; null when the log is too short to project. */
  minutes: MinutesProjection | null;
  /** The player's own line on the injury report, when there is one. */
  listing: InjuryEntry | null;
}

export interface CandidateSet {
  /** Gated, ranked, at most `limit`. Priced rows first. */
  props: PropRow[];
  roles: RoleProfile[];
  /** One minutes projection per player, the inputs of every counting-stat leg. */
  minutes: MinutesProjection[];
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

/** The chance this pipeline stands behind: the computed one when a model covered the line, the hit rate otherwise. */
export const ourProbability = (row: Pick<PropRow, "model" | "measured">): number =>
  row.model?.computed ?? row.measured?.impliedFair ?? NaN;

/** How far our chance sits above what the price asks: the ranking key for priced rows. */
export const measuredGap = (row: PropRow): number => {
  const ours = ourProbability(row);
  return Number.isFinite(ours) ? ours - marketFair(row) : -Infinity;
};

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

/** Ranks priced rows by our-chance-minus-market gap, keeps two rungs per player+market, then unpriced. */
export function rankCandidates(rows: PropRow[], limit = 40): PropRow[] {
  const priced = rows.filter((r) => r.priced).sort((a, b) => measuredGap(b) - measuredGap(a));
  const perKey = new Map<string, number>();
  const trimmed = priced.filter((r) => {
    const k = `${r.player}|${r.marketKey ?? r.market}|${r.side}`;
    const n = perKey.get(k) ?? 0;
    perKey.set(k, n + 1);
    return n < 2;
  });
  const unpriced = rows.filter((r) => !r.priced).sort((a, b) => ourProbability(b) - ourProbability(a));
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

/** Minutes per logged game, newest first; NaN-free. */
export function minutesOf(history: PlayerHistory | null): number[] {
  if (!history) return [];
  return history.games
    .map((g) => { const raw = g.stats.MIN; return typeof raw === "number" ? raw : Number(String(raw ?? "").replace(/[^\d.]/g, "")); })
    .filter((m) => Number.isFinite(m));
}

/**
 * This player's minutes with and without an absent teammate. The absentee's log lists only the
 * games she played, so every game of the player's missing from it is a game without her. Both
 * sides need three games: a teammate out all season is already in every number and says nothing,
 * and one who never missed a game cannot be measured either.
 */
export function minutesWithout(player: PlayerHistory, absentee: PlayerHistory): { games: number; meanMinutes: number; withGames: number; withMinutes: number; recentMissed: number } | null {
  const playedByAbsentee = new Set(absentee.games.filter((g) => minutesOf({ ...absentee, games: [g] })[0] > 0).map((g) => g.eventId));
  const mins = (predicate: (id: string) => boolean) =>
    player.games.filter((g) => predicate(g.eventId)).map((g) => minutesOf({ ...player, games: [g] })[0]).filter((m) => Number.isFinite(m) && m >= 4);
  const without = mins((id) => !playedByAbsentee.has(id));
  const withHer = mins((id) => playedByAbsentee.has(id));
  if (without.length < 3 || withHer.length < 3) return null;
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  // How many of the player's last five games the absentee already missed: an absence that old is in the recent minutes.
  const recentMissed = player.games.slice(0, 5).filter((g) => !playedByAbsentee.has(g.eventId)).length;
  return { games: without.length, meanMinutes: mean(without), withGames: withHer.length, withMinutes: mean(withHer), recentMissed };
}

const MAX_ABSENTEES_PER_TEAM = 3;

/** Rostered players the injury report lists as out, with the log needed to weigh their absence. */
async function absenteesFor(sport: SportDef, detail: GameDetail, team: string): Promise<{ entry: InjuryEntry; athleteId: string | null; history: PlayerHistory | null }[]> {
  const roster = detail.rosters.find((r) => r.teamAbbreviation === team)?.athletes ?? [];
  const out: { entry: InjuryEntry; athleteId: string | null; history: PlayerHistory | null }[] = [];
  for (const entry of detail.injuries.filter((i) => i.teamAbbreviation === team && listingAvailability(i.status) === "listed_out")) {
    const athlete = roster.find((a) => normaliseName(a.name) === normaliseName(entry.player)) ?? null;
    const history = athlete && out.length < MAX_ABSENTEES_PER_TEAM ? await historyFor(sport.key, athlete.id).catch(() => null) : null;
    out.push({ entry, athleteId: athlete?.id ?? null, history });
  }
  return out;
}

interface ModelInputs {
  fits: Map<string, { fit: RateFit | null; series: RateSample[] }>;
  regulation: number;
  expectedMargin: number | null;
}

function fitFor(inputs: ModelInputs, player: PlayerContext, market: MarketDef, sportKey: string): { fit: RateFit | null; series: RateSample[] } {
  const key = `${player.athleteId}|${market.key}`;
  const hit = inputs.fits.get(key);
  if (hit) return hit;
  const series = player.history ? seriesFor(player.history, market.key, sportKey) : [];
  const fit = market.key === "minutes" || market.binary ? null : fitRate(series, { statLabels: market.statLabels });
  const value = { fit, series };
  inputs.fits.set(key, value);
  return value;
}

/**
 * The computed probability of one line. Before tip-off the fitted rate runs over the projected
 * minutes and the tail is blended with the season hit rate; in play the rate is the gamma-Poisson
 * posterior after tonight's count and the remaining minutes come from the clock, the fouls and the
 * margin, with no blend — half the distribution is already on the board.
 */
function modelFor(
  inputs: ModelInputs,
  player: PlayerContext,
  market: MarketDef,
  line: number,
  side: "over" | "under",
  measured: { hits: number; of: number } | null,
  live: { current: number; box: LiveBoxScore } | null,
  sportKey: string,
): PropModel | null {
  const { fit } = fitFor(inputs, player, market, sportKey);
  if (!fit || !player.minutes) return null;
  if (!live) {
    const leg = projectLeg(fit, { expected: player.minutes.expected, sd: player.minutes.sd }, line, side);
    return {
      computed: blendedProbability(leg.computed, measured?.hits ?? 0, measured?.of ?? 0),
      distribution: leg.computed, pOver: leg.pOver, pUnder: leg.pUnder, mean: Number(leg.mean.toFixed(1)), sd: Number(leg.sd.toFixed(1)),
      rate: Number(fit.rate.toFixed(3)), recentRate: Number(fit.recentRate.toFixed(3)), dispersion: Number(fit.dispersion.toFixed(3)),
      minutes: { expected: player.minutes.expected, sd: player.minutes.sd, availability: player.minutes.availability },
      ladder: leg.ladder.map((r) => ({ line: r.line, pOver: Number(r.pOver.toFixed(3)), pUnder: Number(r.pUnder.toFixed(3)) })),
      note: leg.note,
    };
  }
  // A box built by hand (tests, older callers) may carry only the totals: defaults keep the read alive.
  const tonight = live.box.players?.[player.athleteId];
  const played = tonight?.minutes ?? 0;
  const elapsed = live.box.minute;
  const remaining = projectRemainingMinutes({
    player: player.name, preGame: player.minutes, minutesPlayed: played, minutesElapsed: elapsed, minutesLeft: live.box.minutesLeft,
    regulationMinutes: live.box.regulationMinutes ?? inputs.regulation, fouls: tonight?.fouls ?? 0, currentMargin: live.box.margin ?? 0, expectedMargin: inputs.expectedMargin,
  });
  const posterior = liveRate(fit, { value: live.current, minutes: played });
  const leg = projectLeg({ rate: posterior.rate, dispersion: posterior.dispersion }, { expected: remaining.expected, sd: remaining.sd }, line, side, { current: live.current });
  const needed = side === "over" ? Math.max(0, Math.floor(line) + 1 - live.current) : Math.max(0, Math.ceil(line) - 1 - live.current);
  return {
    computed: leg.computed, distribution: leg.computed, pOver: leg.pOver, pUnder: leg.pUnder, mean: Number(leg.mean.toFixed(1)), sd: Number(leg.sd.toFixed(1)),
    rate: Number(fit.rate.toFixed(3)), recentRate: Number(fit.recentRate.toFixed(3)), dispersion: Number(posterior.dispersion.toFixed(3)),
    minutes: { expected: remaining.expected, sd: remaining.sd, availability: "ok" },
    ladder: leg.ladder.map((r) => ({ line: r.line, pOver: Number(r.pOver.toFixed(3)), pUnder: Number(r.pUnder.toFixed(3)) })),
    note: `${leg.note}; ${remaining.note}`,
    live: {
      needed, remainingMinutes: remaining.expected,
      needPerMinute: remaining.expected > 0 ? Number((needed / remaining.expected).toFixed(3)) : Infinity,
      ratePerMinuteTonight: played > 0 ? Number((live.current / played).toFixed(3)) : 0,
      ratePerMinutePreGame: Number(fit.rate.toFixed(3)),
      ratePerMinuteBlended: Number(posterior.rate.toFixed(3)),
      minutesPlayed: played, fouls: tonight?.fouls ?? 0,
    },
  };
}

function pricedRow(sport: SportDef, market: MarketDef, player: PlayerContext, posted: PostedProp, inputs: ModelInputs, live?: { verdict: StaleVerdict; box: LiveBoxScore } | null): PropRow | null {
  if (!player.history || posted.decimal < 1.15 || posted.decimal > 8) return null;
  const measured = measureProp(player.history, market.key, posted.line, posted.side, sport.key);
  if (!measured || measured.season.of < 3) return null;
  const inPlay = live && live.verdict.state === "alive" && live.verdict.current !== null && live.verdict.remaining !== null
    ? { current: live.verdict.current, remaining: live.verdict.remaining, minutesLeft: live.box.minutesLeft }
    : null;
  const liveNote = inPlay && live?.verdict.reason ? `live: ${live.verdict.reason.en}` : "";
  const model = modelFor(inputs, player, market, posted.line, posted.side, measured.season, inPlay && live ? { current: inPlay.current, box: live.box } : null, sport.key);
  const { series } = fitFor(inputs, player, market, sport.key);
  return {
    player: player.name, team: player.team, athleteId: player.athleteId,
    market: market.label.en, marketKey: market.key, line: posted.line, side: posted.side,
    odds: posted.decimal.toFixed(2), decimal: posted.decimal, book: posted.book,
    openDecimal: posted.openDecimal, noVigFair: posted.noVigFair, priced: true,
    note: [
      posted.openDecimal && posted.openDecimal !== posted.decimal ? `opened ${posted.openDecimal.toFixed(2)}` : "",
      posted.noVigFair !== null ? `no-vig ${(posted.noVigFair * 100).toFixed(0)}%` : "one-sided ladder, price includes the full margin",
      measured.sampleNote,
      liveNote,
    ].filter(Boolean).join(" · "),
    measured,
    live: inPlay,
    model,
    series,
    minutesProjection: player.minutes ? { player: player.name, expected: player.minutes.expected, sd: player.minutes.sd, availability: player.minutes.availability, note: player.minutes.note } : null,
  };
}

function unpricedRows(sport: SportDef, player: PlayerContext, inputs: ModelInputs): PropRow[] {
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
      model: modelFor(inputs, player, market, line, "over", measured.season, null, sport.key),
      series: fitFor(inputs, player, market, sport.key).series,
      minutesProjection: player.minutes ? { player: player.name, expected: player.minutes.expected, sd: player.minutes.sd, availability: player.minutes.availability, note: player.minutes.note } : null,
    });
  }
  return out;
}

/**
 * Player legs at the price the book actually posted. With a price feed the players are the ones the
 * book priced; each posted line is measured at that exact number against the game logs. Without one
 * (feed down, league not covered) the old behaviour remains: the statistical leaders, measured at
 * their median, flagged as unpriced — the builder never lets an unpriced leg into a ticket.
 *
 * Every row now also carries the computed probability of its line (props/model.ts) over a minutes
 * projection (props/minutes.ts) that reads the injury report and the spread; in play the projection
 * is of the remainder, against the box score.
 */
export async function buildPropCandidates(
  detail: GameDetail,
  opts: { maxPlayers?: number; limit?: number; feed?: PropFeed; box?: LiveBoxScore | null } = {},
): Promise<CandidateSet> {
  const sport = getSport(detail.game.sportKey);
  const empty: CandidateSet = { props: [], roles: [], minutes: [], dropped: [], feed: "empty", posted: [], players: [], staleDropped: [], live: null };
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

  // The absences that free minutes, per team, with their logs where the roster names them.
  const regulation = regulationMinutes(sport.key);
  const line = bookLine(detail);
  const teams = [...new Set(picks.map((p) => p.team))];
  const absentees = new Map<string, Awaited<ReturnType<typeof absenteesFor>>>();
  for (const team of teams) absentees.set(team, sport.group === "basketball" ? await absenteesFor(sport, detail, team) : []);

  const players: PlayerContext[] = [];
  for (const pick of picks) {
    const history = await historyFor(sport.key, pick.athleteId);
    const listing = detail.injuries.find((i) => i.teamAbbreviation === pick.team && normaliseName(i.player) === normaliseName(pick.name)) ?? null;
    const absent: AbsentTeammate[] = (absentees.get(pick.team) ?? [])
      .filter((a) => a.athleteId !== pick.athleteId)
      .map((a) => ({
        name: a.entry.player, status: a.entry.status,
        minutesPerGame: a.history ? (() => { const m = minutesOf(a.history); return m.length ? m.reduce((x, y) => x + y, 0) / m.length : null; })() : null,
        without: history && a.history ? minutesWithout(history, a.history) : null,
      }));
    const minutes = sport.group === "basketball"
      ? projectMinutes({
          player: pick.name, minutes: minutesOf(history), regulationMinutes: regulation,
          expectedMargin: line.spread, absentTeammates: absent, listing: listing ? { status: listing.status, updatedAt: listing.updatedAt } : null,
        })
      : null;
    players.push({ ...pick, history, role: await roleFor(sport, pick, history), minutes, listing });
  }

  const inputs: ModelInputs = { fits: new Map(), regulation, expectedMargin: line.spread };
  const rows: PropRow[] = [];
  for (const player of players) {
    const mine = posted.filter((p) => p.athleteId === player.athleteId);
    // A player whose every line was already decided keeps no fallback: an unpriced candidate in a
    // game under way is a pre-game median, which is exactly the number the guard exists to refuse.
    if (!mine.length) { if (!box) rows.push(...unpricedRows(sport, player, inputs)); continue; }
    for (const p of mine) {
      const market = sport.markets.find((m) => m.key === p.marketKey);
      const verdict = verdicts.get(p);
      const row = market ? pricedRow(sport, market, player, p, inputs, box && verdict ? { verdict, box } : null) : null;
      if (row) rows.push(row);
    }
  }

  const roleMap = new Map(players.map((p) => [p.name, p.role]));
  const { kept, dropped } = gateByRole(rows, roleMap, sport.group);
  return {
    props: rankCandidates(kept, opts.limit ?? 40),
    roles: players.map((p) => p.role).filter((r): r is RoleProfile => r !== null),
    minutes: players.map((p) => p.minutes).filter((m): m is MinutesProjection => m !== null),
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
