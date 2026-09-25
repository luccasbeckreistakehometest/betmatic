import { getBand } from "@/lib/odds";
import type { BetSuggestion } from "@/lib/types";

/**
 * "As múltiplas do dia entre jogos": the shape the daily cross-game build aims at, and why it is
 * this shape and not the one the on-demand slate has been asking for.
 *
 * WHY A CROSS-GAME TICKET IS THE HONEST ONE. A book does not discount a combination across
 * different matches: it multiplies the prices, because the two results have nothing to do with each
 * other. Verified on 23/09/2026 by opening a built link with two selections from two WNBA games —
 * Superbet priced the double at 8.17 = 1.72 x 4.75, Sportingbet the same way (sources/br-books/
 * coverage.ts carries the note beside the code that builds the link). On a SAME-GAME pair the book
 * reprices and the product overstates the payout. So the number this section prints is the number
 * the reader will be charged, by construction — which is not true of a same-game múltipla.
 *
 * WHY THE WINDOW IS SHORT. Measured on the production ledger of 23/09/2026
 * (__tests__/fixtures/ledger-prod-20260923.jsonl, 353 tickets, 322 settled), pre-game only — the
 * live reads are a different population and mixing them in is how a losing pre-game record hides
 * behind a winning in-play one:
 *
 *   under 2.00x   21 settled, 10 green (47.6%), -24.8%
 *   2.00-5.00x    19 settled,  7 green (36.8%), +20.3%   <- the only slice that paid
 *   5.00x and up  52 settled,  2 green ( 3.8%), -71.3%
 *   20.00x and up 33 settled,  0 green            -100%  (34 rows with the voided one)
 *
 * The bands the on-demand slate asks for today are long (20-100x), moonshot (100-500x) and lottery
 * (500x+) — the whole of that last line, the one with no winners at all. That ask is also why the
 * section was empty on 23/09: with two games on the board and one leg per game, the longest ticket
 * arithmetically possible is a double, and the requested bands start at four legs.
 *
 * WHY THE DOUBLE IS THE DEFAULT SHAPE. The ticket-level slice above is thin (19 rows), so the same
 * question was asked of the LEGS, which are many. Taking every settled pre-game leg of 22/09/2026
 * (85 lines over the 5 games of that night) and forming every combination that obeys this file's
 * rules — one line per game, one line per player — gives:
 *
 *   2 legs, 2.00-5.00x   2 600 combinations, 24.0% green, -23.4%
 *   3 legs, 2.00-5.00x  11 576 combinations, 10.7% green, -54.2%
 *   2-3 legs, 5-20x     34 574 combinations, 10.6% green, -30.0%
 *   2-3 legs, 20x+          26 combinations,  0   green,  -100%
 *
 * The double beats the triple at the same price, on every measure, by a lot. So a daily múltipla is
 * a double, and the third leg exists only for the night when the two best lines do not multiply to
 * CROSS_MIN_DECIMAL on their own. Nothing here claims the window is profitable: one bad night
 * dominates the sample and the honest reading is about SHAPE — short beats long, two legs beat
 * three, and above 20x there is nothing to defend.
 */

/**
 * ── 25/09/2026: the owner widened this window, knowing what is measured above. ────────────────────
 *
 * Everything written above this line is the measurement and it still stands: on the production
 * ledger the short double is the only cross-game shape that ever paid, and above 20x there is
 * nothing to defend. Re-measured on the corrected ledger of 25/09 (573 decided, after the settling
 * bug that had voided 99 tickets was repaired) the pre-game picture did not improve:
 *
 *   3-5x     36 tickets, 30.6% green,   +1.3%   <- still the only band above water
 *   5-10x    43 tickets,  4.7% green,  -65.3%
 *   10-20x    5 tickets,    0 green,   -100%
 *   20-50x   42 tickets,  2.4% green,  -32.5%
 *   50x+     21 tickets,    0 green,   -100%
 *
 * The instruction is to build the day's múltiplas from WHOLE TICKETS of different games — game A's
 * 30x with game B's 25x — and to publish at least ten a day. That is a deliberate product decision
 * taken with these numbers on the table, not an oversight, and it is recorded here so nobody later
 * "fixes" it back by accident. What the code still refuses to do is invent: a combination is only
 * ever formed from tickets that already cleared every gate on their own.
 */

/** The floor. Below it the ledger says -24.8% over 21 settled tickets: a short double is not a bet. */
export const CROSS_MIN_DECIMAL = 2;
/**
 * The ceiling, as MEASURED. Kept as the honest marker of where the evidence stops, and used to flag
 * a combination as beyond it — no longer to refuse one. See `CROSS_HARD_MAX_DECIMAL`.
 */
export const CROSS_MEASURED_MAX_DECIMAL = 5;
/**
 * The ceiling the code enforces. Two whole tickets of 30x and 25x multiply to 750x, which is the
 * shape asked for; this exists only so an arithmetic accident cannot publish a number in the
 * millions.
 */
export const CROSS_HARD_MAX_DECIMAL = 2000;
/** Kept for the callers that still read it; it is the measured ceiling, not a gate. */
export const CROSS_MAX_DECIMAL = CROSS_MEASURED_MAX_DECIMAL;
/** A múltipla entre jogos is at least a double — a single is not a combination. */
export const CROSS_MIN_LEGS = 2;
/**
 * A combination of whole tickets carries the legs of both, so a 4-leg ticket with a 3-leg one is a
 * 7-leg múltipla. The cap is the two fronts' worst case plus room, and it is still a cap: past it
 * the ticket is a pile, not a story.
 */
export const CROSS_MAX_LEGS = 12;
/** The owner's floor of 25/09/2026: at least ten a day, mixing tickets from different matches. */
export const CROSS_MIN_TICKETS_PER_DAY = 10;
/**
 * There is no maximum any more — the owner removed it on 25/09/2026, in these words: "nao vamos
 * colocar quantidade maxima de bilhetes ou multiplas, apenas qtd minima".
 *
 * The reasoning offered was that a 0.5 u stake on a long price pays for several attempts, so more
 * combinations cover more of the board. The arithmetic of that is worth writing down beside it,
 * because it is the thing a count cannot fix: staking 0.5 u on N tickets costs 0.5N and one winner
 * at X returns 0.5X, so the portfolio profits only when X > N. The measured 20-50x band is 1 green
 * in 42 and returns -32.5% — which IS that calculation, done on what happened. Adding tickets does
 * not move the expectation, it moves the variance: it covers more of the board and makes the same
 * edge arrive more regularly.
 *
 * The number is kept as a very high backstop rather than deleted, so an arithmetic accident cannot
 * publish ten thousand rows, and `topCrossTickets` still orders by evidence so the best are first.
 */
export const CROSS_MAX_TICKETS = 200;
/** Asked of the model, so it proposes more than survives the gate below. */
export const CROSS_PER_BAND = 4;
/** The grid this needs: two games, which is the whole point of "entre jogos". */
export const CROSS_MIN_GAMES = 2;

/**
 * The band asked of the model. `value` is 2x-5x in lib/odds.ts, which is exactly the window above,
 * so the words the prompt understands and the gate the code enforces say the same thing. The band a
 * ticket ENDS UP in is recomputed from its real price in builder.ts, so this is an ask, not a label.
 */
export const CROSS_BANDS = ["value"];

/** The window, in the reader's own decimal mark, for a data note or a prompt line. */
export const crossWindowLabel = (lang: "pt" | "en"): string =>
  lang === "pt"
    ? `${CROSS_MIN_DECIMAL.toFixed(2).replace(".", ",")}x a ${CROSS_MAX_DECIMAL.toFixed(2).replace(".", ",")}x`
    : `${CROSS_MIN_DECIMAL.toFixed(2)}x to ${CROSS_MAX_DECIMAL.toFixed(2)}x`;

/**
 * Why this ticket is not one of the day's múltiplas, or null when it is one.
 *
 * This is a gate in the sense bets/gates.ts means it: the ticket is dropped whole, never rewritten,
 * and the reason travels with the drop so the ops log says what happened. It is checked in code and
 * not left to the prompt, for the reason that file gives — a rule the model polices is a preference.
 *
 * The leg count is checked before the price so the drop names the thing a reader would name: a
 * four-leg ticket is refused for being four legs, whatever it costs.
 */
export function crossShapeReason(bet: Pick<BetSuggestion, "legs" | "combinedDecimal">): string | null {
  const legs = bet.legs.length;
  if (legs < CROSS_MIN_LEGS) return `${legs} leg${legs === 1 ? "" : "s"}: a cross-game múltipla needs at least ${CROSS_MIN_LEGS}`;
  if (legs > CROSS_MAX_LEGS) return `${legs} legs, over the ${CROSS_MAX_LEGS} the daily cross-game window allows`;
  const d = bet.combinedDecimal;
  if (!Number.isFinite(d)) return "no computed price";
  if (d < CROSS_MIN_DECIMAL) return `${d.toFixed(2)}x, under the ${CROSS_MIN_DECIMAL.toFixed(2)}x floor`;
  // The measured ceiling is no longer a refusal (see the 25/09 note above): it is a label the reader
  // gets, not a gate. Only the arithmetic backstop refuses.
  if (d >= CROSS_HARD_MAX_DECIMAL) return `${d.toFixed(2)}x, past the ${CROSS_HARD_MAX_DECIMAL}x backstop`;
  return null;
}

/**
 * The day's list, cut to CROSS_MAX_TICKETS.
 *
 * The order prefers the evidence computed from the legs over the model's own claim, exactly as the
 * by-player cap does (bets/gates.ts), then the modelled chance, then the id — a hash of the legs, so
 * two runs of the same night order the same way. Alternatives are not counted and not orphaned: one
 * whose main did not make the cut goes with it, because a plan B with no plan A is a ticket nobody
 * chose.
 */
export function topCrossTickets(bets: BetSuggestion[], max = CROSS_MAX_TICKETS): BetSuggestion[] {
  const mains = bets.filter((b) => !b.alternativeFor);
  if (mains.length <= max) return bets;
  const kept = new Set(
    [...mains]
      .sort((a, z) => z.evidenceScore - a.evidenceScore || z.modelledProbability - a.modelledProbability || a.id.localeCompare(z.id))
      .slice(0, max)
      .map((b) => b.id),
  );
  return bets.filter((b) => (b.alternativeFor ? kept.has(b.alternativeFor) : kept.has(b.id)));
}

export type DailyCrossVerdict =
  | "generate"
  | "exists"
  | "too_few_games"
  | "ai_off"
  | "ai_budget"
  | "already_ran"
  | "switched_off";

export interface DailyCrossInput {
  /** Scheduled games still to start in this sport today. */
  upcomingGames: number;
  /** A slate is already stored for this sport and day. */
  exists: boolean;
  aiConfigured: boolean;
  budgetExhausted: boolean;
  /** This sport's build already ran today, whatever it produced. */
  ranToday: boolean;
  enabled: boolean;
}

/**
 * Whether the scheduler builds today's cross-game múltiplas for one sport.
 *
 * Pure, so the decision is tested rather than argued about, and ordered so the cheapest refusal
 * comes first: nothing here may reach the model before the grid, the calendar and the budget have
 * all agreed. `too_few_games` is the answer the screen repeats to the reader — on a one-game night
 * there is no combination across games to make, and inventing one would be the lie this product
 * does not tell.
 */
export function dailyCrossVerdict(i: DailyCrossInput): DailyCrossVerdict {
  if (!i.enabled) return "switched_off";
  if (i.exists) return "exists";
  if (i.ranToday) return "already_ran";
  if (i.upcomingGames < CROSS_MIN_GAMES) return "too_few_games";
  if (!i.aiConfigured) return "ai_off";
  if (i.budgetExhausted) return "ai_budget";
  return "generate";
}

/** `CROSS_DAILY=0` switches the daily build off without a deploy; anything else leaves it on. */
export const crossDailyEnabled = (env: Record<string, string | undefined> = process.env): boolean =>
  (env.CROSS_DAILY ?? "1").trim() !== "0";

/** The window, as the prompt states it, so the ask and the gate can never drift apart. */
export const crossPromptLines = (): string[] => [
  `SHAPE — every ticket here is a MÚLTIPLA ENTRE JOGOS and the shape is fixed:`,
  `- ${CROSS_MIN_LEGS} legs (a double) is the default. ${CROSS_MAX_LEGS} legs only when two lines cannot reach ${CROSS_MIN_DECIMAL.toFixed(2)}x on their own. Never more than ${CROSS_MAX_LEGS}.`,
  `- Combined price between ${CROSS_MIN_DECIMAL.toFixed(2)}x and ${CROSS_MAX_DECIMAL.toFixed(2)}x. A ticket outside that window is discarded after you answer, so do not build one.`,
  `- Each leg from a DIFFERENT game, and each leg the best-evidenced line that game offers — not the longest.`,
  `- The measured record of this product: pre-game tickets at 5x and above went 2 green in 52 and returned -71.3%, and at 20x and above 0 green in 34. Length is not the goal here; a good combination of two reliable lines is.`,
  `- The band to set is "${CROSS_BANDS[0]}" (${getBand(CROSS_BANDS[0]).min}x-${getBand(CROSS_BANDS[0]).max}x).`,
];
