import { z } from "zod";
import { generateStructured } from "@/lib/ai/extract";
import {
  ODDS_BANDS, expectedValue, formatAmerican, getBand, impliedProbability, parlayDecimal, parseOdds,
} from "@/lib/odds";
import type {
  BetLeg, BetSlate, BetSuggestion, Game, GameDetail, PickRow, PropRow, XIntel,
} from "@/lib/types";
import type { Lang } from "@/lib/i18n";

const LegSchema = z.object({
  selection: z.string().describe("The exact bet, including the number. e.g. 'Paolo Banchero over 22.5 points'"),
  market: z.string().describe("moneyline | spread | total | player prop | alternate | other"),
  odds: z.string().describe("The price exactly as the source showed it, American or decimal. Empty string if no price was published."),
  book: z.string().nullable(),
  explanation: z.string().describe("Why this leg. One or two sentences."),
  evidence: z.string().describe("The specific measured fact behind it — hit rate with sample size, injury status, or the insider post. Say 'no measured support' when there is none."),
  fairProbability: z.number().describe("Your estimate of this leg actually landing, 0 to 1. Use the measured hit rate when one is given; never exceed it by much without stating why."),
});

const SuggestionSchema = z.object({
  kind: z.enum(["single", "parlay"]),
  title: z.string().describe("Short label for the ticket."),
  background: z.string().describe("The situation that makes this worth a look: matchup context, injury picture, market read. Two or three sentences."),
  legs: z.array(LegSchema).min(1),
  riskNote: z.string().describe("What most plausibly breaks this ticket."),
  confidence: z.enum(["high", "medium", "low"]),
});

const SlateSchema = z.object({
  suggestions: z.array(SuggestionSchema),
  dataNote: z.string().describe("What was missing or thin in the inputs, so the reader can weigh the tickets."),
});

const SYSTEM_EN = `You build betting tickets for one game from gathered research, across a requested odds range.

Hard rules:
- Every leg must trace to a supplied fact: a measured hit rate, an injury line, an insider post, or a published price. Never invent a player, a line, or a price.
- fairProbability is your honest estimate of the leg landing. When a measured hit rate is supplied, anchor to it. Do not inflate it to make a ticket look good.
- Longer odds mean lower probability, not more skill. A big parlay is a low-probability ticket and your language must reflect that.
- Prefer legs that are correlated in the bettor's favour when building parlays, and say so in the background.
- If the gathered data cannot support a ticket in the requested band, return fewer tickets — or none — and explain why in dataNote. Padding the list with unsupported legs is a failure.
- Never state or imply a guaranteed outcome, and never recommend a stake size.

For each ticket write:
- background: the situation. What is going on in this game that makes this angle exist.
- explanation per leg: why that specific selection.
- evidence per leg: the measured fact, with its sample size when it has one.`;

const SYSTEM_PT = `${SYSTEM_EN}

Write every user-facing string (title, background, explanation, evidence, riskNote, dataNote) in Brazilian Portuguese. Keep player names, team names, market names and numbers exactly as supplied.`;

function describeProps(props: PropRow[]): string {
  if (!props.length) return "- none gathered";
  return props
    .map((p) => {
      const measured = p.measured;
      const measuredText = measured
        ? ` | MEASURED ${measured.side} ${measured.line} ${measured.stat}: L5 ${measured.last5.hits}/${measured.last5.of}, L10 ${measured.last10.hits}/${measured.last10.of}, season ${measured.season.hits}/${measured.season.of} (${(measured.impliedFair * 100).toFixed(0)}%), avg ${measured.average}, median ${measured.median} [${measured.sampleNote}]`
        : " | MEASURED: none — no game log matched this player/market";
      return `- ${p.player} ${p.market} ${p.side ?? ""} ${p.line ?? "?"} @ ${p.odds ?? "no price"} (${p.book ?? "?"})${p.projection !== undefined ? ` toolProj ${p.projection}` : ""}${p.edgePct !== undefined ? ` toolEdge ${p.edgePct}%` : ""}${measuredText}`;
    })
    .join("\n");
}

export interface BuildArgs {
  game: Game;
  detail: GameDetail;
  props: PropRow[];
  picks: PickRow[];
  dimers: PickRow[];
  x: XIntel | null;
  bands: string[];
  lang: Lang;
  maxPerBand?: number;
}

/**
 * The model proposes selections and reasoning; every number below is computed here.
 * Compounding decimal odds across eight legs is exactly the arithmetic a language model gets
 * subtly wrong, and a wrong payout number would be the most damaging error this app could make.
 */
function priceSuggestion(
  raw: z.infer<typeof SuggestionSchema>,
  bandKey: string,
  index: number,
): BetSuggestion | null {
  const legs: BetLeg[] = [];
  for (const leg of raw.legs) {
    const decimal = parseOdds(leg.odds);
    legs.push({
      selection: leg.selection,
      market: leg.market,
      odds: leg.odds || "—",
      oddsDecimal: decimal,
      book: leg.book ?? undefined,
      explanation: leg.explanation,
      evidence: leg.evidence,
      fairProbability: Math.min(Math.max(leg.fairProbability, 0.001), 0.999),
    });
  }

  const priced = legs.filter((l) => Number.isFinite(l.oddsDecimal) && l.oddsDecimal > 1);
  // A ticket with no usable price cannot be evaluated, so it is dropped rather than shown blank.
  if (!priced.length) return null;

  const combinedDecimal = parlayDecimal(priced.map((l) => l.oddsDecimal));
  const modelled = legs.reduce((acc, l) => acc * l.fairProbability, 1);
  const ev = expectedValue(priced.map((l) => l.oddsDecimal), legs.map((l) => l.fairProbability));

  return {
    id: `${bandKey}-${index}`,
    kind: legs.length > 1 ? "parlay" : "single",
    bandKey,
    title: raw.title,
    background: raw.background,
    legs,
    combinedDecimal,
    combinedAmerican: formatAmerican(combinedDecimal),
    impliedProbability: impliedProbability(combinedDecimal),
    modelledProbability: modelled,
    edgePct: Number.isFinite(ev) ? ev * 100 : NaN,
    riskNote: raw.riskNote,
    confidence: raw.confidence,
  };
}

export async function buildBets(args: BuildArgs): Promise<BetSlate> {
  const { game, detail, props, picks, dimers, x, bands, lang, maxPerBand = 2 } = args;
  const targets = bands.map((b) => getBand(b));

  const marketLines = detail.books.length
    ? detail.books
        .map((b) => `- ${b.provider}: ${b.details ?? "?"} (${b.homeSpreadOdds ?? "?"}/${b.awaySpreadOdds ?? "?"}), total ${b.overUnder ?? "?"} (o${b.overOdds ?? "?"}/u${b.underOdds ?? "?"}), ML ${b.awayMoneyline ?? "?"}/${b.homeMoneyline ?? "?"}`)
        .join("\n")
    : "- no book lines published";

  const prompt = [
    `GAME: ${game.away.displayName} at ${game.home.displayName}`,
    game.tournament ? `TOURNAMENT: ${game.tournament} — ${game.round ?? ""}` : "",
    `TIPOFF (UTC): ${game.startsAt}`,
    "",
    `PUBLISHED MARKET:\n${marketLines}`,
    "",
    `INJURIES:\n${detail.injuries.map((i) => `- ${i.player} (${i.teamAbbreviation}): ${i.status}${i.detail ? ` — ${i.detail}` : ""}`).join("\n") || "- none listed"}`,
    "",
    `PLAYER PROPS WITH MEASURED HISTORY:\n${describeProps(props)}`,
    "",
    `PUBLISHED PICKS:\n${[...picks, ...dimers].map((p) => `- ${p.market}: ${p.selection} @ ${p.odds ?? "?"} (${p.book ?? "?"}) ${p.confidence ?? ""} — ${p.rationale ?? ""}`).join("\n") || "- none gathered"}`,
    "",
    `INSIDER REPORTING:\n${x?.items.length ? x.items.map((i) => `- @${i.handle} [${i.relevance}]: ${i.text.replace(/\s+/g, " ").slice(0, 250)}`).join("\n") : "- none gathered"}`,
    "",
    `REQUESTED ODDS BANDS — build up to ${maxPerBand} tickets per band:`,
    ...targets.map((b) => `- ${b.key}: combined ${b.min}x to ${b.max}x (${b.typicalLegs}). Set bandKey to "${b.key}".`),
    "",
    `Return the bandKey on each suggestion via its title prefix is not needed — instead order suggestions from shortest odds to longest.`,
  ]
    .filter(Boolean)
    .join("\n");

  const result = await generateStructured({
    schema: SlateSchema,
    system: lang === "pt" ? SYSTEM_PT : SYSTEM_EN,
    prompt,
    maxTokens: 16000,
  });

  const suggestions = result.suggestions
    .map((s, i) => {
      const decimalGuess = parlayDecimal(
        s.legs.map((l) => parseOdds(l.odds)).filter((d) => Number.isFinite(d) && d > 1),
      );
      // Classify by the price actually computed, not by whatever band the model thought it hit.
      const band = ODDS_BANDS.find((b) => decimalGuess >= b.min && decimalGuess < b.max);
      return priceSuggestion(s, band?.key ?? "unbanded", i);
    })
    .filter((s): s is BetSuggestion => s !== null)
    .sort((a, b) => a.combinedDecimal - b.combinedDecimal);

  return { suggestions, dataNote: result.dataNote };
}
