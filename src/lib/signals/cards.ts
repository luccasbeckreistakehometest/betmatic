import { poissonAtLeast } from "@/lib/live/state";

/**
 * Expected cards in a match.
 *
 * Written after getting this wrong. On 2026-09-10 the referee's career average alone put over 4.5
 * cards at 68% for Independiente del Valle v Flamengo; the match produced 3, and that single leg
 * lost four of six tickets. The information that would have corrected it was on the page being
 * scraped: Betano itself published that Flamengo averaged 0.8 yellows per game in that competition.
 *
 * A referee does not hand out his average to every pair of teams — he amplifies or dampens what the
 * teams themselves bring. So the model is multiplicative: the teams' own card rates set the level,
 * and the referee scales it. Referee-only reasoning systematically over-predicts against
 * well-disciplined sides.
 */
export const LEAGUE_CARDS_BASELINE = 3.5;

export interface CardExpectation {
  teamsExpected: number;
  refereeFactor: number;
  expected: number;
  /** Set when a team rate had to be assumed rather than measured. */
  assumed: string[];
  note: string;
}

export function expectedCards(input: {
  homeCardsPerGame: number | null;
  awayCardsPerGame: number | null;
  refereeCardsPerGame: number | null;
  /** Knockout and derby fixtures run hotter; 1.0 means no adjustment. */
  stakesMultiplier?: number;
}): CardExpectation {
  const assumed: string[] = [];
  // A missing team rate falls back to half the league baseline — one team's share of an average match.
  const home = input.homeCardsPerGame ?? (assumed.push("mandante"), LEAGUE_CARDS_BASELINE / 2);
  const away = input.awayCardsPerGame ?? (assumed.push("visitante"), LEAGUE_CARDS_BASELINE / 2);
  const teamsExpected = home + away;

  const refereeFactor = input.refereeCardsPerGame
    ? input.refereeCardsPerGame / LEAGUE_CARDS_BASELINE
    : (assumed.push("árbitro"), 1);

  const stakes = input.stakesMultiplier ?? 1;
  const expected = teamsExpected * refereeFactor * stakes;

  return {
    teamsExpected: Number(teamsExpected.toFixed(2)),
    refereeFactor: Number(refereeFactor.toFixed(2)),
    expected: Number(expected.toFixed(2)),
    assumed,
    note: `times ${teamsExpected.toFixed(1)} × árbitro ${refereeFactor.toFixed(2)}x${stakes !== 1 ? ` × contexto ${stakes}x` : ""} = ${expected.toFixed(2)} esperados${assumed.length ? ` (assumido: ${assumed.join(", ")})` : ""}`,
  };
}

export function cardsOverProbability(line: number, expectation: CardExpectation): number {
  return poissonAtLeast(Math.floor(line + 1), expectation.expected);
}

export function cardsPrompt(expectation: CardExpectation, line = 4.5): string {
  const p = cardsOverProbability(line, expectation);
  return [
    `CARTÕES — esperado ${expectation.expected} (${expectation.note}).`,
    `Mais de ${line}: ${(p * 100).toFixed(0)}%.`,
    "A média do árbitro NÃO é a previsão: ela é um multiplicador sobre a disciplina dos times. Contra um time disciplinado, raciocinar só pelo árbitro superestima — foi assim que este modelo errou antes.",
    expectation.assumed.length
      ? `Atenção: ${expectation.assumed.join(" e ")} usaram valor assumido, não medido. Trate a estimativa como fraca.`
      : "",
  ].filter(Boolean).join("\n");
}
