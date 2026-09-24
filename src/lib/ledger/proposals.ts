import { getDb, newId, nowIso } from "@/lib/server/db";
import { brasiliaDay } from "@/lib/ledger/day";
import { markApplied, markRejected, recordVerdict } from "@/lib/ledger/hypotheses";
import { applyRewrite, getPromptVersion, promptFreeze, revertToPrevious, type FreezeState } from "@/lib/server/prompts";
import type { PromptKind } from "@/lib/bets/prompt-defaults";
import type { Channel } from "@/lib/ledger/code-gate";

/**
 * The approval queue: where a post-mortem's conclusion waits for a person.
 *
 * Three learning runs had already finished with `applied = 0` and `prompt_versions` empty when this
 * was written. The agent was writing good diagnoses into a table nobody read, and whatever reached
 * production reached it because the owner typed it by hand. The loop closes here — but with a human
 * in the middle, on purpose: a proposal is born pending, the operator reads the exact prompt text it
 * would put live, and only a click applies it.
 *
 * Four brakes, none of them optional:
 *   · the sample gate — 20 decided, the number recalibrate.ts already uses, below which a proposal is
 *     filed as `under_gate` and never offered;
 *   · one version per day — without it the before/after cannot attribute an effect to a change;
 *   · the staleness check — an approval applies the text that was shown, or nothing;
 *   · automatic reversion (ledger/revert.ts) — approving is not forever.
 */

/**
 * Decided outcomes a slice needs before a proposal drawn from it may be offered.
 *
 * 20 is the project's own number (ledger/recalibrate.ts MIN_SAMPLE), and it is a floor for
 * OFFERING a change, not a claim that 20 settles anything: separating a few points of edge from
 * noise takes thousands (ledger/ab.ts says so at length). What it does buy is the refusal the
 * product was missing — a rule read off three tickets of one night never becomes a rule at all.
 */
export const LEARN_MIN_DECIDED = 20;

export type ProposalStatus =
  | "pending"      // waiting for the operator
  | "under_gate"   // recorded, not offered: the evidence is below LEARN_MIN_DECIDED
  | "code_gate"    // verifiable in code; it needs an implementation, never a sentence
  | "rejected"     // the operator said no, and said why
  | "applied"      // approved and live
  | "reverted"     // was live, measured worse, rolled back by the safety net
  | "stale";       // the active prompt moved before the operator clicked

export interface ProposalRow {
  id: string;
  runId: string;
  gameId: string;
  matchup: string;
  sportKey: string;
  kind: PromptKind;
  channel: Channel;
  gate: string;
  status: ProposalStatus;
  feedback: string;
  rationale: string;
  contentPt: string;
  contentEn: string;
  basePromptId: string;
  factorStatId: string;
  evidence: string;
  decided: number;
  tickets: number;
  hypothesisId: string | null;
  promptVersionId: string | null;
  promptBatch: string;
  reason: string;
  decidedBy: string;
  costUsd: number;
  createdAt: string;
  decidedAt: string | null;
  appliedAt: string | null;
  revertedAt: string | null;
}

export interface CreateProposal {
  runId: string;
  gameId: string;
  matchup: string;
  sportKey?: string;
  kind: PromptKind;
  channel: Channel;
  gate?: string;
  feedback: string;
  rationale?: string;
  contentPt?: string;
  contentEn?: string;
  basePromptId?: string;
  factorStatId?: string;
  evidence?: unknown;
  decided: number;
  tickets: number;
  hypothesisId?: string | null;
  costUsd?: number;
}

const byId = (id: string): ProposalRow | null =>
  (getDb().prepare("SELECT * FROM learning_proposals WHERE id=?").get(id) as ProposalRow | undefined) ?? null;

export const getProposal = byId;

/**
 * Files a proposal and decides, once, whether it may ever be offered.
 *
 * A code-gate proposal is never `pending`, whatever its sample: there is no click that turns a
 * countable rule into a sentence the model can ignore, so the row opens in a state with no approve
 * button on it. A proposal under the sample gate is filed with the number that failed, because "not
 * enough evidence" is a finding and deleting it would let the same thin idea come back as new.
 */
export function createProposal(input: CreateProposal): ProposalRow {
  const id = newId("lp");
  const underGate = input.decided < LEARN_MIN_DECIDED;
  const status: ProposalStatus = input.channel === "code_gate" ? "code_gate" : underGate ? "under_gate" : "pending";
  const reason = input.channel === "code_gate"
    ? (input.gate ? "" : "verificável em código")
    : underGate
      ? `${input.decided} linha(s) decidida(s) por trás desta proposta — o portão pede ${LEARN_MIN_DECIDED}. Fica registrada e não é oferecida.`
      : "";

  getDb().prepare(
    `INSERT INTO learning_proposals (id,runId,gameId,matchup,sportKey,kind,channel,gate,status,feedback,rationale,contentPt,contentEn,basePromptId,factorStatId,evidence,decided,tickets,hypothesisId,reason,costUsd,createdAt)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    id, input.runId, input.gameId, input.matchup.slice(0, 160), input.sportKey ?? "", input.kind, input.channel, input.gate ?? "",
    status, input.feedback.slice(0, 2000), (input.rationale ?? "").slice(0, 4000), input.contentPt ?? "", input.contentEn ?? "",
    input.basePromptId ?? "", input.factorStatId ?? "", JSON.stringify(input.evidence ?? {}).slice(0, 4000),
    input.decided, input.tickets, input.hypothesisId ?? null, reason, input.costUsd ?? 0, nowIso(),
  );
  return byId(id)!;
}

export function listProposals(limit = 40, status?: ProposalStatus): ProposalRow[] {
  return status
    ? getDb().prepare("SELECT * FROM learning_proposals WHERE status=? ORDER BY createdAt DESC LIMIT ?").all(status, limit) as ProposalRow[]
    : getDb().prepare("SELECT * FROM learning_proposals ORDER BY createdAt DESC LIMIT ?").all(limit) as ProposalRow[];
}

/** Everything the operator still has to look at: a decision to take, or a gate to go and build. */
export const openProposals = (limit = 40): ProposalRow[] =>
  getDb().prepare("SELECT * FROM learning_proposals WHERE status IN ('pending','code_gate') ORDER BY status='pending' DESC, createdAt DESC LIMIT ?").all(limit) as ProposalRow[];

/**
 * What the operator has already turned down, and why.
 *
 * Fed back into the next post-mortem. A refusal is the cheapest supervision there is — it says what
 * this operator does not accept — and throwing it away is how an agent proposes the same rejected
 * idea every night for a week.
 */
export function recentRejections(limit = 8): { feedback: string; reason: string }[] {
  return getDb().prepare("SELECT feedback, reason FROM learning_proposals WHERE status='rejected' AND reason<>'' ORDER BY decidedAt DESC LIMIT ?").all(limit) as { feedback: string; reason: string }[];
}

/** The change already applied today for this prompt kind, if there is one. */
export function appliedToday(kind: PromptKind, now = new Date()): ProposalRow | null {
  const today = brasiliaDay(now.toISOString());
  const rows = getDb().prepare("SELECT * FROM learning_proposals WHERE kind=? AND appliedAt IS NOT NULL ORDER BY appliedAt DESC LIMIT 20").all(kind) as ProposalRow[];
  return rows.find((r) => r.appliedAt && brasiliaDay(r.appliedAt) === today) ?? null;
}

export interface ApproveResult {
  ok: boolean;
  error?: string;
  rationale?: string;
  batch?: string;
  versions?: { id: string; lang: string; version: number }[];
  freeze?: FreezeState;
}

/**
 * The operator's click. Every refusal below is a brake that was asked for, in the order that makes
 * the cheapest one fail first.
 *
 * `override` skips only the freeze, and only a person can pass it — the freeze protects the
 * readability of a measurement, and an operator who has seen what is in the window may decide it is
 * worth spending. The one-per-day cap has no override at all: two versions in a day make the
 * before/after unable to say which one did anything, and an operator cannot see that by looking.
 */
export function approveProposal(id: string, admin: string, opts: { override?: boolean; now?: Date } = {}): ApproveResult {
  const row = byId(id);
  if (!row) return { ok: false, error: "Proposta não encontrada." };
  if (row.channel === "code_gate") {
    return { ok: false, error: "Esta proposta é portão de código: ela precisa de implementação, não de aprovação. Aprová-la só transformaria uma regra verificável em mais uma frase que o modelo pode ignorar." };
  }
  if (row.status !== "pending") return { ok: false, error: `Esta proposta está como "${row.status}" e não está aberta para decisão.` };
  if (row.decided < LEARN_MIN_DECIDED) {
    return { ok: false, error: `A evidência caiu para ${row.decided} linha(s) decidida(s); o portão pede ${LEARN_MIN_DECIDED}.` };
  }
  if (!row.contentPt.trim() || !row.contentEn.trim()) {
    return { ok: false, error: "Esta proposta não carrega o texto do prompt que seria aplicado, então não há o que aprovar." };
  }

  // The text shown is the text applied, or nothing is applied. If the prompt moved since the
  // proposal was written, activating its stored content would silently undo whatever moved it.
  const active = getPromptVersion(row.kind, "pt").id ?? "";
  if (active !== row.basePromptId) {
    getDb().prepare("UPDATE learning_proposals SET status='stale', reason=?, decidedAt=? WHERE id=?")
      .run("O prompt ativo mudou depois que esta proposta foi escrita, então o texto mostrado já não é o que ela aplicaria. Ela não é aplicada; a próxima rodada propõe de novo se a evidência continuar de pé.", nowIso(), id);
    return { ok: false, error: "O prompt ativo mudou desde que esta proposta foi escrita. Ela foi marcada como vencida em vez de aplicada." };
  }

  const already = appliedToday(row.kind, opts.now);
  if (already) {
    return { ok: false, error: `Já houve uma versão aplicada hoje (${already.id}). O teto é de uma por dia, para o comparador conseguir dizer qual mudança fez o quê.` };
  }

  let out: ReturnType<typeof applyRewrite>;
  try {
    out = applyRewrite({
      kind: row.kind, pt: row.contentPt, en: row.contentEn, feedback: row.feedback,
      rationale: row.rationale, createdBy: admin, override: opts.override,
    });
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "falhou", freeze: promptFreeze(row.kind) };
  }

  const pt = out.versions.find((v) => v.lang === "pt") ?? out.versions[0];
  const at = nowIso();
  getDb().prepare("UPDATE learning_proposals SET status='applied', promptVersionId=?, promptBatch=?, decidedBy=?, decidedAt=?, appliedAt=?, reason='' WHERE id=?")
    .run(pt.id, out.batch, admin, at, at, id);
  if (row.hypothesisId) markApplied(row.hypothesisId, pt.id, admin);

  return { ok: true, rationale: out.rationale, batch: out.batch, versions: out.versions.map((v) => ({ id: v.id, lang: v.lang, version: v.version })), freeze: out.freeze };
}

/**
 * The operator's refusal. The reason is required and is kept, because it is the only record of what
 * this operator will not accept — and the next post-mortem is shown it.
 */
export function rejectProposal(id: string, admin: string, reason: string): { ok: boolean; error?: string } {
  const row = byId(id);
  if (!row) return { ok: false, error: "Proposta não encontrada." };
  if (row.status !== "pending" && row.status !== "code_gate" && row.status !== "under_gate") {
    return { ok: false, error: `Esta proposta está como "${row.status}" e não está aberta para decisão.` };
  }
  const text = reason.trim();
  if (text.length < 4) return { ok: false, error: "Diga em uma linha por que está recusando: esse motivo é o que ensina o agente." };

  getDb().prepare("UPDATE learning_proposals SET status='rejected', reason=?, decidedBy=?, decidedAt=? WHERE id=?")
    .run(text.slice(0, 600), admin, nowIso(), id);
  if (row.hypothesisId) markRejected(row.hypothesisId, `recusada pelo operador: ${text}`);
  return { ok: true };
}

/**
 * The safety net's hands: an applied proposal measured worse than what it replaced goes back.
 *
 * The prompt is restored first and the row is marked after, so a failure in the middle leaves a
 * proposal that still says `applied` over a prompt that was already rolled back — which the next
 * pass corrects — rather than a row claiming a reversion that never happened.
 */
export function revertProposal(id: string, reason: string, createdBy = "agente (reversão automática)"): { ok: boolean; error?: string; versions: number } {
  const row = byId(id);
  if (!row) return { ok: false, error: "Proposta não encontrada.", versions: 0 };
  if (row.status !== "applied" || !row.promptVersionId) return { ok: false, error: "Só uma proposta aplicada pode ser revertida.", versions: 0 };

  const versions = revertToPrevious(row.promptVersionId, reason, createdBy);
  getDb().prepare("UPDATE learning_proposals SET status='reverted', reason=?, revertedAt=? WHERE id=?").run(reason.slice(0, 600), nowIso(), id);
  if (row.hypothesisId) recordVerdict(row.hypothesisId, "worse", reason);
  return { ok: true, versions: versions.length };
}

/** Everything live right now: what the reversion check has to keep measuring. */
export const appliedProposals = (): ProposalRow[] =>
  getDb().prepare("SELECT * FROM learning_proposals WHERE status='applied' AND promptVersionId IS NOT NULL ORDER BY appliedAt DESC").all() as ProposalRow[];
