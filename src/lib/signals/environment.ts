import { cached } from "@/lib/cache";
import { normalCdf } from "@/lib/live/tracker";
import { getSport } from "@/lib/sports";
import { espnJson, type Json } from "@/lib/sources/espn-http";
import type { GameDetail } from "@/lib/types";
import type { ProviderLines } from "@/lib/sources/espn-props";

/**
 * The game environment for a basketball matchup: how many points the night is priced for, how
 * likely it is to be decided early, and how rested each side is. Every counting-stat leg lives
 * inside it — an over wants possessions and a close game, an under on a starter wants the bench to
 * play the fourth — so it is computed once, in numbers, and handed to the model with a one-line
 * reading. Nothing here calls a model.
 */
const SITE = "https://site.api.espn.com/apis/site/v2/sports";
const SCHEDULE_TTL = 6 * 60 * 60_000;

/** Full-game margin standard deviation over 48 minutes; scaled by the square root of the minutes at stake. */
export const MARGIN_SD_48 = 13;
/** A margin at which starters sit and the closing minutes stop being contested. */
export const BLOWOUT_MARGIN = 15;

/** Regulation minutes of a league's game: 40 in the WNBA, 48 in the NBA. */
export function regulationMinutes(sportKey: string): number {
  return getSport(sportKey).key === "wnba" ? 40 : 48;
}

export function marginSd(regulationMinutes: number, minutesAtStake = regulationMinutes): number {
  return MARGIN_SD_48 * Math.sqrt(Math.max(0, minutesAtStake) / 48);
}

/**
 * P(the final margin, either way, reaches the blowout mark). Before tip-off the expected margin is
 * the spread and every minute is at stake; in play `currentMargin` is the scoreboard and only the
 * minutes left add variance. Sign conventions do not matter: both tails count.
 */
export function blowoutProbability(expectedMargin: number, regulationMinutes: number, minutesLeft = regulationMinutes, currentMargin = 0): number {
  const share = regulationMinutes > 0 ? Math.max(0, Math.min(1, minutesLeft / regulationMinutes)) : 0;
  const mean = currentMargin + expectedMargin * share;
  const sd = marginSd(regulationMinutes, minutesLeft);
  if (sd <= 0) return Math.abs(mean) >= BLOWOUT_MARGIN ? 1 : 0;
  const upper = 1 - normalCdf((BLOWOUT_MARGIN - mean) / sd);
  const lower = normalCdf((-BLOWOUT_MARGIN - mean) / sd);
  return Math.max(0, Math.min(1, upper + lower));
}

/** The blowout rate of a pick'em: the baseline every game log already contains. */
export const baselineBlowout = (regulationMinutes: number) => blowoutProbability(0, regulationMinutes);

export interface TeamForm {
  abbreviation: string;
  games: number;
  pointsFor: number;
  pointsAgainst: number;
  /** Average combined score of this team's games — its scoring environment. */
  averageTotal: number;
  last5Total: number;
  /** Average margin over the last five, positive when winning. */
  last5Margin: number;
  restDays: number | null;
  backToBack: boolean;
  gamesInLastWeek: number;
}

export interface GameEnvironment {
  home: TeamForm | null;
  away: TeamForm | null;
  regulationMinutes: number;
  /** Home handicap as the book prints it: negative when home is favoured. */
  spread: number | null;
  total: number | null;
  /** Average of the two teams' own game totals — what a normal night between them scores. */
  seasonTotal: number | null;
  /** Book total minus the season number: positive means the market prices a faster night. */
  paceDelta: number | null;
  blowoutProbability: number;
  baselineBlowout: number;
  favourite: string | null;
  reading: string;
}

/** ESPN numbers NBA seasons by the year they end; the WNBA by the year they start. */
export function currentSeasonParam(sportKey: string, now = new Date()): number {
  const year = now.getUTCFullYear();
  if (getSport(sportKey).espnLeague !== "nba") return year;
  return now.getUTCMonth() >= 9 ? year + 1 : year;
}

interface ScheduleGame { id: string; date: string; completed: boolean; ownScore: number; oppScore: number }

async function teamSchedule(sportKey: string, teamId: string, season: number): Promise<ScheduleGame[]> {
  const sport = getSport(sportKey);
  if (!teamId) return [];
  return cached(`sched-${sport.key}-${teamId}-${season}`, SCHEDULE_TTL, async () => {
    try {
      const data = await espnJson(`${SITE}/${sport.espnSport}/${sport.espnLeague}/teams/${teamId}/schedule?season=${season}`, { timeoutMs: 6000 });
      const out: ScheduleGame[] = [];
      for (const event of (data.events ?? []) as Json[]) {
        const comp = event.competitions?.[0] ?? {};
        const sides = (comp.competitors ?? []) as Json[];
        const own = sides.find((c) => String(c.team?.id ?? c.id) === String(teamId)) ?? sides.find((c) => c.team?.id === undefined);
        const opp = sides.find((c) => c !== own);
        const score = (c: Json | undefined) => { const v = c?.score; const n = typeof v === "object" ? Number(v?.value ?? v?.displayValue) : Number(v); return Number.isFinite(n) ? n : NaN; };
        out.push({ id: String(event.id ?? ""), date: String(event.date ?? ""), completed: comp.status?.type?.completed === true, ownScore: score(own), oppScore: score(opp) });
      }
      return out.sort((a, b) => a.date.localeCompare(b.date));
    } catch {
      return [];
    }
  });
}

const DAY = 24 * 60 * 60_000;
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const round1 = (x: number) => (Number.isFinite(x) ? Number(x.toFixed(1)) : NaN);

/** Pure: the form block from a schedule, judged at `tipoff`. Exported for the tests. */
export function formFromSchedule(abbreviation: string, schedule: ScheduleGame[], tipoff: Date): TeamForm | null {
  const played = schedule.filter((g) => g.completed && Number.isFinite(g.ownScore) && Number.isFinite(g.oppScore) && Date.parse(g.date) < tipoff.getTime());
  if (played.length < 3) return null;
  const last5 = played.slice(-5);
  const lastDate = Date.parse(played[played.length - 1].date);
  const restDays = Number.isFinite(lastDate) ? Math.floor((tipoff.getTime() - lastDate) / DAY) : null;
  return {
    abbreviation,
    games: played.length,
    pointsFor: round1(mean(played.map((g) => g.ownScore))),
    pointsAgainst: round1(mean(played.map((g) => g.oppScore))),
    averageTotal: round1(mean(played.map((g) => g.ownScore + g.oppScore))),
    last5Total: round1(mean(last5.map((g) => g.ownScore + g.oppScore))),
    last5Margin: round1(mean(last5.map((g) => g.ownScore - g.oppScore))),
    restDays,
    backToBack: restDays !== null && restDays <= 1,
    gamesInLastWeek: played.filter((g) => tipoff.getTime() - Date.parse(g.date) <= 7 * DAY).length,
  };
}

/** The book's current spread and total for the game: DraftKings' live line first, the summary's pickcenter as the fallback. */
export function bookLine(detail: GameDetail, lines: ProviderLines[] = []): { spread: number | null; total: number | null } {
  const dk = lines.find((l) => /draftkings/i.test(l.provider))?.current;
  const book = detail.books[0];
  const spreadFromDetails = () => {
    // "DAL -5.5" names the favourite; the home handicap is negative when the home side is that favourite.
    const m = String(book?.details ?? "").match(/^([A-Z]{2,4})\s*([+-]?\d+(?:\.\d+)?)/);
    if (!m) return null;
    const value = Number(m[2]);
    return m[1] === detail.game.home.abbreviation ? value : -value;
  };
  const spread = dk?.spread ?? spreadFromDetails() ?? (book?.spread !== undefined ? -Math.abs(book.spread) : null);
  const total = dk?.total ?? book?.overUnder ?? detail.game.odds?.overUnder ?? null;
  return { spread: spread !== null && Number.isFinite(spread) ? spread : null, total: total !== null && Number.isFinite(total) ? total : null };
}

/** Pure: the environment from the two forms and the book line. Exported for the tests. */
export function environmentFrom(detail: GameDetail, home: TeamForm | null, away: TeamForm | null, line: { spread: number | null; total: number | null }): GameEnvironment {
  const regulation = regulationMinutes(detail.game.sportKey);
  const seasonTotal = home && away ? round1((home.averageTotal + away.averageTotal) / 2) : home?.averageTotal ?? away?.averageTotal ?? null;
  const paceDelta = line.total !== null && seasonTotal !== null ? round1(line.total - seasonTotal) : null;
  const spread = line.spread;
  const blowout = spread !== null ? blowoutProbability(spread, regulation) : baselineBlowout(regulation);
  const favourite = spread === null || spread === 0 ? null : spread < 0 ? detail.game.home.abbreviation : detail.game.away.abbreviation;
  const parts: string[] = [];
  if (paceDelta !== null) {
    parts.push(paceDelta >= 3 ? `the market prices a faster night than these teams usually play (+${paceDelta}), which favours overs on volume stats`
      : paceDelta <= -3 ? `the market prices a slower night than these teams usually play (${paceDelta}), which favours unders on volume stats`
      : `the market total sits where these teams usually score (${paceDelta >= 0 ? "+" : ""}${paceDelta}), so pace is not an edge either way`);
  }
  parts.push(blowout >= 0.35 ? `blowout risk ${Math.round(blowout * 100)}% (baseline ${Math.round(baselineBlowout(regulation) * 100)}%): starters on ${favourite ?? "the favourite"} are likely to lose fourth-quarter minutes, which favours their unders and caps their overs`
    : blowout <= 0.24 ? `blowout risk ${Math.round(blowout * 100)}%, a coin flip: the starters play the whole night, so an under on a starter is fighting the script`
    : `blowout risk ${Math.round(blowout * 100)}%, close to the baseline: minutes follow the usual pattern`);
  const rest = [home, away].filter((f): f is TeamForm => !!f).filter((f) => f.backToBack || f.gamesInLastWeek >= 4).map((f) => `${f.abbreviation} ${f.backToBack ? "on a back-to-back" : `${f.gamesInLastWeek} games in seven days`}`);
  if (rest.length) parts.push(`fatigue: ${rest.join(", ")} — bench minutes rise and shooting rates dip`);
  return { home, away, regulationMinutes: regulation, spread, total: line.total, seasonTotal, paceDelta, blowoutProbability: Number(blowout.toFixed(3)), baselineBlowout: Number(baselineBlowout(regulation).toFixed(3)), favourite, reading: parts.join("; ") };
}

/** Two cached schedule reads and no model call. Never throws: a missing schedule leaves that side null. */
export async function gameEnvironment(detail: GameDetail, lines: ProviderLines[] = [], now = new Date()): Promise<GameEnvironment | null> {
  const sport = getSport(detail.game.sportKey);
  if (sport.group !== "basketball") return null;
  const tipoff = new Date(detail.game.startsAt);
  const season = currentSeasonParam(sport.key, Number.isFinite(tipoff.getTime()) ? tipoff : now);
  const [homeSchedule, awaySchedule] = await Promise.all([
    teamSchedule(sport.key, detail.game.home.id, season).catch(() => []),
    teamSchedule(sport.key, detail.game.away.id, season).catch(() => []),
  ]);
  const at = Number.isFinite(tipoff.getTime()) ? tipoff : now;
  return environmentFrom(detail, formFromSchedule(detail.game.home.abbreviation, homeSchedule, at), formFromSchedule(detail.game.away.abbreviation, awaySchedule, at), bookLine(detail, lines));
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

export function environmentPrompt(env: GameEnvironment | null): string {
  if (!env) return "GAME ENVIRONMENT: not computed for this matchup.";
  const form = (f: TeamForm | null) => f
    ? `${f.abbreviation}: ${f.pointsFor} for / ${f.pointsAgainst} against per game (${f.games} games), average game total ${f.averageTotal}, last five ${f.last5Total} at ${f.last5Margin >= 0 ? "+" : ""}${f.last5Margin} margin, rest ${f.restDays ?? "?"} day${f.restDays === 1 ? "" : "s"}${f.backToBack ? " (BACK-TO-BACK)" : ""}, ${f.gamesInLastWeek} games in the last 7 days`
    : "form not available";
  return [
    "GAME ENVIRONMENT — computed, no opinion in it:",
    `- ${form(env.away)}`,
    `- ${form(env.home)}`,
    `- market: spread ${env.spread === null ? "?" : `${env.spread > 0 ? "+" : ""}${env.spread} (home)`}, total ${env.total ?? "?"}; these teams' season total ${env.seasonTotal ?? "?"} → pace delta ${env.paceDelta === null ? "?" : `${env.paceDelta > 0 ? "+" : ""}${env.paceDelta}`}`,
    `- blowout risk (final margin ≥ ${BLOWOUT_MARGIN}): ${pct(env.blowoutProbability)} against a ${pct(env.baselineBlowout)} baseline${env.favourite ? `; favourite ${env.favourite}` : ""}`,
    `- reading: ${env.reading}`,
  ].join("\n");
}
