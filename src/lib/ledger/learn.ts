import { z } from "zod";
import { getDb, newId, nowIso } from "@/lib/server/db";
import { readLedger } from "@/lib/ledger/store";
import { calibrationPrompt } from "@/lib/ledger/calibrate";
import { generateStructured, lastUsage } from "@/lib/ai/extract";
import { applyFeedback } from "@/lib/server/prompts";
import type { LedgerEntry } from "@/lib/types";

/**
 * The qualitative half of learning. Calibration (calibrate.ts) already feeds hit rates back into
 * every prompt; this reads what actually happened to recent tickets and asks the judgement model
 * for a post-mortem — what worked, what broke and why — and for a concrete change to the prompt.
 * The change is a proposal an admin applies with one click, unless LEARN_AUTO_APPLY=1: a prompt
 * that rewrites itself every night with no one reading drifts.
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

const PostMortemSchema = z.object({
  summary: z.string().describe("Em português, 2 a 4 frases: o resultado do período e a causa dominante dos erros."),
  wentRight: z.array(z.string()).describe("O que funcionou e por quê (com números)."),
  wentWrong: z.array(z.string()).describe("O que falhou, ligando cada item às pernas perdidas e à causa real (não 'azar')."),
  lessons: z.array(z.string()).describe("Regras concretas que o gerador deveria seguir daqui em diante, cada uma testável."),
  promptFeedback: z.string().describe("Feedback pronto pra aplicar no prompt do gerador, em português, direto e específico. Vazio quando o período não justifica mudar nada."),
  confidence: z.enum(["high", "medium", "low"]).describe("Quão sustentadas pelos dados estão as lições — amostra pequena = low."),
});
export type PostMortem = z.infer<typeof PostMortemSchema>;
export type PostMortemFn = (args: { summary: WindowSummary; entries: LedgerEntry[]; calibration: string }) => Promise<PostMortem>;

export const aiPostMortem: PostMortemFn = async ({ summary, entries, calibration }) =>
  generateStructured({
    schema: PostMortemSchema,
    maxTokens: 6000,
    system: `You are the post-mortem analyst for a betting-ticket generator. You get the tickets it produced that settled recently, with every leg graded, plus its running calibration. Find what the generator should do differently.
Rules:
- Ground every claim in the legs given. Name the leg, the market, the evidence source and the predicted probability. Never invent a cause.
- Separate variance from error: a 55% leg losing once is not a lesson; the same market or source losing repeatedly at inflated predicted probabilities is.
- Lessons must be rules the generator can follow (e.g. "cap card overs at the teams' own rates unless the referee is confirmed"), not sentiment.
- promptFeedback is what an admin would type to change the prompt: specific, minimal, in Portuguese. Leave it empty if the sample is too small or nothing repeatable appeared. Never propose weakening the integrity rules (no invented prices/players, honest probabilities).`,
    prompt: [
      `PERÍODO: ${summary.tickets} bilhetes liquidados — ${summary.won} ganhos, ${summary.lost} perdidos, ${summary.push} push, ${summary.void} void.`,
      `POR MERCADO: ${JSON.stringify(summary.byMarket)}`, `POR FONTE: ${JSON.stringify(summary.bySource)}`,
      `PERNAS PERDIDAS:\n${summary.lostLegs.map((l) => `- [${l.matchup}] ${l.selection} (${l.market}, fonte ${l.source}, previsto ${(l.predicted * 100).toFixed(0)}%${l.actual ? `, real: ${l.actual}` : ""})`).join("\n") || "- nenhuma"}`,
      `BILHETES (compacto):\n${entries.slice(0, 40).map((e) => `- ${e.outcome.toUpperCase()} ${e.combinedDecimal.toFixed(2)}x "${e.title}" [${e.matchup}] prev ${(e.modelledProbability * 100).toFixed(0)}% — ${e.legs.map((l) => `${l.outcome}:${l.selection}`).join("; ")}`).join("\n")}`,
      `\nCALIBRAÇÃO ACUMULADA:\n${calibration}`,
    ].join("\n\n"),
  });

export interface LearningRunRow {
  id: string; status: string; windowStart: string; windowEnd: string; tickets: number; won: number; lost: number; summary: string;
  report: string; promptFeedback: string; applied: number; appliedBatch: string; costUsd: number; note: string; createdAt: string;
}

export async function runLearning(opts: { sinceHours?: number; minTickets?: number; autoApply?: boolean; now?: Date } = {}, model: PostMortemFn = aiPostMortem): Promise<LearningRunRow> {
  const db = getDb();
  const now = opts.now ?? new Date();
  const windowEnd = now.toISOString();
  const windowStart = new Date(now.getTime() - (opts.sinceHours ?? 24) * 3_600_000).toISOString();
  const entries = settledInWindow(readLedger(), windowStart, windowEnd);
  const summary = summariseWindow(entries);
  const id = newId("lr");
  const minTickets = opts.minTickets ?? 3;

  if (entries.length < minTickets) {
    db.prepare("INSERT INTO learning_runs (id,status,windowStart,windowEnd,tickets,won,lost,note,createdAt) VALUES (?,?,?,?,?,?,?,?,?)")
      .run(id, "skipped", windowStart, windowEnd, summary.tickets, summary.won, summary.lost, `${entries.length} bilhete(s) liquidado(s) no período — mínimo ${minTickets}.`, nowIso());
    return db.prepare("SELECT * FROM learning_runs WHERE id=?").get(id) as LearningRunRow;
  }
  try {
    const pm = await model({ summary, entries, calibration: calibrationPrompt() });
    const cost = lastUsage?.costUsd ?? 0;
    let applied = 0, batch = "";
    if (pm.promptFeedback.trim() && (opts.autoApply ?? process.env.LEARN_AUTO_APPLY === "1")) {
      const out = await applyFeedback({ kind: "game", feedback: pm.promptFeedback, createdBy: "agente (aprendizado)" });
      applied = 1; batch = out.batch;
    }
    db.prepare("INSERT INTO learning_runs (id,status,windowStart,windowEnd,tickets,won,lost,summary,report,promptFeedback,applied,appliedBatch,costUsd,createdAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .run(id, "ok", windowStart, windowEnd, summary.tickets, summary.won, summary.lost, pm.summary, JSON.stringify({ ...pm, byMarket: summary.byMarket, bySource: summary.bySource }), pm.promptFeedback, applied, batch, cost, nowIso());
  } catch (error) {
    db.prepare("INSERT INTO learning_runs (id,status,windowStart,windowEnd,tickets,won,lost,note,createdAt) VALUES (?,?,?,?,?,?,?,?,?)")
      .run(id, "error", windowStart, windowEnd, summary.tickets, summary.won, summary.lost, error instanceof Error ? error.message : "failed", nowIso());
  }
  return db.prepare("SELECT * FROM learning_runs WHERE id=?").get(id) as LearningRunRow;
}

export function listLearningRuns(limit = 20): LearningRunRow[] {
  return getDb().prepare("SELECT * FROM learning_runs ORDER BY createdAt DESC, rowid DESC LIMIT ?").all(limit) as LearningRunRow[];
}

/** The admin's one click: the run's proposed feedback goes through the same path as typed feedback. */
export async function applyLearningRun(id: string, createdBy: string): Promise<{ ok: boolean; rationale?: string; error?: string }> {
  const run = getDb().prepare("SELECT * FROM learning_runs WHERE id=?").get(id) as LearningRunRow | undefined;
  if (!run || !run.promptFeedback.trim()) return { ok: false, error: "Esta run não tem proposta de feedback." };
  if (run.applied) return { ok: false, error: "Já aplicada." };
  const out = await applyFeedback({ kind: "game", feedback: run.promptFeedback, createdBy }, undefined);
  getDb().prepare("UPDATE learning_runs SET applied=1, appliedBatch=? WHERE id=?").run(out.batch, id);
  return { ok: true, rationale: out.rationale };
}
