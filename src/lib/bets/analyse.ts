import { z } from "zod";
import { generateStructured } from "@/lib/ai/extract";
import { GLOSSARY_RULE } from "@/lib/bets/prompt-defaults";
import { calibrationPrompt } from "@/lib/ledger/calibrate";
import { expectedValue, formatAmerican, impliedProbability, parlayDecimal, parseOdds } from "@/lib/odds";
import type { Lang } from "@/lib/i18n";

export interface SlipLegInput {
  selection: string;
  market: string;
  odds: string;
}

const AnalysisSchema = z.object({
  verdict: z.string().describe("Two or three sentences on the ticket as a whole."),
  legs: z.array(
    z.object({
      index: z.number().describe("0-based index of the leg being judged."),
      assessment: z.string().describe("What is right or wrong with this leg."),
      fairProbability: z.number().describe("Honest estimate of this leg landing, 0 to 1."),
      concern: z.enum(["none", "minor", "serious"]),
    }),
  ),
  weakestIndex: z.number().describe("Index of the leg most likely to break the ticket. -1 if none stands out."),
  swaps: z.array(
    z.object({
      replaceIndex: z.number(),
      suggestion: z.string().describe("What to put in its place and why."),
      effect: z.string().describe("What this does to the price and to the chance."),
    }),
  ),
  correlationNote: z.string().describe("Whether the legs help or fight each other. Say 'independent' when neither."),
});

const SYSTEM_EN = `You review a betting slip someone assembled themselves.

- Be useful, not agreeable. If the ticket is bad, say so plainly and say why.
- Judge each leg on its own, then judge how they interact. Anti-correlated legs (a big favourite's
  spread plus that same star's counting-stat over) are a common and costly mistake — call it out.
- fairProbability is your honest estimate, not a number chosen to make the ticket look good.
- Suggest swaps only when they genuinely improve the ticket, and say what each does to both the
  price and the chance. Fewer, better suggestions beat a long list.
- Never promise a result and never suggest a stake size.
- You are reviewing selections the user typed; you cannot verify the prices are live. Say so if it matters.`;

const SYSTEM_PT = `${SYSTEM_EN}

Write every field in Brazilian Portuguese. Keep player names, market names and numbers as supplied.

${GLOSSARY_RULE}`;

export interface SlipAnalysis {
  verdict: string;
  legs: { index: number; assessment: string; fairProbability: number; concern: string }[];
  weakestIndex: number;
  swaps: { replaceIndex: number; suggestion: string; effect: string }[];
  correlationNote: string;
  combinedDecimal: number;
  combinedAmerican: string;
  impliedProbability: number;
  modelledProbability: number;
  edgePct: number;
}

/**
 * The user's own slip, priced in code and judged by the model. This is the per-user compute that
 * coins exist to pay for — everything else the product shows was generated once for everyone.
 */
export async function analyseSlip(legs: SlipLegInput[], lang: Lang, opts: { context?: string } = {}): Promise<SlipAnalysis> {
  const decimals = legs.map((l) => parseOdds(l.odds));
  const priced = decimals.filter((d) => Number.isFinite(d) && d > 1);
  if (priced.length < 2) throw new Error("Informe ao menos duas linhas com odds válidas.");

  const prompt = [
    "SLIP UNDER REVIEW:",
    ...legs.map((l, i) => `[${i}] ${l.market}: ${l.selection} @ ${l.odds} (decimal ${decimals[i].toFixed(2)})`),
    "",
    `Combined price: ${parlayDecimal(priced).toFixed(2)}x`,
    "",
    ...(opts.context ? [opts.context, ""] : []),
    calibrationPrompt(),
  ].join("\n");

  const result = await generateStructured({
    schema: AnalysisSchema,
    system: lang === "pt" ? SYSTEM_PT : SYSTEM_EN,
    prompt,
    maxTokens: 8000,
    label: opts.context ? "deep_slip" : "analyse_slip",
    mock: () => ({
      verdict: lang === "pt" ? "Análise de teste: bilhete revisado sem IA." : "Test analysis: slip reviewed without AI.",
      legs: legs.map((_, index) => ({ index, assessment: lang === "pt" ? "Linha conferida no modo de teste." : "Leg checked in test mode.", fairProbability: 0.5, concern: "minor" as const })),
      weakestIndex: legs.length - 1,
      swaps: [],
      correlationNote: lang === "pt" ? "independentes" : "independent",
    }),
  });

  // Arithmetic stays in code; the model supplies judgement, never the payout.
  const combined = parlayDecimal(priced);
  const fair = result.legs.map((l) => Math.min(Math.max(l.fairProbability, 0.001), 0.999));
  const modelled = fair.reduce((acc, p) => acc * p, 1);
  const ev = expectedValue(priced, fair.length === priced.length ? fair : priced.map(() => 0.5));

  return {
    ...result,
    combinedDecimal: combined,
    combinedAmerican: formatAmerican(combined),
    impliedProbability: impliedProbability(combined),
    modelledProbability: modelled,
    edgePct: Number.isFinite(ev) ? ev * 100 : NaN,
  };
}
