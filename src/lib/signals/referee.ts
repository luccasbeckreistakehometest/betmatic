import { findEvent, getEvent, type SofaReferee } from "@/lib/sources/sofascore";

/**
 * League baseline for yellow cards in a match, from published aggregates: roughly 1.5 to the home
 * side and 2 to the away side. Used only to express a referee as a ratio, never as a prediction.
 */
const BASELINE_YELLOWS_PER_GAME = 3.5;

export interface RefereeSignal {
  name: string;
  country?: string;
  games: number;
  yellowsPerGame: number;
  redsPerGame: number;
  secondYellowsPerGame: number;
  /** 1.0 is league average. 1.3 means 30% more cards than a typical match. */
  strictnessIndex: number;
  tier: "very strict" | "strict" | "average" | "lenient";
  /** Sample size decides whether this is usable at all. */
  confidence: "high" | "medium" | "low";
  note: string;
}

export function scoreReferee(referee: SofaReferee): RefereeSignal | null {
  const games = referee.games ?? 0;
  if (games < 20) return null;

  const yellowsPerGame = referee.yellowCards / games;
  const redsPerGame = referee.redCards / games;
  const secondYellowsPerGame = (referee.yellowRedCards ?? 0) / games;
  const strictnessIndex = yellowsPerGame / BASELINE_YELLOWS_PER_GAME;

  const tier =
    strictnessIndex >= 1.25 ? "very strict"
    : strictnessIndex >= 1.08 ? "strict"
    : strictnessIndex <= 0.85 ? "lenient"
    : "average";

  return {
    name: referee.name,
    country: referee.country?.name,
    games,
    yellowsPerGame: Number(yellowsPerGame.toFixed(2)),
    redsPerGame: Number(redsPerGame.toFixed(3)),
    secondYellowsPerGame: Number(secondYellowsPerGame.toFixed(3)),
    strictnessIndex: Number(strictnessIndex.toFixed(2)),
    tier,
    confidence: games >= 150 ? "high" : games >= 60 ? "medium" : "low",
    note: `${referee.yellowCards} amarelos em ${games} jogos`,
  };
}

export async function refereeForMatch(
  homeName: string,
  awayName: string,
  dateKey: string,
): Promise<RefereeSignal | null> {
  const event = await findEvent(homeName, awayName, dateKey).catch(() => null);
  if (!event) return null;
  // The scheduled-events payload sometimes omits the referee; the event detail carries it.
  const referee = event.referee ?? (await getEvent(event.id).catch(() => null))?.referee;
  return referee ? scoreReferee(referee) : null;
}

/**
 * The prompt block. Referee assignment is public and the research is blunt about why it is worth
 * reading: card markets get little sharp attention, so the price rarely reflects who is officiating.
 */
export function refereePrompt(signal: RefereeSignal | null): string {
  if (!signal) return "REFEREE: not published for this match — do not assume a card environment.";
  const direction =
    signal.tier === "very strict" || signal.tier === "strict"
      ? "above"
      : signal.tier === "lenient"
        ? "below"
        : "around";
  return [
    `REFEREE: ${signal.name}${signal.country ? ` (${signal.country})` : ""} — ${signal.yellowsPerGame} yellows per game across ${signal.games} matches, ${signal.redsPerGame} reds.`,
    `That is ${signal.strictnessIndex}x the ~${BASELINE_YELLOWS_PER_GAME}/game league baseline, i.e. ${direction} average (${signal.tier}). Sample confidence: ${signal.confidence}.`,
    signal.confidence === "low"
      ? "Sample is thin — mention the referee only as context, never as the reason for a leg."
      : "Card and foul markets attract little sharp money, so this is often the least-priced public information in the match. Use it to justify card or foul legs, and say the referee is the reason.",
  ].join("\n");
}
