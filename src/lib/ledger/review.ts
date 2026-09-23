import { z } from "zod";
import { getDb, nowIso } from "@/lib/server/db";
import { findGamePrediction } from "@/lib/server/predictions";
import { refreshConfig } from "@/lib/server/refresh-policy";
import { scrubText } from "@/lib/server/whitelabel";
import { generateStructured, lastUsage } from "@/lib/ai/extract";
import { GLOSSARY_RULE } from "@/lib/bets/prompt-defaults";
import { EXTRACTION_MODEL } from "@/lib/ai/client";
import { SPORTS } from "@/lib/sports";
import type { Lang } from "@/lib/i18n";
import type { Role } from "@/lib/plans";
import type { BetSlate, BetSuggestion, LedgerEntry } from "@/lib/types";

/**
 * "Por que perdi?": a grounded post-mortem of one lost ticket for the person who followed it.
 * Inputs are only what the ledger and the stored generation already hold — the graded legs with
 * their actual results, and the reasoning the generator wrote before the game — so the model can
 * explain, not invent. Generated once per ticket and language, then cached in ticket_reviews.
 */
export const LossReviewSchema = z.object({
  assumed: z.string().describe("What the ticket's reasoning assumed before the game, in 1–3 sentences, tied to the legs."),
  happened: z.string().describe("What the graded results show actually happened, leg by leg, using only the actual values given."),
  verdict: z.enum(["variance", "repeatable_error", "mixed"]).describe("variance = the read was sound and the outcome went the other way; repeatable_error = the reasoning had a flaw that will recur; mixed = both."),
  reasoning: z.string().describe("Why that verdict, in 2–4 sentences. Name the leg and the number that decides it."),
  keyLeg: z.string().nullable().describe("The selection text of the leg that decided the loss, or null when no single leg did."),
  watchNext: z.array(z.string()).describe("2–4 concrete things to check next time before taking a similar ticket."),
});
export type LossReview = z.infer<typeof LossReviewSchema>;

export interface ReviewEvidence {
  background: string;
  riskNote: string;
  evidenceNotes: string[];
  legs: { selection: string; explanation: string; evidence: string }[];
}

const primaryLang = (): Lang => refreshConfig(process.env, SPORTS.map((s) => s.key)).langs[0] as Lang;

function matchSuggestion(slate: BetSlate | null, entry: LedgerEntry): BetSuggestion | null {
  if (!slate) return null;
  const key = entry.legs.map((l) => l.selection).join("|");
  return slate.suggestions.find((s) => s.bandKey === entry.bandKey && s.legs.map((l) => l.selection).join("|") === key) ?? null;
}

const parse = (row: { payload: string } | null): BetSlate | null => (row ? (JSON.parse(row.payload) as BetSlate) : null);

/**
 * The generator's own words for this ticket, in the reader's language when that pass was saved.
 * Ledger ids are written in the primary language, so the match runs there and the text is then
 * looked up by ticket id in the requested language.
 */
export function evidenceFor(entry: LedgerEntry, lang: Lang): ReviewEvidence | null {
  const primary = primaryLang();
  const inPrimary = matchSuggestion(parse(findGamePrediction(entry.gameId, primary)), entry);
  if (!inPrimary) return null;
  const shown = lang === primary ? inPrimary : parse(findGamePrediction(entry.gameId, lang))?.suggestions.find((s) => s.id === inPrimary.id) ?? inPrimary;
  return {
    background: shown.background, riskNote: shown.riskNote, evidenceNotes: shown.evidenceNotes,
    legs: shown.legs.map((l) => ({ selection: l.selection, explanation: l.explanation, evidence: l.evidence })),
  };
}

const MARK: Record<string, string> = { won: "✓", lost: "✗", push: "=", void: "–", pending: "·" };

/** The settled legs as plain lines — the fallback shown when no model is configured, and the prompt's core. */
export function settledLegLines(entry: LedgerEntry, lang: Lang): string[] {
  return entry.legs.map((l) => {
    const predicted = `${(l.predictedProbability * 100).toFixed(0)}%`;
    const actual = l.actual ? ` — ${lang === "pt" ? "real" : "actual"}: ${l.actual}` : "";
    return `${MARK[l.outcome] ?? "·"} ${l.selection} (${l.market}, ${lang === "pt" ? "previsto" : "predicted"} ${predicted}, ${l.oddsDecimal.toFixed(2)}x)${actual}`;
  });
}

export function reviewPrompt(entry: LedgerEntry, evidence: ReviewEvidence | null, lang: Lang): { system: string; prompt: string } {
  const language = lang === "pt"
    ? `Brazilian Portuguese, for a Brazilian bettor: direct and colloquial, no consolation clichés.\n${GLOSSARY_RULE}`
    : "American English, for a US bettor: direct, no consolation clichés.";
  const system = `You explain to the bettor who followed it why one settled ticket lost.
You get the ticket's legs with the model's predicted probability and the actual result of each, plus the reasoning the generator wrote before the game.
Rules:
- Ground every sentence in the legs and actual values given. Never invent events, injuries, minutes or numbers that are not in the input.
- Separate variance from error. A 55% leg losing once is variance unless the reasoning shows a flaw — a stale line-up, a market the evidence did not support, a parlay of correlated legs, a probability far above what the evidence justified. Say which.
- Name the leg that decided it when one did; say so when none did.
- "watchNext" must be checks the bettor can actually do before the next similar ticket, not sentiment.
- Never name data providers, sportsbooks, statistics sites or reporters. Say "the line", "the game logs", "the injury report", "press reporting".
- Write in ${language}`;
  const legs = settledLegLines(entry, "en");
  const ev = evidence
    ? [
        `REASONING WRITTEN BEFORE THE GAME:\n${evidence.background}`,
        `RISK NOTE: ${evidence.riskNote}`,
        evidence.evidenceNotes.length ? `EVIDENCE NOTES:\n${evidence.evidenceNotes.map((n) => `- ${n}`).join("\n")}` : "",
        `PER LEG:\n${evidence.legs.map((l) => `- ${l.selection}\n  why: ${l.explanation}\n  evidence: ${l.evidence}`).join("\n")}`,
      ].filter(Boolean).join("\n\n")
    : "REASONING WRITTEN BEFORE THE GAME: not available for this ticket — work from the legs and actuals only, and say that the pre-game reasoning is unknown.";
  const prompt = [
    `TICKET: "${entry.title}" — ${entry.matchup} (${entry.sportKey}), ${entry.kind}, band ${entry.bandKey}, ${entry.combinedDecimal.toFixed(2)}x, modelled probability ${(entry.modelledProbability * 100).toFixed(0)}%, outcome ${entry.outcome.toUpperCase()}.`,
    `LEGS (✓ won, ✗ lost, = push, – void):\n${legs.join("\n")}`,
    ev,
  ].join("\n\n");
  return { system, prompt };
}

export type ReviewFn = (args: { entry: LedgerEntry; evidence: ReviewEvidence | null; lang: Lang }) => Promise<LossReview>;

export const aiLossReview: ReviewFn = ({ entry, evidence, lang }) =>
  generateStructured({ schema: LossReviewSchema, model: EXTRACTION_MODEL, maxTokens: 2500, ...reviewPrompt(entry, evidence, lang) });

export interface StoredReview { review: LossReview; model: string; createdAt: string }

export function cachedReview(ledgerId: string, lang: Lang): StoredReview | null {
  const row = getDb().prepare("SELECT payload, model, createdAt FROM ticket_reviews WHERE ledgerId=? AND lang=?").get(ledgerId, lang) as { payload: string; model: string; createdAt: string } | undefined;
  return row ? { review: JSON.parse(row.payload) as LossReview, model: row.model, createdAt: row.createdAt } : null;
}

/** One generation per ticket and language; every later request reads the cache. */
export async function getOrCreateReview(entry: LedgerEntry, lang: Lang, fn: ReviewFn = aiLossReview): Promise<StoredReview & { cached: boolean }> {
  const hit = cachedReview(entry.id, lang);
  if (hit) return { ...hit, cached: true };
  const review = LossReviewSchema.parse(await fn({ entry, evidence: evidenceFor(entry, lang), lang }));
  const createdAt = nowIso();
  getDb().prepare("INSERT OR REPLACE INTO ticket_reviews (ledgerId, lang, payload, model, costUsd, createdAt) VALUES (?,?,?,?,?,?)")
    .run(entry.id, lang, JSON.stringify(review), EXTRACTION_MODEL, lastUsage?.costUsd ?? 0, createdAt);
  return { review, model: EXTRACTION_MODEL, createdAt, cached: false };
}

/** Whitelabel at serialisation: the model is told not to name sources, the scrub guarantees it. */
export function reviewForViewer(review: LossReview, role: Role, lang: Lang): LossReview {
  if (role === "admin") return review;
  return {
    ...review,
    assumed: scrubText(review.assumed, lang), happened: scrubText(review.happened, lang), reasoning: scrubText(review.reasoning, lang),
    keyLeg: review.keyLeg === null ? null : scrubText(review.keyLeg, lang), watchNext: review.watchNext.map((w) => scrubText(w, lang)),
  };
}

export function reviewStats(): { reviews: number; costUsd: number } {
  const row = getDb().prepare("SELECT COUNT(*) n, COALESCE(SUM(costUsd),0) c FROM ticket_reviews").get() as { n: number; c: number };
  return { reviews: row.n, costUsd: row.c };
}
