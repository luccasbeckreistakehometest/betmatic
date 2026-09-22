import { baselineBlowout, blowoutProbability } from "@/lib/signals/environment";

/**
 * The minutes projection. Minutes gate every counting-stat leg: the walk-forward test behind
 * props/model.ts showed the rate model with the game's real minutes beating every hit rate by a
 * distance (0.427 against 0.508 log loss) and losing most of that edge once minutes had to be
 * projected. So the projection is explicit, and every input that moves it is printed: the recent
 * trend, the absences that free minutes, the blowout risk that removes them, and in play the foul
 * count and the scoreboard. Nothing here is a model call.
 */
export type Availability = "ok" | "questionable" | "listed_out";

export interface AbsentTeammate {
  name: string;
  status: string;
  /** The absentee's own minutes per game when a log was fetched for them; null when unknown. */
  minutesPerGame: number | null;
  /** This player's minutes in the games the absentee missed and in the games she played, when both have a sample. */
  without?: { games: number; meanMinutes: number; withGames: number; withMinutes: number; recentMissed?: number } | null;
}

export interface MinutesAdjustment {
  kind: "trend" | "absence" | "blowout" | "listing" | "fouls" | "margin" | "rotation";
  minutes: number;
  note: string;
}

export interface MinutesProjection {
  player: string;
  expected: number;
  sd: number;
  baseline: { recent5: number; recent10: number; season: number; trend: number; games: number; sd: number };
  blowoutProbability: number;
  baselineBlowout: number;
  adjustments: MinutesAdjustment[];
  availability: Availability;
  /** In play: minutes already played and the share of the elapsed clock they represent. */
  live?: { played: number; elapsedShare: number; fouls: number; minutesLeft: number };
  note: string;
}

export interface MinutesArgs {
  player: string;
  /** Minutes per logged game, newest first. */
  minutes: number[];
  regulationMinutes: number;
  /** Expected final margin for the game, any sign; the spread before tip-off. Null when unknown. */
  expectedMargin?: number | null;
  absentTeammates?: AbsentTeammate[];
  /** The player's own line on the injury report. */
  listing?: { status: string; updatedAt?: string } | null;
  now?: Date;
}

/** Recency half-life in games for the minutes baseline: minutes follow the current role, not the season. */
export const MINUTES_HALFLIFE = 8;
/** Below this many logged minutes a game is a cameo and says nothing about the role. */
const CAMEO = 4;
/** Minutes a starter typically loses to a decided fourth quarter, per 40 regulation minutes. */
const SIT_MINUTES_PER_40 = 4.5;
const MIN_SD = 2.5;

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const round1 = (x: number) => Number(x.toFixed(1));
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);

function weighted(minutes: number[]): { mean: number; sd: number } {
  let w = 0, s = 0, s2 = 0;
  minutes.forEach((m, i) => { const k = Math.pow(0.5, i / MINUTES_HALFLIFE); w += k; s += k * m; s2 += k * m * m; });
  const mu = s / w;
  return { mean: mu, sd: Math.sqrt(Math.max(s2 / w - mu * mu, 0)) };
}

export function listingAvailability(status: string | undefined | null): Availability {
  const s = (status ?? "").toLowerCase();
  if (!s) return "ok";
  if (/\bout\b|suspen|injured reserve|inactive/.test(s)) return "listed_out";
  if (/doubtful|questionable|day-to-day|day to day|gtd|probable/.test(s)) return "questionable";
  return "ok";
}

/**
 * Before tip-off. The baseline is the recency-weighted mean of the logged minutes with a nudge
 * toward the last five (a role that just changed is visible there first); the walk-forward test
 * measured that baseline at a 4.7-minute mean absolute error with a spread that covered 67% of
 * outcomes at one standard deviation, and a 0.7-minute low bias that the trend term absorbs.
 */
export function projectMinutes(args: MinutesArgs): MinutesProjection | null {
  const logged = args.minutes.filter((m) => Number.isFinite(m) && m >= 0);
  const played = logged.filter((m) => m >= CAMEO);
  if (played.length < 3) return null;
  const w = weighted(played);
  const recent5 = mean(played.slice(0, 5));
  const recent10 = mean(played.slice(0, 10));
  const season = mean(played);
  const trend = round1(recent5 - w.mean);
  const adjustments: MinutesAdjustment[] = [];
  let expected = w.mean;
  let variance = Math.max(w.sd, MIN_SD) ** 2;

  // Half of the gap between the last five and the weighted mean, capped: recency wins, gently.
  const trendNudge = clamp(0.5 * (recent5 - w.mean), -2, 2);
  if (Math.abs(trendNudge) >= 0.3) {
    expected += trendNudge;
    adjustments.push({ kind: "trend", minutes: round1(trendNudge), note: `last five ${recent5.toFixed(0)} vs weighted ${w.mean.toFixed(0)} (season ${season.toFixed(0)})` });
  }

  // Cameos in the log mean the role has been pulled before: they widen the spread, not the mean.
  const cameos = logged.length - played.length;
  if (cameos > 0) variance += (cameos / logged.length) * 25;

  // Absences free minutes. A measured "without" split answers it directly; otherwise a modest,
  // labelled nudge per rotation-level absentee, capped so a long injury list cannot invent a role.
  let absenceTotal = 0;
  for (const mate of args.absentTeammates ?? []) {
    if (listingAvailability(mate.status) !== "listed_out") continue;
    if (mate.without && mate.without.games >= 3 && mate.without.withGames >= 3) {
      // An absentee already missing from most of the last five games is in the recency-weighted
      // baseline: counting the split again would double the same minutes.
      if ((mate.without.recentMissed ?? 0) >= 3) {
        adjustments.push({ kind: "absence", minutes: 0, note: `${mate.name} out: already in the last five (${mate.without.meanMinutes.toFixed(0)} min without her vs ${mate.without.withMinutes.toFixed(0)} with)` });
        continue;
      }
      // Half the measured with/without gap: the games without her were also a different stretch of the season.
      const shift = clamp(0.5 * (mate.without.meanMinutes - mate.without.withMinutes), -3, 5);
      if (Math.abs(shift) < 0.3) continue;
      absenceTotal += shift;
      adjustments.push({ kind: "absence", minutes: round1(shift), note: `${mate.name} out: ${mate.without.meanMinutes.toFixed(0)} min in the ${mate.without.games} games without her vs ${mate.without.withMinutes.toFixed(0)} in ${mate.without.withGames} with (half-weighted)` });
    } else if (mate.without === null && mate.minutesPerGame !== null && mate.minutesPerGame < 15) {
      continue; // a deep-bench absentee frees nothing worth a line
    } else if (mate.minutesPerGame === null || mate.minutesPerGame >= 15) {
      absenceTotal += 0.8;
      adjustments.push({ kind: "absence", minutes: 0.8, note: `${mate.name} out${mate.minutesPerGame !== null ? ` (${mate.minutesPerGame.toFixed(0)} min/game)` : ""}: minutes freed, share unmeasured` });
    }
  }
  expected += clamp(absenceTotal, -4, 4);

  // Blowout risk relative to the baseline the log already contains: only the excess costs minutes.
  const baseRisk = baselineBlowout(args.regulationMinutes);
  const risk = args.expectedMargin !== null && args.expectedMargin !== undefined ? blowoutProbability(args.expectedMargin, args.regulationMinutes) : baseRisk;
  const sit = SIT_MINUTES_PER_40 * (args.regulationMinutes / 40);
  const starterLike = w.mean >= 0.6 * args.regulationMinutes;
  if (starterLike && Math.abs(risk - baseRisk) >= 0.03) {
    const shift = -(risk - baseRisk) * sit;
    expected += shift;
    adjustments.push({ kind: "blowout", minutes: round1(shift), note: `blowout risk ${Math.round(risk * 100)}% vs ${Math.round(baseRisk * 100)}% baseline` });
  }
  variance += risk * (1 - risk) * sit * sit;

  const availability = listingAvailability(args.listing?.status);
  if (availability === "questionable") {
    variance += 9;
    adjustments.push({ kind: "listing", minutes: 0, note: `listed ${args.listing?.status}: a minutes cap or a scratch is possible` });
  } else if (availability === "listed_out") {
    adjustments.push({ kind: "listing", minutes: 0, note: `listed ${args.listing?.status}${args.listing?.updatedAt ? ` (${args.listing.updatedAt.slice(0, 10)})` : ""}: confirm before any leg; if she sits every line on her is void` });
  }

  expected = clamp(expected, 0, args.regulationMinutes);
  const sd = Math.sqrt(variance);
  return {
    player: args.player,
    expected: round1(expected),
    sd: round1(sd),
    baseline: { recent5: round1(recent5), recent10: round1(recent10), season: round1(season), trend, games: played.length, sd: round1(w.sd) },
    blowoutProbability: Number(risk.toFixed(3)),
    baselineBlowout: Number(baseRisk.toFixed(3)),
    adjustments,
    availability,
    note: `${expected.toFixed(0)} ± ${sd.toFixed(0)} min (L5 ${recent5.toFixed(0)}, L10 ${recent10.toFixed(0)}, season ${season.toFixed(0)} over ${played.length} games${adjustments.length ? `; ${adjustments.map((a) => `${a.minutes > 0 ? "+" : ""}${a.minutes} ${a.kind}`).join(", ")}` : ""})`,
  };
}

export interface RemainingArgs {
  player: string;
  preGame: MinutesProjection | null;
  minutesPlayed: number;
  minutesElapsed: number;
  minutesLeft: number;
  regulationMinutes: number;
  fouls: number;
  /** Scoreboard margin now (any sign) and the pre-game expected margin (the spread), for the blowout read. */
  currentMargin: number;
  expectedMargin?: number | null;
  /** Fouls that disqualify a player in this league (6 in the NBA and WNBA). */
  foulLimit?: number;
}

/**
 * In play: what is left of the player's night. Tonight's share of the clock is blended with the
 * pre-game share, weighting tonight more as the game goes; then the foul count and the scoreboard
 * take their cut. The spread of the estimate narrows as regulation runs out.
 */
export function projectRemainingMinutes(args: RemainingArgs): MinutesProjection {
  const reg = args.regulationMinutes;
  const left = Math.max(0, args.minutesLeft);
  const elapsed = Math.max(0, args.minutesElapsed);
  const shareTonight = elapsed > 0 ? clamp(args.minutesPlayed / elapsed, 0, 1) : NaN;
  const sharePre = args.preGame ? clamp(args.preGame.expected / reg, 0, 1) : NaN;
  const adjustments: MinutesAdjustment[] = [];
  let share: number;
  if (Number.isFinite(shareTonight) && Number.isFinite(sharePre)) {
    const w = clamp(0.5 + 0.5 * (elapsed / reg), 0.5, 0.9);
    share = w * shareTonight + (1 - w) * sharePre;
    adjustments.push({ kind: "rotation", minutes: 0, note: `on court ${Math.round(shareTonight * 100)}% of the clock tonight vs ${Math.round(sharePre * 100)}% pre-game` });
  } else if (Number.isFinite(shareTonight)) share = shareTonight;
  else if (Number.isFinite(sharePre)) share = sharePre;
  else share = 0.6;
  let expected = share * left;

  const limit = args.foulLimit ?? 6;
  const foulsLeft = limit - args.fouls;
  if (left > 0 && foulsLeft <= 1) {
    const cut = 0.4 * expected;
    expected -= cut;
    adjustments.push({ kind: "fouls", minutes: round1(-cut), note: `${args.fouls} fouls: one from disqualification, likely to sit stretches` });
  } else if (left > 10 && foulsLeft === 2) {
    const cut = 0.15 * expected;
    expected -= cut;
    adjustments.push({ kind: "fouls", minutes: round1(-cut), note: `${args.fouls} fouls with ${Math.round(left)} min left: foul trouble` });
  } else if (left > 25 && foulsLeft === 3) {
    const cut = 0.07 * expected;
    expected -= cut;
    adjustments.push({ kind: "fouls", minutes: round1(-cut), note: `${args.fouls} fouls early` });
  }

  const baseRisk = baselineBlowout(reg);
  const risk = blowoutProbability(args.expectedMargin ?? 0, reg, left, args.currentMargin);
  const sit = 0.4 * Math.min(left, 12);
  const starterLike = share >= 0.6;
  if (starterLike && left > 0 && Math.abs(risk - baseRisk) >= 0.03) {
    const shift = -(risk - baseRisk) * sit;
    expected += shift;
    adjustments.push({ kind: "margin", minutes: round1(shift), note: `margin ${Math.abs(args.currentMargin)} with ${Math.round(left)} min left: blowout risk ${Math.round(risk * 100)}% vs ${Math.round(baseRisk * 100)}%` });
  }

  expected = clamp(expected, 0, left);
  const sd = left > 0 ? Math.max(1, 0.12 * left + Math.sqrt(risk * (1 - risk)) * sit) : 0;
  const pre = args.preGame;
  return {
    player: args.player,
    expected: round1(expected),
    sd: round1(sd),
    baseline: pre?.baseline ?? { recent5: NaN, recent10: NaN, season: NaN, trend: 0, games: 0, sd: NaN },
    blowoutProbability: Number(risk.toFixed(3)),
    baselineBlowout: Number(baseRisk.toFixed(3)),
    adjustments,
    availability: "ok",
    live: { played: args.minutesPlayed, elapsedShare: Number((Number.isFinite(shareTonight) ? shareTonight : 0).toFixed(2)), fouls: args.fouls, minutesLeft: left },
    note: `${args.minutesPlayed} played of ${Math.round(elapsed)}; ~${expected.toFixed(0)} ± ${sd.toFixed(0)} of the ${Math.round(left)} left${adjustments.filter((a) => a.minutes !== 0).length ? ` (${adjustments.filter((a) => a.minutes !== 0).map((a) => `${a.minutes > 0 ? "+" : ""}${a.minutes} ${a.kind}`).join(", ")})` : ""}`,
  };
}

/** The minutes block of the prompt: one line per player, inputs included. */
export function minutesPrompt(projections: MinutesProjection[]): string {
  if (!projections.length) return "MINUTES PROJECTION: not computed.";
  return [
    "MINUTES PROJECTION — computed from the game log, the injury report and the spread; the number every counting-stat leg stands on:",
    ...projections.slice(0, 14).map((p) => {
      const flag = p.availability === "listed_out" ? " ⚠ LISTED OUT" : p.availability === "questionable" ? " ⚠ questionable" : "";
      const inputs = p.adjustments.length ? ` — ${p.adjustments.map((a) => `${a.kind}: ${a.minutes > 0 ? "+" : ""}${a.minutes} (${a.note})`).join("; ")}` : "";
      return `- ${p.player}: ${p.expected} ± ${p.sd} min${flag}; L5 ${p.baseline.recent5}, L10 ${p.baseline.recent10}, season ${p.baseline.season} (${p.baseline.games} games), blowout risk ${Math.round(p.blowoutProbability * 100)}%${inputs}`;
    }),
    "A leg needs the minutes before it needs anything else. Treat a LISTED OUT player as unplayable until the report changes; a questionable one widens every line on her.",
  ].join("\n");
}
