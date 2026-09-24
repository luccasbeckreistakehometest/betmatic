import { getDb } from "@/lib/server/db";
import { readLedger } from "@/lib/ledger/store";
import { mainTickets } from "@/lib/ledger/proof";
import { armStats, judge, type ArmStats } from "@/lib/ledger/ab";
import { appliedProposals, revertProposal, LEARN_MIN_DECIDED, type ProposalRow } from "@/lib/ledger/proposals";
import { previousVersion } from "@/lib/server/prompts";
import { logEvent } from "@/lib/server/ops-log";
import type { PromptVersion } from "@/lib/server/prompts";
import type { LedgerEntry } from "@/lib/types";

/**
 * Approving is not forever.
 *
 * This is what makes a human click safe to give: a version that goes live and then measures WORSE
 * than the one it replaced comes back on its own, and the reason is written down. Zero tokens — it
 * is arithmetic over the ledger — so it can run on every tick for ever.
 *
 * The comparison is the one the owner asked for in words: did the new version beat the previous
 * one? Not "before and after the date", which lumps in every other change made in between, but the
 * tickets each VERSION actually generated, read off `provenance.promptVersion` filed on each ticket
 * at generation time. A version is a batch (pt and en are written together), so both ids of a batch
 * count for the same arm — otherwise an English night would land in neither.
 *
 * Most answers will be "not enough yet", for a long time, and that is the honest answer rather than
 * a bug: nothing is reverted on a sample that cannot carry the verdict.
 */

/** Decided main tickets each arm needs before a reversion may be decided. */
export const REVERT_MIN_PER_ARM = LEARN_MIN_DECIDED;

const versionsOfBatch = (batch: string): PromptVersion[] =>
  getDb().prepare("SELECT * FROM prompt_versions WHERE batch=?").all(batch) as PromptVersion[];

const versionById = (id: string): PromptVersion | null =>
  (getDb().prepare("SELECT * FROM prompt_versions WHERE id=?").get(id) as PromptVersion | undefined) ?? null;

/**
 * The two populations for one applied change: the ids its own batch wrote, and the ids of whatever
 * stood immediately before each of them.
 *
 * `before` can legitimately be empty — that means the change replaced the code default (v0), whose
 * tickets carry no promptVersion at all — and `null` is how that case is carried through, so an
 * empty id list is never confused with "match nothing".
 */
export function armsOf(proposal: ProposalRow): { after: string[]; before: string[] | null } {
  const applied = proposal.promptVersionId ? versionById(proposal.promptVersionId) : null;
  if (!applied) return { after: [], before: null };
  const batch = applied.batch ? versionsOfBatch(applied.batch) : [applied];
  const previous = batch.map((v) => previousVersion(v.kind, v.lang, v.version)).filter((v): v is PromptVersion => !!v);
  return { after: batch.map((v) => v.id), before: previous.length ? previous.map((v) => v.id) : null };
}

/** A ticket belongs to the v0 arm when it carries no prompt version: the code default wrote it. */
const inArm = (entry: LedgerEntry, ids: string[] | null): boolean =>
  ids === null ? !entry.promptVersion : !!entry.promptVersion && ids.includes(entry.promptVersion);

export interface RevertRow {
  proposalId: string;
  promptVersionId: string;
  before: ArmStats;
  after: ArmStats;
  /** `worse` is the read; `reverted` is the read acted on. The panel shows both as they happened. */
  verdict: "worse" | "reverted" | "ahead" | "tie" | "insufficient";
  note: string;
}

export interface RevertResult {
  checked: number;
  reverted: number;
  rows: RevertRow[];
}

/**
 * Reads every live change without touching anything. The panel shows exactly this, so what an
 * operator sees under "como está medida" is the same computation that decides the rollback — not a
 * second, friendlier one.
 */
export function measureApplied(entries: LedgerEntry[] = readLedger({ excludeLive: true })): RevertRow[] {
  const main = mainTickets(entries.filter((e) => e.scope !== "live"));
  const rows: RevertRow[] = [];

  for (const proposal of appliedProposals()) {
    const { after, before } = armsOf(proposal);
    if (!after.length) continue;

    const armBefore = armStats("versão anterior", main.filter((e) => inArm(e, before)));
    const armAfter = armStats("versão aplicada", main.filter((e) => inArm(e, after)));
    const call = judge(armBefore, armAfter, REVERT_MIN_PER_ARM);
    const numbers = `anterior: ${armBefore.decided} decididos, acerto ${pct(armBefore.hitRate)}, Brier ${num(armBefore.brier)}; aplicada: ${armAfter.decided} decididos, acerto ${pct(armAfter.hitRate)}, Brier ${num(armAfter.brier)}.`;
    const worse = call.verdict === "a";
    rows.push({
      proposalId: proposal.id,
      promptVersionId: proposal.promptVersionId!,
      before: armBefore,
      after: armAfter,
      verdict: worse ? "worse" : call.verdict === "insufficient" ? "insufficient" : call.verdict === "tie" ? "tie" : "ahead",
      note: worse
        ? `A versão aplicada ficou medida abaixo da anterior com amostra acima do portão (${REVERT_MIN_PER_ARM} decididos por braço). ${call.note} ${numbers}`
        : `${call.note} ${numbers}`,
    });
  }
  return rows;
}

/**
 * Measures every live change and rolls back the ones that lost.
 *
 * A reversion is not a verdict about the idea, only about this wording of it at this sample: the
 * hypothesis keeps its row with the verdict `worse`, the losing prompt version stays in the history,
 * and the restored text is filed as a NEW version carrying the sentence that caused the rollback.
 * Nothing is deleted anywhere in this path.
 */
export function runRevertCheck(entries: LedgerEntry[] = readLedger({ excludeLive: true })): RevertResult {
  const rows = measureApplied(entries);
  const out: RevertResult = { checked: rows.length, reverted: 0, rows };

  for (const row of rows) {
    if (row.verdict !== "worse") continue;
    const reason = `Revertida automaticamente: ${row.note}`;
    const done = revertProposal(row.proposalId, reason);
    if (!done.ok) continue;
    out.reverted += 1;
    row.verdict = "reverted";
    row.note = reason;
    logEvent("learn.revert", { proposal: row.proposalId, promptVersion: row.promptVersionId, before: row.before.decided, after: row.after.decided, restored: done.versions });
  }
  return out;
}

const pct = (x: number) => (Number.isFinite(x) ? `${(x * 100).toFixed(0)}%` : "—");
const num = (x: number) => (Number.isFinite(x) ? x.toFixed(3) : "—");
