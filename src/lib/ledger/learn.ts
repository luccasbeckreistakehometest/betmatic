import { z } from "zod";
import { getDb, newId, nowIso } from "@/lib/server/db";
import { readLedger } from "@/lib/ledger/store";
import { calibrationPrompt } from "@/lib/ledger/calibrate";
import { generateStructured, lastUsage } from "@/lib/ai/extract";
import { mockPostMortem } from "@/lib/ai/mocks";
import { aiRewrite, type RewriteFn } from "@/lib/server/prompts";
import { filePromptProposal, fileCodeGates } from "@/lib/ledger/file-proposal";
import { recentRejections } from "@/lib/ledger/proposals";
import { latestFactorStats } from "@/lib/server/factors-job";
import { proposeFromLesson } from "@/lib/ledger/hypotheses";
import type { FactorStat } from "@/lib/ledger/factor-report";
import type { LedgerEntry } from "@/lib/types";

/**
 * The qualitative half of learning. Calibration (calibrate.ts) already feeds hit rates back into
 * every prompt; this reads what actually happened to recent tickets and asks the judgement model
 * for a post-mortem — what worked, what broke and why — and for a concrete change to the prompt.
 * The change is a proposal an admin applies with one click, and there is no switch that skips the
 * click: a prompt that rewrites itself every night with no one reading drifts, and the operator has
 * to see the exact text before it goes live (ledger/file-proposal.ts).
 */
export interface WindowSummary {
  tickets: number; won: number; lost: number; push: number; void: number;
  byMarket: Record<string, { won: number; lost: number }>;
  bySource: Record<string, { won: number; lost: number }>;
  lostLegs: { matchup: string; selection: string; market: string; source: string; predicted: number; actual?: string }[];
}

export function settledInWindow(entries: LedgerEntry[], sinceIso: string, untilIso: string): LedgerEntry[] {
  return entries.filter((e) => e.settledAt && e.settledAt > sinceIso && e.settledAt <= untilIso && e.outcome !== "pending");
}

export function summariseWindow(entries: LedgerEntry[]): WindowSummary {
  const s: WindowSummary = { tickets: entries.length, won: 0, lost: 0, push: 0, void: 0, byMarket: {}, bySource: {}, lostLegs: [] };
  const bump = (m: Record<string, { won: number; lost: number }>, k: string, o: string) => {
    m[k] ??= { won: 0, lost: 0 }; if (o === "won") m[k].won += 1; else if (o === "lost") m[k].lost += 1;
  };
  for (const e of entries) {
    if (e.outcome === "won") s.won += 1; else if (e.outcome === "lost") s.lost += 1; else if (e.outcome === "push") s.push += 1; else if (e.outcome === "void") s.void += 1;
    for (const l of e.legs) {
      bump(s.byMarket, l.market, l.outcome); bump(s.bySource, l.sourceBasis, l.outcome);
      if (l.outcome === "lost") s.lostLegs.push({ matchup: e.matchup, selection: l.selection, market: l.market, source: l.sourceBasis, predicted: l.predictedProbability, actual: l.actual });
    }
  }
  return s;
}

/**
 * A lesson carries the measured row that justifies it. A rule with no number behind it is an
 * opinion, and an opinion applied to the prompt is indistinguishable from drift a month later —
 * `runLearning` drops any lesson whose `factorStatId` is not a row that actually exists.
 */
const LessonSchema = z.object({
  factorStatId: z.string().describe("O id exato de uma linha da lista FATORES ACESOS. Sem ele a lição é descartada antes de ser gravada."),
  text: z.string().describe("A regra concreta e testável que o gerador deveria seguir, citando o número do fator."),
});
export type Lesson = z.infer<typeof LessonSchema>;

const PostMortemSchema = z.object({
  summary: z.string().describe("Em português, 2 a 4 frases: o resultado do período e a causa dominante dos erros."),
  wentRight: z.array(z.string()).describe("O que funcionou e por quê (com números)."),
  wentWrong: z.array(z.string()).describe("O que falhou, ligando cada item às linhas perdidas do bilhete e à causa real (não 'azar')."),
  lessons: z.array(LessonSchema).describe("Regras concretas que o gerador deveria seguir daqui em diante, cada uma testável e cada uma citando um factorStatId da lista."),
  promptFeedback: z.string().describe("Feedback pronto pra aplicar no prompt do gerador, em português, direto e específico. Vazio quando o período não justifica mudar nada."),
  promptFeedbackFactorStatId: z.string().describe("O factorStatId que sustenta o promptFeedback. Vazio quando não há proposta."),
  confidence: z.enum(["high", "medium", "low"]).describe("Quão sustentadas pelos dados estão as lições — amostra pequena = low."),
});
export type PostMortem = z.infer<typeof PostMortemSchema>;
export interface PostMortemArgs {
  summary: WindowSummary;
  entries: LedgerEntry[];
  calibration: string;
  factors: FactorStat[];
  /**
   * What the operator already turned down, and why. The cheapest supervision the loop has: without
   * it the agent proposes the same refused idea every night, and the refusal teaches nothing.
   */
  rejections?: { feedback: string; reason: string }[];
  /** One line naming the population, so a per-game post-mortem does not write as if it read a week. */
  scope?: string;
}
export type PostMortemFn = (args: PostMortemArgs) => Promise<PostMortem>;

export const aiPostMortem: PostMortemFn = async ({ summary, entries, calibration, factors, rejections, scope }) =>
  generateStructured({
    schema: PostMortemSchema,
    maxTokens: 6000,
    label: "post-mortem",
    mock: () => mockPostMortem({ summary, factors }),
    system: `You are the post-mortem analyst for a betting-ticket generator. You get the tickets it produced that settled recently, with every leg graded, plus its running calibration. Find what the generator should do differently.
Rules:
- Ground every claim in the legs given. Name the leg, the market, the evidence source and the predicted probability. Never invent a cause.
- Separate variance from error: a 55% leg losing once is not a lesson; the same market or source losing repeatedly at inflated predicted probabilities is.
- Lessons must be rules the generator can follow (e.g. "cap card overs at the teams' own rates unless the referee is confirmed"), not sentiment.
- promptFeedback is what an admin would type to change the prompt: specific, minimal, in Portuguese. Leave it empty if the sample is too small or nothing repeatable appeared. Never propose weakening the integrity rules (no invented prices/players, honest probabilities).
- Every lesson MUST cite one factorStatId from the FATORES ACESOS list, verbatim, and so must promptFeedback (in promptFeedbackFactorStatId). A lesson that cites nothing is dropped before it is stored — that list is the only measured evidence you have, and a rule with no measurement behind it cannot be evaluated later.
- Never write about stake, unit, bankroll or how much to bet. That is computed in code and is none of your business here: describe the game, not the wager size.`,
    prompt: [
      scope ? `POPULAÇÃO: ${scope}` : "",
      `PERÍODO: ${summary.tickets} bilhetes liquidados — ${summary.won} ganhos, ${summary.lost} perdidos, ${summary.push} push, ${summary.void} void.`,
      `POR MERCADO: ${JSON.stringify(summary.byMarket)}`, `POR FONTE: ${JSON.stringify(summary.bySource)}`,
      `LINHAS PERDIDAS:\n${summary.lostLegs.map((l) => `- [${l.matchup}] ${l.selection} (${l.market}, fonte ${l.source}, previsto ${(l.predicted * 100).toFixed(0)}%${l.actual ? `, real: ${l.actual}` : ""})`).join("\n") || "- nenhuma"}`,
      `BILHETES (compacto):\n${entries.slice(0, 40).map((e) => `- ${e.outcome.toUpperCase()} ${e.combinedDecimal.toFixed(2)}x "${e.title}" [${e.matchup}] prev ${(e.modelledProbability * 100).toFixed(0)}% — ${e.legs.map((l) => `${l.outcome}:${l.selection}`).join("; ")}`).join("\n")}`,
      `\nCALIBRAÇÃO ACUMULADA:\n${calibration}`,
      `\nFATORES ACESOS (cite um destes ids em cada lição; nenhum outro id é aceito):\n${
        factors.length
          ? factors.map((f) => `- ${f.id} | ${f.dim}=${f.value} (${f.scope}) | ${f.legs} linhas, acerto ${(f.hitRate * 100).toFixed(0)}% contra ${(f.predicted * 100).toFixed(0)}% previsto, IC95 [${(f.ciLow * 100).toFixed(0)}; ${(f.ciHigh * 100).toFixed(0)}], q=${f.qValue.toFixed(3)}`).join("\n")
          : "- nenhum fator com amostra suficiente ainda"
      }`,
      rejections?.length
        ? `\nPROPOSTAS JÁ RECUSADAS PELO OPERADOR (não proponha de novo a mesma coisa; o motivo diz o que ele não aceita):\n${
            rejections.map((r) => `- "${r.feedback.slice(0, 200)}" → recusada porque: ${r.reason.slice(0, 200)}`).join("\n")
          }`
        : "",
    ].filter(Boolean).join("\n\n"),
  });

export interface LearningRunRow {
  id: string; status: string; windowStart: string; windowEnd: string; tickets: number; won: number; lost: number; summary: string;
  report: string; promptFeedback: string; applied: number; appliedBatch: string; costUsd: number; note: string; createdAt: string;
}

/** Old stored reports and hand-written mocks carry plain strings; both shapes are read here. */
const asLesson = (l: Lesson | string): Lesson => (typeof l === "string" ? { factorStatId: "", text: l } : l);
const countLessons = (lessons: (Lesson | string)[] | undefined): number => (lessons ?? []).length;
export const citedLessons = (lessons: (Lesson | string)[] | undefined, byId: Map<string, FactorStat>): Lesson[] =>
  (lessons ?? []).map(asLesson).filter((l) => l.text.trim() && (!byId.size || byId.has(l.factorStatId)));

/**
 * The daily window sweep, kept beside the per-game loop because a rule that only shows up across
 * several nights is invisible to a single game. What changed is the ending: it no longer applies
 * anything, with or without an environment switch. It files its proposal in the same queue, through
 * the same door, under the same brakes (ledger/file-proposal.ts) — two ways into the prompt would
 * mean two sets of rules, and the weaker one would decide.
 */
export async function runLearning(opts: { sinceHours?: number; minTickets?: number; now?: Date } = {}, model: PostMortemFn = aiPostMortem, rewrite: RewriteFn = aiRewrite): Promise<LearningRunRow> {
  const db = getDb();
  const now = opts.now ?? new Date();
  const windowEnd = now.toISOString();
  const windowStart = new Date(now.getTime() - (opts.sinceHours ?? 24) * 3_600_000).toISOString();
  const entries = settledInWindow(readLedger(), windowStart, windowEnd);
  const summary = summariseWindow(entries);
  const id = newId("lr");
  const minTickets = opts.minTickets ?? 3;

  if (entries.length < minTickets) {
    // The five runs that fired in the product's life all hit an empty window and filed a note that
    // said nothing, so nobody could tell an empty ledger from a misaimed one. The last settled
    // ticket's timestamp is the difference between "there is nothing to learn from" and "the window
    // is pointing at the wrong place", and it costs one query.
    const settled = readLedger().filter((e) => e.settledAt && e.outcome !== "pending").map((e) => e.settledAt!).sort();
    const last = settled.at(-1);
    const note = `${entries.length} bilhete(s) liquidado(s) no período — mínimo ${minTickets}. ${
      last ? `O ledger tem ${settled.length} liquidado(s), o último em ${last}.` : "O ledger não tem nenhum bilhete liquidado."
    }`;
    db.prepare("INSERT INTO learning_runs (id,status,windowStart,windowEnd,tickets,won,lost,note,createdAt) VALUES (?,?,?,?,?,?,?,?,?)")
      .run(id, "skipped", windowStart, windowEnd, summary.tickets, summary.won, summary.lost, note, nowIso());
    return db.prepare("SELECT * FROM learning_runs WHERE id=?").get(id) as LearningRunRow;
  }
  try {
    const factors = latestFactorStats(200);
    const pm = await model({ summary, entries, calibration: calibrationPrompt(), factors, rejections: recentRejections(8) });
    let cost = lastUsage?.costUsd ?? 0;

    // The citation rule binds only when there is something to cite. On a ledger too small for any
    // factor to have a sample, demanding a citation would silence the post-mortem entirely — which
    // would delete a feature to enforce a rule about a table that does not exist yet.
    const byId = new Map(factors.map((f) => [f.id, f]));
    const cited = citedLessons(pm.lessons, byId);
    const dropped = countLessons(pm.lessons) - cited.length;

    // The queue, not the prompt. `windowStart → windowEnd` is the origin instead of a game, and the
    // panel reads the empty gameId for exactly what it means: this run was a window, not a match.
    const origin = { gameId: "", matchup: `janela de ${opts.sinceHours ?? 24}h` };
    const filed = await filePromptProposal({ pm, factors: byId, runId: id, origin, tickets: summary.tickets, rewrite });
    cost += filed.costUsd;
    const feedback = filed.proposal?.channel === "prompt" ? filed.proposal.feedback : "";

    const proposals = byId.size ? cited.map((l) => proposeFromLesson(l, byId.get(l.factorStatId)!, id)) : [];
    const gates = fileCodeGates({
      lessons: cited, factors: byId, runId: id, origin, tickets: summary.tickets,
      hypothesisIdFor: (factorStatId) => proposals.find((h) => h.factorStatId === factorStatId)?.id ?? null,
      alreadyFiled: gateAlreadyFiled,
    });

    const report = {
      ...pm,
      // Stored as prose, the way the panel has always read it; the measured rows travel beside it.
      lessons: cited.map((l) => l.text),
      factors: cited.map((l) => byId.get(l.factorStatId)!),
      proposals,
      queued: [filed.proposal, ...gates].filter(Boolean).map((p) => ({ id: p!.id, channel: p!.channel, gate: p!.gate, status: p!.status, decided: p!.decided })),
      dropped,
      byMarket: summary.byMarket,
      bySource: summary.bySource,
    };
    const note = [
      dropped ? `${dropped} lição(ões) descartada(s) por não citar um fator medido.` : "",
      filed.note,
      byId.size ? "" : "Nenhum fator tinha amostra suficiente nesta rodada, então a citação não foi exigida.",
    ].filter(Boolean).join(" ");
    db.prepare("INSERT INTO learning_runs (id,status,windowStart,windowEnd,tickets,won,lost,summary,report,promptFeedback,applied,appliedBatch,costUsd,note,createdAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .run(id, "ok", windowStart, windowEnd, summary.tickets, summary.won, summary.lost, pm.summary, JSON.stringify(report), feedback, 0, "", cost, note, nowIso());
  } catch (error) {
    db.prepare("INSERT INTO learning_runs (id,status,windowStart,windowEnd,tickets,won,lost,note,createdAt) VALUES (?,?,?,?,?,?,?,?,?)")
      .run(id, "error", windowStart, windowEnd, summary.tickets, summary.won, summary.lost, error instanceof Error ? error.message : "failed", nowIso());
  }
  return db.prepare("SELECT * FROM learning_runs WHERE id=?").get(id) as LearningRunRow;
}

export function listLearningRuns(limit = 20): LearningRunRow[] {
  return getDb().prepare("SELECT * FROM learning_runs ORDER BY createdAt DESC, rowid DESC LIMIT ?").all(limit) as LearningRunRow[];
}

/** A gate already in the queue for the same measured slice is not filed twice every night. */
function gateAlreadyFiled(gate: string, factorStatId: string): boolean {
  return !!getDb().prepare(
    "SELECT 1 FROM learning_proposals WHERE channel='code_gate' AND gate=? AND factorStatId=? AND status IN ('code_gate','rejected') LIMIT 1",
  ).get(gate, factorStatId);
}
