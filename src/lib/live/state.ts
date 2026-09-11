/**
 * In-play state and the maths that separates a live read from a pre-match one.
 *
 * The point of live mode: a pre-match estimate answers "what happens across 90 minutes". Once the
 * clock runs, the question becomes "what happens in the time that is left, given what already
 * happened". A referee averaging 5.3 cards who has shown none at minute 10 tells you nothing; the
 * same zero at minute 70 is a strong signal against a cards over. Time is the whole feature.
 */
export interface LiveState {
  minute: number;
  homeGoals: number;
  awayGoals: number;
  homeCards: number;
  awayCards: number;
  homeFouls: number;
  awayFouls: number;
}

export const FULL_MATCH = 90;

export function remainingFraction(minute: number): number {
  return Math.max(0, Math.min(1, (FULL_MATCH - minute) / FULL_MATCH));
}

/** Poisson tail: chance of at least `needed` more events given a rate for the remaining time. */
export function poissonAtLeast(needed: number, lambda: number): number {
  if (needed <= 0) return 1;
  if (lambda <= 0) return 0;
  let cumulative = 0;
  let term = Math.exp(-lambda);
  for (let k = 0; k < needed; k += 1) {
    cumulative += term;
    term = (term * lambda) / (k + 1);
  }
  return Math.max(0, Math.min(1, 1 - cumulative));
}

export interface LiveLineRead {
  line: number;
  alreadyHappened: number;
  stillNeeded: number;
  expectedRemaining: number;
  probability: number;
  note: string;
}

/** Re-prices an over line mid-match. `fullMatchRate` is the expected 90-minute total. */
export function readOverLine(
  line: number,
  alreadyHappened: number,
  fullMatchRate: number,
  minute: number,
  lang: "pt" | "en" = "pt",
): LiveLineRead {
  const stillNeeded = Math.max(0, Math.floor(line + 1) - alreadyHappened);
  const expectedRemaining = fullMatchRate * remainingFraction(minute);
  const probability = poissonAtLeast(stillNeeded, expectedRemaining);
  const left = Math.round(FULL_MATCH - minute);
  const note =
    stillNeeded === 0
      ? lang === "pt" ? `linha já batida: ${alreadyHappened} contra ${line}` : `already cleared: ${alreadyHappened} vs ${line}`
      : lang === "pt"
        ? `faltam ${stillNeeded} em ${left} minutos; esperado no tempo restante: ${expectedRemaining.toFixed(2)}`
        : `${stillNeeded} more needed in ${left} minutes; expected in the time left: ${expectedRemaining.toFixed(2)}`;
  return { line, alreadyHappened, stillNeeded, expectedRemaining, probability, note };
}

/** How much an absence of events should move the read — almost nothing early, a lot late. */
export function absenceSignal(minute: number, lang: "pt" | "en" = "pt"): string {
  const pct = Math.round((minute / FULL_MATCH) * 100);
  if (minute < 20)
    return lang === "pt"
      ? `Apenas ${pct}% do jogo passou — o que ainda não aconteceu não é informação, e a leitura segue praticamente a do pré-jogo.`
      : `Only ${pct}% gone — what has not happened yet is not information; the read is still essentially pre-match.`;
  if (minute < 60)
    return lang === "pt"
      ? `${pct}% do jogo passou: a ausência de eventos começa a pesar, mas ainda há tempo para a média se cumprir.`
      : `${pct}% gone: an absence of events starts to matter, but there is still time for the average to arrive.`;
  return lang === "pt"
    ? `${pct}% do jogo passou — a essa altura o que não aconteceu é sinal forte, e linhas de over ficam caras mesmo pagando bem.`
    : `${pct}% gone — by now what has not happened is a strong signal, and over lines stay expensive even at a big price.`;
}

export function livePrompt(state: LiveState, refereeCardsPerGame: number | null, lang: "pt" | "en" = "pt"): string {
  const left = Math.round(FULL_MATCH - state.minute);
  const cards = state.homeCards + state.awayCards;
  const out = [
    lang === "pt"
      ? `AO VIVO — minuto ${state.minute} (${left} restantes), placar ${state.homeGoals}-${state.awayGoals}, ${cards} cartões, ${state.homeFouls + state.awayFouls} faltas.`
      : `LIVE — minute ${state.minute} (${left} left), score ${state.homeGoals}-${state.awayGoals}, ${cards} cards, ${state.homeFouls + state.awayFouls} fouls.`,
    absenceSignal(state.minute, lang),
  ];
  if (refereeCardsPerGame) {
    const r = readOverLine(4.5, cards, refereeCardsPerGame, state.minute, lang);
    out.push(
      lang === "pt"
        ? `Cartões: o árbitro projeta ${refereeCardsPerGame.toFixed(2)} no jogo inteiro. Para mais de 4,5 — ${r.note}. Chance estimada: ${(r.probability * 100).toFixed(0)}%.`
        : `Cards: referee projects ${refereeCardsPerGame.toFixed(2)} for a full match. For over 4.5 — ${r.note}. Estimated chance: ${(r.probability * 100).toFixed(0)}%.`,
    );
  }
  out.push(
    lang === "pt"
      ? "Use apenas preços ao vivo e diga o minuto da leitura — odd ao vivo sem horário é inútil, ela muda a cada lance."
      : "Use only live prices and state the minute of the read — a live price with no timestamp is useless; it moves on every phase.",
  );
  return out.join("\n");
}
