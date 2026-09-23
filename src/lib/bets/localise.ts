import { z } from "zod";
import { generateStructured } from "@/lib/ai/extract";
import { GLOSSARY_RULE } from "@/lib/bets/prompt-defaults";
import { EXTRACTION_MODEL } from "@/lib/ai/client";
import type { BetSlate } from "@/lib/types";
import type { Lang } from "@/lib/i18n";

/**
 * A second language used to be a second, independent Opus generation — twice the cost, and it could
 * pick different legs, so pt and en readers saw different tickets. Now the primary language is
 * generated once and the other is derived: the cheaper model rewrites only the prose, natively for
 * that market (not a translation), and every number, leg and settlement rule is carried over untouched.
 */
const TextsSchema = z.object({
  dataNote: z.string(),
  suggestions: z.array(z.object({
    id: z.string(),
    title: z.string(),
    background: z.string(),
    riskNote: z.string(),
    evidenceNotes: z.array(z.string()),
    swapReason: z.string().nullable(),
    legs: z.array(z.object({ selection: z.string(), explanation: z.string(), evidence: z.string() })),
  })),
});
export type SlateTexts = z.infer<typeof TextsSchema>;

const MARKET: Record<Lang, string> = {
  pt: `Brazilian Portuguese, written for a Brazilian bettor: direct, colloquial, decimal odds, 'bilhete', 'linha do bilhete', 'múltipla'.\n${GLOSSARY_RULE}`,
  en: "American English, written for a US bettor: American odds vocabulary where natural ('+150', 'the favorite'), 'ticket', 'leg', 'parlay'.",
};

export function extractTexts(slate: BetSlate): SlateTexts {
  return {
    dataNote: slate.dataNote,
    suggestions: slate.suggestions.map((s) => ({
      id: s.id, title: s.title, background: s.background, riskNote: s.riskNote, evidenceNotes: s.evidenceNotes, swapReason: s.swapReason ?? null,
      legs: s.legs.map((l) => ({ selection: l.selection, explanation: l.explanation, evidence: l.evidence })),
    })),
  };
}

/** Puts rewritten prose back onto a deep copy of the source slate. Anything numeric is never touched. */
export function mergeTexts(slate: BetSlate, texts: SlateTexts): BetSlate {
  const byId = new Map(texts.suggestions.map((t) => [t.id, t]));
  return {
    dataNote: texts.dataNote || slate.dataNote,
    suggestions: slate.suggestions.map((s) => {
      const t = byId.get(s.id);
      if (!t || t.legs.length !== s.legs.length) return structuredClone(s);
      return {
        ...structuredClone(s),
        title: t.title, background: t.background, riskNote: t.riskNote, evidenceNotes: t.evidenceNotes,
        swapReason: s.swapReason ? t.swapReason ?? s.swapReason : undefined,
        legs: s.legs.map((l, i) => ({ ...structuredClone(l), selection: t.legs[i].selection, explanation: t.legs[i].explanation, evidence: t.legs[i].evidence })),
      };
    }),
  };
}

export async function localiseSlate(slate: BetSlate, from: Lang, to: Lang): Promise<BetSlate> {
  if (from === to || !slate.suggestions.length) return slate;
  const texts = await generateStructured({
    schema: TextsSchema,
    model: EXTRACTION_MODEL,
    // Fifteen tickets of prose come back as ~10k tokens of JSON, and on Claude the thinking shares the
    // budget: 12k hit the cap on the first real slate (22/09/2026). Rewriting needs no thinking.
    maxTokens: 24000,
    effort: "low",
    system: `You rewrite the prose of betting tickets from ${MARKET[from]} into ${MARKET[to]}
Rules:
- Write natively for the target market — same meaning, same claims, same hedges, but the phrasing a local sharp bettor would use. Not a word-for-word translation.
- Keep every number, player name, team name, line, price and percentage exactly as given. Never add a fact, a price or a probability that is not in the source.
- Keep 'selection' recognisable as the same bet; only its wording changes.
- Return every suggestion with the same id and the same number of legs, in the same order.`,
    prompt: JSON.stringify(extractTexts(slate)),
    label: `localise:${to}`,
    mock: () => extractTexts(slate),
  });
  return mergeTexts(slate, texts);
}
