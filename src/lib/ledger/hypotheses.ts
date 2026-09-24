import { createHash } from "node:crypto";
import { getDb, newId, nowIso } from "@/lib/server/db";
import type { FactorStat } from "@/lib/ledger/factor-report";

/**
 * The memory of what has already been tried.
 *
 * Without it every learning run is the first one: the same idea gets proposed a fourth time, and a
 * rule that reverses a rule already live cancels it in silence, leaving a prompt nobody can read.
 * A hypothesis is identified by what it claims, not by how it was phrased — `fingerprint` is
 * sha1(dim + value + direction + bucket) — so two different sentences about the same thing collide
 * on purpose.
 */

export type HypothesisStatus = "proposed" | "applied" | "rejected" | "superseded" | "blocked";
export type HypothesisVerdict = "improved" | "no_change" | "worse" | "inconclusive";
export type Direction = "lower" | "raise" | "avoid" | "prefer";

export interface Hypothesis {
  id: string;
  fingerprint: string;
  dim: string;
  value: string;
  direction: Direction;
  bucket: string;
  /** The factor_stats row that justifies it. A proposal without one is not stored. */
  factorStatId: string;
  text: string;
  runId: string;
  status: HypothesisStatus;
  verdict: HypothesisVerdict | null;
  verdictNote: string;
  supersedes: string | null;
  promptVersionId: string | null;
  createdBy: string;
  createdAt: string;
  appliedAt: string | null;
  evaluatedAt: string | null;
}

export const fingerprintOf = (input: { dim: string; value: string; direction: Direction; bucket?: string }): string =>
  createHash("sha1").update([input.dim, input.value, input.direction, input.bucket ?? ""].join("|").toLowerCase()).digest("hex").slice(0, 16);

/** Two directions that cannot both be live: raising and lowering the same thing. */
const OPPOSITE: Record<Direction, Direction> = { lower: "raise", raise: "lower", avoid: "prefer", prefer: "avoid" };

export const contradicts = (a: Pick<Hypothesis, "dim" | "value" | "bucket" | "direction">, b: Pick<Hypothesis, "dim" | "value" | "bucket" | "direction">): boolean =>
  a.dim === b.dim && a.value === b.value && (a.bucket ?? "") === (b.bucket ?? "") && OPPOSITE[a.direction] === b.direction;

export interface ProposeInput {
  dim: string;
  value: string;
  direction: Direction;
  bucket?: string;
  factorStatId: string;
  text: string;
  runId?: string;
  createdBy?: string;
}

export interface ProposeResult {
  status: "stored" | "duplicate" | "blocked" | "unsupported";
  hypothesis: Hypothesis | null;
  /** The earlier row this one points at, when it was refused. */
  previous: Hypothesis | null;
  note: string;
}

const rowsOf = (sql: string, ...args: unknown[]) => getDb().prepare(sql).all(...args) as Hypothesis[];
const byId = (id: string) => (getDb().prepare("SELECT * FROM rule_hypotheses WHERE id=?").get(id) as Hypothesis | undefined) ?? null;

/**
 * Stores a proposal, or refuses it and says which earlier row it collided with.
 *
 * Three refusals, in order: a proposal that cites no measured factor is not a hypothesis; a
 * fingerprint already on file is a repeat; and a proposal that reverses a rule currently applied is
 * `blocked` — the operator decides which of the two is right, and no job ever applies a blocked
 * row (`markApplied` refuses it outright).
 */
export function proposeHypothesis(input: ProposeInput, knownFactorIds: Set<string>): ProposeResult {
  if (!input.factorStatId || !knownFactorIds.has(input.factorStatId)) {
    return { status: "unsupported", hypothesis: null, previous: null, note: "a proposta não cita um factorStatId existente" };
  }
  const fingerprint = fingerprintOf(input);
  const existing = rowsOf("SELECT * FROM rule_hypotheses WHERE fingerprint=? AND status IN ('proposed','applied') ORDER BY createdAt DESC", fingerprint)[0] ?? null;
  if (existing) return { status: "duplicate", hypothesis: null, previous: existing, note: `já proposta em ${existing.createdAt}` };

  const live = rowsOf("SELECT * FROM rule_hypotheses WHERE status='applied' AND dim=? AND value=?", input.dim, input.value)
    .find((h) => contradicts({ ...input, bucket: input.bucket ?? "" }, h)) ?? null;

  const id = newId("hyp");
  getDb().prepare(
    `INSERT INTO rule_hypotheses (id, fingerprint, dim, value, direction, bucket, factorStatId, text, runId, status, supersedes, createdBy, createdAt)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(id, fingerprint, input.dim, input.value, input.direction, input.bucket ?? "", input.factorStatId, input.text.slice(0, 600), input.runId ?? "",
    live ? "blocked" : "proposed", live?.id ?? null, input.createdBy ?? "agente (aprendizado)", nowIso());

  return live
    ? { status: "blocked", hypothesis: byId(id), previous: live, note: `contradiz a regra aplicada ${live.id}` }
    : { status: "stored", hypothesis: byId(id), previous: null, note: "" };
}

export function listHypotheses(limit = 60, status?: HypothesisStatus): Hypothesis[] {
  return status
    ? rowsOf("SELECT * FROM rule_hypotheses WHERE status=? ORDER BY createdAt DESC LIMIT ?", status, limit)
    : rowsOf("SELECT * FROM rule_hypotheses ORDER BY createdAt DESC LIMIT ?", limit);
}

/** Marking one applied: it is now the live rule, and its opposite can no longer be proposed quietly. */
export function markApplied(id: string, promptVersionId: string | null, createdBy: string): Hypothesis | null {
  const row = byId(id);
  // A blocked row is never applied by a job — only a person who has seen what it contradicts.
  if (!row || row.status === "blocked") return null;
  getDb().prepare("UPDATE rule_hypotheses SET status='applied', promptVersionId=?, appliedAt=?, createdBy=? WHERE id=?").run(promptVersionId, nowIso(), createdBy, id);
  return byId(id);
}

/** The operator's own override: a blocked row becomes proposable again, with who unblocked it. */
export function unblockHypothesis(id: string, createdBy: string): Hypothesis | null {
  const row = byId(id);
  if (!row || row.status !== "blocked") return null;
  getDb().prepare("UPDATE rule_hypotheses SET status='proposed', createdBy=? WHERE id=?").run(createdBy, id);
  return byId(id);
}

/**
 * The operator turned it down. The row stays — nothing is deleted here — but it stops being a live
 * claim, so the fingerprint no longer blocks the idea from being raised again if the measurement
 * comes back stronger. What keeps the agent from simply re-proposing it tomorrow is not this table:
 * it is the refusal's own reason, which the next post-mortem is shown.
 */
export function markRejected(id: string, note: string): Hypothesis | null {
  const row = byId(id);
  if (!row) return null;
  getDb().prepare("UPDATE rule_hypotheses SET status='rejected', verdict='no_change', verdictNote=?, evaluatedAt=? WHERE id=?").run(note.slice(0, 400), nowIso(), id);
  return byId(id);
}

export function recordVerdict(id: string, verdict: HypothesisVerdict, note: string): Hypothesis | null {
  getDb().prepare("UPDATE rule_hypotheses SET verdict=?, verdictNote=?, evaluatedAt=? WHERE id=?").run(verdict, note.slice(0, 400), nowIso(), id);
  return byId(id);
}

export const appliedHypotheses = (): Hypothesis[] => rowsOf("SELECT * FROM rule_hypotheses WHERE status='applied' ORDER BY appliedAt DESC");

/**
 * Which way a lit factor points is not the model's opinion: a slice whose real hit rate sits below
 * what was predicted is one the generator should lean away from, and above is one it should lean
 * into. Deriving the direction from the measurement is what lets `contradicts()` recognise the
 * reversal later — two sentences arguing opposite things about the same slice collide by fingerprint
 * instead of quietly cancelling each other inside the prompt.
 */
export function proposeFromLesson(lesson: { factorStatId: string; text: string }, factor: FactorStat, runId: string) {
  const direction: Direction = factor.gap > 0 ? "lower" : "raise";
  const out = proposeHypothesis(
    { dim: factor.dim, value: factor.value, direction, bucket: factor.scope, factorStatId: factor.id, text: lesson.text, runId },
    new Set([factor.id]),
  );
  return { status: out.status, note: out.note, id: out.hypothesis?.id ?? null, previous: out.previous?.id ?? null, factorStatId: factor.id, text: lesson.text };
}
