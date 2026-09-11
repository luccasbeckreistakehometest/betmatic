import { poissonAtLeast } from "@/lib/live/state";

/**
 * Goalkeeper saves.
 *
 * Written after getting this wrong. The reasoning was "the home side presses at altitude, so the
 * keeper works" and it put 5+ saves at 47%. The home side did press — 18 shots, 62.7% possession,
 * 10 corners — and the keeper made exactly 3 saves, because only 3 of those 18 shots were on
 * target. Pressure was real; the conversion step was missing.
 *
 * A save requires a shot ON TARGET. Modelling saves from shots skips a funnel that typically keeps
 * only a quarter to a third of attempts, so it over-predicts badly for a side that shoots from
 * distance — which is exactly what a team playing at altitude does.
 */
export const TYPICAL_ON_TARGET_RATE = 0.32;

export interface SaveExpectation {
  shotsExpected: number;
  onTargetRate: number;
  onTargetExpected: number;
  /** Not every shot on target is saved — some go in, some are blocked on the line. */
  savesExpected: number;
  note: string;
}

export function expectedSaves(input: {
  opponentShotsPerGame: number;
  /** Measured on-target rate for this opponent; the league default is a poor substitute. */
  onTargetRate?: number | null;
  expectedGoalsConceded?: number;
}): SaveExpectation {
  const rate = input.onTargetRate ?? TYPICAL_ON_TARGET_RATE;
  const onTarget = input.opponentShotsPerGame * rate;
  // Shots on target minus the ones that beat the keeper.
  const saves = Math.max(0, onTarget - (input.expectedGoalsConceded ?? 0));

  return {
    shotsExpected: Number(input.opponentShotsPerGame.toFixed(1)),
    onTargetRate: Number(rate.toFixed(2)),
    onTargetExpected: Number(onTarget.toFixed(2)),
    savesExpected: Number(saves.toFixed(2)),
    note: `${input.opponentShotsPerGame.toFixed(0)} chutes × ${(rate * 100).toFixed(0)}% no alvo = ${onTarget.toFixed(1)} no alvo${input.expectedGoalsConceded ? `, menos ${input.expectedGoalsConceded} gol(s) esperado(s)` : ""} → ${saves.toFixed(1)} defesas`,
  };
}

export function savesOverProbability(line: number, expectation: SaveExpectation): number {
  return poissonAtLeast(Math.floor(line + 1), expectation.savesExpected);
}

export function savesPrompt(expectation: SaveExpectation, line: number): string {
  return [
    `DEFESAS DO GOLEIRO — esperado ${expectation.savesExpected} (${expectation.note}).`,
    `Mais de ${line}: ${(savesOverProbability(line, expectation) * 100).toFixed(0)}%.`,
    "Defesa exige chute NO ALVO. Nunca projete defesas a partir de volume de chute ou de posse: um time que pressiona de longe gera muito chute e pouco trabalho para o goleiro.",
  ].join("\n");
}
