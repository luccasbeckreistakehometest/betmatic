/**
 * Per-quarter profiles read off ESPN's play-by-play. Pure.
 *
 * The live read used to receive the box score ACCUMULATED: at half-time the model saw "14 points"
 * and could not see that 12 of them came in the first quarter and 2 in the second. That difference
 * is the whole reason a live read exists — who accelerated, who went quiet, whose role changed —
 * and it never reached the model.
 *
 * The same `summary` payload the snapshot already reads carries a `plays` array (roughly 200 plays
 * at half-time, 400 in a finished game), each play stamped with `period.number` and
 * `clock.displayValue`. Walking it reconstructs, per player and per period, what actually happened.
 * Nothing here fetches: one payload serves the whole game.
 *
 * Counting stats are exact — every one of them is a play ESPN narrated. Minutes are NOT: they are
 * reconstructed by following the substitutions, and that walk rests on an assumption ESPN never
 * confirms (see `walkMinutes`). When the assumption breaks, the minutes are reported as `null` —
 * not measured — rather than as a number nobody can stand behind.
 */

// ESPN's summary JSON is undocumented; accesses are optional-chained.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;

/** ESPN's play type for a substitution. Its text is "<in> enters the game for <out>". */
const SUBSTITUTION = "584";

/** The counting stats the narration sustains, each verified against the box score it must equal. */
export interface QuarterStats { pts: number; reb: number; ast: number; pf: number; stl: number; tov: number; blk: number }

export interface QuarterLine extends QuarterStats {
  period: number;
  /** Minutes on the floor in this period. `null` when the substitution walk does not sustain it. */
  minutes: number | null;
}

export interface QuarterProfile {
  id: string;
  name: string;
  team: string;
  starter: boolean;
  /** One line per period the narration covers, ascending. */
  periods: QuarterLine[];
}

export interface QuarterProfiles {
  /** Periods the narration covers, ascending. Empty when ESPN published no plays yet. */
  periods: number[];
  players: QuarterProfile[];
  /** Plays read. Zero is a normal answer: ESPN publishes the narration late on some games. */
  plays: number;
  /**
   * The last period whose minutes the walk sustains, 0 when none do. Periods after it carry
   * `minutes: null`: the walk is sequential, so a break in Q2 makes Q3 and Q4 unmeasurable too.
   */
  minutesThrough: number;
  /** Why the walk stopped. Empty when it never broke. Surfaced in the log, never in a number. */
  notes: string[];
}

export const EMPTY_QUARTERS: QuarterProfiles = { periods: [], players: [], plays: 0, minutesThrough: 0, notes: [] };

const zero = (): QuarterStats => ({ pts: 0, reb: 0, ast: 0, pf: 0, stl: 0, tov: 0, blk: 0 });

/**
 * A play's clock, in minutes remaining in the period. ESPN prints "9:42" for most of a period and
 * drops to "34.6" — bare seconds — inside the last minute. Both appear in the same game.
 */
export function playClock(value: unknown): number | null {
  const s = String(value ?? "").trim();
  const mmss = s.match(/^(\d+):(\d{1,2})(?:\.\d+)?$/);
  if (mmss) return Number(mmss[1]) + Number(mmss[2]) / 60;
  const seconds = s.match(/^(\d+(?:\.\d+)?)$/);
  return seconds ? Number(seconds[1]) / 60 : null;
}

interface Roster { id: string; name: string; team: string; teamId: string; starter: boolean; played: boolean }

/** Who is on the floor and who could be: the box score names the starters, the narration moves them. */
function rosterOf(summary: Json): Roster[] {
  const out: Roster[] = [];
  for (const group of (summary?.boxscore?.players ?? []) as Json[]) {
    const team = String(group.team?.abbreviation ?? "");
    const teamId = String(group.team?.id ?? "");
    for (const a of (group.statistics?.[0]?.athletes ?? []) as Json[]) {
      const id = String(a.athlete?.id ?? "");
      if (!id) continue;
      out.push({
        id,
        name: String(a.athlete?.displayName ?? ""),
        team,
        teamId,
        // A player listed as a starter but marked DNP never took the floor: seeding him into the
        // opening five would hand him a quarter of minutes he did not play.
        starter: a.starter === true && a.didNotPlay !== true,
        played: a.didNotPlay !== true && Array.isArray(a.stats) && a.stats.length > 0,
      });
    }
  }
  return out;
}

interface Play { period: number; clock: number | null; typeId: string; text: string; participants: string[]; scoringPlay: boolean; scoreValue: number }

function playsOf(summary: Json): Play[] {
  return ((summary?.plays ?? []) as Json[]).map((p) => ({
    period: Number(p.period?.number ?? 0),
    clock: playClock(p.clock?.displayValue),
    typeId: String(p.type?.id ?? ""),
    // ESPN wraps some play texts across a newline ("Bad Pass\nTurnover"); the matching below is
    // done on the flattened text so a line break never silently drops a stat.
    text: String(p.text ?? "").replace(/\s+/g, " ").trim(),
    participants: ((p.participants ?? []) as Json[]).map((x) => String(x.athlete?.id ?? "")).filter(Boolean),
    scoringPlay: p.scoringPlay === true,
    scoreValue: Number(p.scoreValue ?? 0),
  })).filter((p) => p.period > 0);
}

/**
 * The counting stats, per player per period. Every one is a narrated play, so these are exact: on
 * the game this was built against all seven stats matched the box score for all 17 players who
 * played. Which participant carries which stat is fixed by ESPN's own shape:
 *   - a scoring play credits `participants[0]`, and the assister is `participants[1]` when the text
 *     says "(X assists)";
 *   - a rebound, a foul and a turnover credit `participants[0]`;
 *   - a steal and a block credit `participants[1]`, because `participants[0]` is the victim.
 */
function countStats(plays: Play[]): Map<string, Map<number, QuarterStats>> {
  const out = new Map<string, Map<number, QuarterStats>>();
  const add = (id: string | undefined, period: number, key: keyof QuarterStats, by = 1) => {
    if (!id) return;
    const byPeriod = out.get(id) ?? new Map<number, QuarterStats>();
    const line = byPeriod.get(period) ?? zero();
    line[key] += by;
    byPeriod.set(period, line);
    out.set(id, byPeriod);
  };
  for (const p of plays) {
    const [first, second] = p.participants;
    if (p.scoringPlay && p.scoreValue > 0) {
      add(first, p.period, "pts", p.scoreValue);
      if (/\bassists\b/i.test(p.text)) add(second, p.period, "ast");
    }
    // A technical is not a personal foul and never enters the box score's PF column.
    if (/\bfoul\b/i.test(p.text) && !/\btechnical\b/i.test(p.text)) add(first, p.period, "pf");
    if (/\brebound\b/i.test(p.text)) add(first, p.period, "reb");
    if (/\bturnover\b/i.test(p.text)) add(first, p.period, "tov");
    if (/\bsteals\b/i.test(p.text)) add(second, p.period, "stl");
    if (/\bblocks\b/i.test(p.text)) add(second, p.period, "blk");
  }
  return out;
}

/**
 * Minutes on the floor, per player per period, by following the substitutions.
 *
 * The walk starts from the five the box score marks as starters and moves a player on or off at the
 * clock the substitution carries. Everything in it is narrated EXCEPT one thing: ESPN never says who
 * takes the floor to open a period after the first. The walk assumes the five that finished a period
 * start the next one — which is what usually happens, and is exactly what a coach may not do at
 * half-time.
 *
 * So the walk checks itself, and stops at the first period it cannot stand behind:
 *   - a side that does not have exactly five players on the floor when a period tips;
 *   - a substitution taking off a player the walk does not have on the floor;
 *   - a player recording a narrated play while the walk has him on the bench — the tell that a
 *     change happened between periods and was never narrated;
 *   - a substitution whose clock will not parse.
 * Every period from the break onward is reported as not measured. Reporting a number there would be
 * inventing one, and a minutes figure is what every per-minute rate in the live read is divided by.
 */
function walkMinutes(plays: Play[], roster: Roster[], periods: number[], minutesFor: (period: number) => number) {
  const minutes = new Map<string, Map<number, number>>();
  const notes: string[] = [];
  const byId = new Map(roster.map((r) => [r.id, r]));
  const teams = [...new Set(roster.map((r) => r.teamId))];
  const floor = new Map<string, Set<string>>(teams.map((t) => [t, new Set(roster.filter((r) => r.teamId === t && r.starter).map((r) => r.id))]));
  /** Clock at which each player on the floor began his current stint. */
  const since = new Map<string, number>();
  let through = 0;

  const credit = (id: string, period: number, mins: number) => {
    const byPeriod = minutes.get(id) ?? new Map<number, number>();
    byPeriod.set(period, (byPeriod.get(period) ?? 0) + Math.max(0, mins));
    minutes.set(id, byPeriod);
  };

  for (const period of periods) {
    const full = minutesFor(period);
    for (const [teamId, set] of floor) {
      if (set.size !== 5) {
        notes.push(`P${period}: ${teamId} has ${set.size} on the floor at the tip, not 5`);
        return { minutes, notes, through };
      }
      for (const id of set) since.set(id, full);
    }
    for (const play of plays.filter((p) => p.period === period)) {
      if (play.typeId !== SUBSTITUTION) {
        // A player acting from the bench means the floor is wrong, and it is wrong because a change
        // between periods went unnarrated. Substitutions and team plays carry no such claim.
        const actor = play.participants[0];
        if (actor && byId.has(actor) && !floor.get(byId.get(actor)!.teamId)?.has(actor)) {
          notes.push(`P${period}: ${byId.get(actor)!.name} appears in a play while off the floor — a change between periods was not narrated`);
          return { minutes, notes, through };
        }
        continue;
      }
      if (play.clock === null) {
        notes.push(`P${period}: a substitution carries no readable clock`);
        return { minutes, notes, through };
      }
      const [inId, outId] = play.participants;
      if (!inId || !outId) {
        notes.push(`P${period}: a substitution names ${play.participants.length} player(s), not 2`);
        return { minutes, notes, through };
      }
      const teamId = byId.get(outId)?.teamId ?? byId.get(inId)?.teamId;
      const set = teamId ? floor.get(teamId) : undefined;
      if (!set || !set.has(outId)) {
        notes.push(`P${period}: ${byId.get(outId)?.name ?? outId} left the floor without being on it`);
        return { minutes, notes, through };
      }
      credit(outId, period, (since.get(outId) ?? full) - play.clock);
      set.delete(outId);
      since.delete(outId);
      set.add(inId);
      since.set(inId, play.clock);
    }
    // The period ends: everyone still on the floor runs to 0:00, and carries into the next period.
    for (const set of floor.values()) for (const id of set) credit(id, period, since.get(id) ?? full);
    through = period;
  }
  return { minutes, notes, through };
}

/**
 * Per-player, per-period profiles from one `summary` payload. `periodMinutes` is regulation (10 in
 * the WNBA, 12 in the NBA); overtime is five minutes in both.
 */
export function parseQuarterProfiles(summary: Json, periodMinutes = 12, overtimeMinutes = 5): QuarterProfiles {
  const plays = playsOf(summary);
  if (!plays.length) return EMPTY_QUARTERS;
  const roster = rosterOf(summary);
  if (!roster.length) return { ...EMPTY_QUARTERS, plays: plays.length };
  const periods = [...new Set(plays.map((p) => p.period))].sort((a, b) => a - b);
  const stats = countStats(plays);
  const walk = walkMinutes(plays, roster, periods, (period) => (period <= 4 ? periodMinutes : overtimeMinutes));

  const players = roster
    .filter((r) => r.played || stats.has(r.id))
    .map((r) => ({
      id: r.id,
      name: r.name,
      team: r.team,
      starter: r.starter,
      periods: periods.map((period): QuarterLine => {
        const mins = walk.minutes.get(r.id)?.get(period);
        return {
          period,
          ...(stats.get(r.id)?.get(period) ?? zero()),
          minutes: period <= walk.through ? Math.round((mins ?? 0) * 10) / 10 : null,
        };
      }),
    }));
  return { periods, players, plays: plays.length, minutesThrough: walk.through, notes: walk.notes };
}

/** The game-long total the narration accounts for, per player: the check against the box score. */
export function narrationTotals(profile: QuarterProfile): QuarterStats & { minutes: number | null } {
  const total = { ...zero(), minutes: 0 as number | null };
  for (const line of profile.periods) {
    for (const key of ["pts", "reb", "ast", "pf", "stl", "tov", "blk"] as const) total[key] += line[key];
    if (line.minutes === null) total.minutes = null;
    else if (total.minutes !== null) total.minutes += line.minutes;
  }
  if (typeof total.minutes === "number") total.minutes = Math.round(total.minutes * 10) / 10;
  return total;
}

/* -------------------------------------------------------------------------------------------- */
/* The subtraction: the same split, from the retained box score of each read.                     */
/* -------------------------------------------------------------------------------------------- */

/**
 * The second route to the same number, and the owner's own idea: keep the box score of every read,
 * and the quarter is the difference between two of them. 12 points at the end of Q1, 14 at the end
 * of Q2 — Q2 was 2. It costs nothing, since the payload is already read, and it survives a game
 * ESPN never narrates.
 *
 * It is coarser than the narration in one way that matters: ESPN publishes MIN as a whole number, so
 * a subtracted minutes figure carries up to a minute of rounding either way. It is kept as the check
 * and the fallback; where the two disagree the narration wins and the disagreement is logged.
 */
export interface SnapshotLine { id: string; name: string; team: string; stats: Record<string, number> }
export interface StoredSnapshot { period: number; players: SnapshotLine[] }

export interface SubtractedLine extends QuarterStats { period: number; minutes: number | null }
export interface SubtractedProfile { id: string; name: string; team: string; periods: SubtractedLine[] }

/** ESPN's box-score labels → the names the quarter profile uses. */
const LABELS: Record<keyof QuarterStats, string> = { pts: "PTS", reb: "REB", ast: "AST", pf: "PF", stl: "STL", tov: "TO", blk: "BLK" };

export function quartersBySubtraction(snapshots: StoredSnapshot[]): SubtractedProfile[] {
  const byPeriod = new Map<number, Map<string, SnapshotLine>>();
  for (const snap of snapshots) byPeriod.set(snap.period, new Map(snap.players.map((p) => [p.id, p])));
  const periods = [...byPeriod.keys()].sort((a, b) => a - b);
  const known = new Map<string, SnapshotLine>();
  for (const period of periods) for (const [id, line] of byPeriod.get(period)!) known.set(id, line);

  const out: SubtractedProfile[] = [];
  for (const [id, seed] of known) {
    const lines: SubtractedLine[] = [];
    for (const period of periods) {
      const now = byPeriod.get(period)!.get(id);
      // A period whose baseline was never stored cannot be isolated: everything up to it is lumped
      // into one figure, which is not a quarter. Only the first period may bank on a zero baseline.
      const before = period === 1 ? { stats: {} as Record<string, number> } : byPeriod.get(period - 1)?.get(id);
      if (!now || !before) continue;
      const diff = (label: string) => Math.max(0, (now.stats[label] ?? 0) - (before.stats[label] ?? 0));
      const minutes = now.stats.MIN === undefined ? null : Math.max(0, now.stats.MIN - (before.stats.MIN ?? 0));
      lines.push({
        period, minutes,
        pts: diff(LABELS.pts), reb: diff(LABELS.reb), ast: diff(LABELS.ast),
        pf: diff(LABELS.pf), stl: diff(LABELS.stl), tov: diff(LABELS.tov), blk: diff(LABELS.blk),
      });
    }
    if (lines.length) out.push({ id, name: seed.name, team: seed.team, periods: lines });
  }
  return out;
}

export interface Reconciliation {
  /** (player, period, stat) cells both routes had a figure for. */
  compared: number;
  agreed: number;
  /** Named, so a disagreement is read rather than counted. Capped: the log is not the place for 400. */
  notes: string[];
}

/**
 * Do the two routes tell the same story? Counting stats must match exactly — both are counting the
 * same events. Minutes are allowed a minute of slack, which is ESPN's own rounding of MIN and not a
 * tolerance invented here.
 */
export function reconcileQuarters(narration: QuarterProfiles, subtraction: SubtractedProfile[], limit = 8): Reconciliation {
  const bySub = new Map(subtraction.map((p) => [p.id, new Map(p.periods.map((q) => [q.period, q]))]));
  let compared = 0;
  let agreed = 0;
  const notes: string[] = [];
  for (const player of narration.players) {
    const sub = bySub.get(player.id);
    if (!sub) continue;
    for (const line of player.periods) {
      const other = sub.get(line.period);
      if (!other) continue;
      for (const key of Object.keys(LABELS) as (keyof QuarterStats)[]) {
        compared += 1;
        if (line[key] === other[key]) agreed += 1;
        else if (notes.length < limit) notes.push(`${player.name} Q${line.period} ${LABELS[key]}: narration ${line[key]}, subtraction ${other[key]}`);
      }
      if (line.minutes !== null && other.minutes !== null) {
        compared += 1;
        if (Math.abs(line.minutes - other.minutes) <= 1) agreed += 1;
        else if (notes.length < limit) notes.push(`${player.name} Q${line.period} MIN: narration ${line.minutes}, subtraction ${other.minutes}`);
      }
    }
  }
  return { compared, agreed, notes };
}
