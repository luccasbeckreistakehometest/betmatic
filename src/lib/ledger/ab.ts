import { getDb } from "@/lib/server/db";
import { readLedger } from "@/lib/ledger/store";
import { mainTickets } from "@/lib/ledger/proof";
import type { LedgerEntry } from "@/lib/types";

/**
 * Before and after, with the courage to say "not yet".
 *
 * Every number in here exists to stop one failure mode: reading a change's effect off a sample too
 * small to carry it. To separate +3 % from zero in a 2.0x band takes roughly 4,300 bets — two years
 * at five a day — so every comparison below refuses a verdict under a stated minimum and says so in
 * words, rather than printing a percentage that looks like an answer.
 */

/** Below this many decided main tickets per arm, no verdict is issued. */
export const AB_MIN_PER_ARM = 100;

export interface ArmStats {
  key: string;
  decided: number;
  won: number;
  hitRate: number;
  /** Mean modelled probability — the calibration side of the comparison. */
  predicted: number;
  brier: number;
  /** Flat one-unit ROI. Informational: the sample that would make it a verdict is huge. */
  roi: number;
}

export interface Comparison {
  a: ArmStats;
  b: ArmStats;
  verdict: "a" | "b" | "tie" | "insufficient";
  /** Always present, and always honest about what the sample can carry. */
  note: string;
}

const decided = (e: LedgerEntry) => e.outcome === "won" || e.outcome === "lost";

export function armStats(key: string, entries: LedgerEntry[]): ArmStats {
  const rows = entries.filter(decided);
  const won = rows.filter((e) => e.outcome === "won").length;
  const pnl = rows.reduce((a, e) => a + (e.outcome === "won" ? e.combinedDecimal - 1 : -1), 0);
  const brier = rows.length ? rows.reduce((a, e) => a + (e.modelledProbability - (e.outcome === "won" ? 1 : 0)) ** 2, 0) / rows.length : NaN;
  return {
    key, decided: rows.length, won,
    hitRate: rows.length ? won / rows.length : NaN,
    predicted: rows.length ? rows.reduce((a, e) => a + e.modelledProbability, 0) / rows.length : NaN,
    brier, roi: rows.length ? pnl / rows.length : NaN,
  };
}

/** Below this much Brier difference the two arms are the same arm, and saying otherwise is noise. */
export const BRIER_TIE = 0.005;

/** Lower Brier wins, and only when both arms are big enough for the answer to mean anything. */
export function judge(a: ArmStats, b: ArmStats, minPerArm: number): Pick<Comparison, "verdict" | "note"> {
  if (a.decided < minPerArm || b.decided < minPerArm) {
    return { verdict: "insufficient", note: `amostra insuficiente: ${a.decided} e ${b.decided} bilhetes decididos, mínimo de ${minPerArm} por braço.` };
  }
  const delta = b.brier - a.brier;
  if (Math.abs(delta) < BRIER_TIE) return { verdict: "tie", note: `empate dentro do ruído: a diferença de Brier é menor que ${BRIER_TIE.toFixed(3)}.` };
  return { verdict: delta > 0 ? "a" : "b", note: `${delta > 0 ? a.key : b.key} tem o Brier menor por ${Math.abs(delta).toFixed(3)}.` };
}

/** Two prompt versions, on the tickets each of them actually generated. */
export function versionCompare(entries: LedgerEntry[], a: string, b: string, minPerArm = AB_MIN_PER_ARM): Comparison {
  const main = mainTickets(entries.filter((e) => e.scope !== "live"));
  const armA = armStats(a, main.filter((e) => e.promptVersion === a));
  const armB = armStats(b, main.filter((e) => e.promptVersion === b));
  return { a: armA, b: armB, ...judge(armA, armB, minPerArm) };
}

/**
 * A rule's effect: the tickets generated BEFORE the prompt version that carried it against the ones
 * generated after. Only tickets created after `createdAt` count as "after" — a ticket written
 * before the change cannot show its effect, and counting it is the most common way this is faked.
 */
export function beforeAfter(promptVersionId: string, entries: LedgerEntry[] = readLedger({ excludeLive: true }), minPerArm = AB_MIN_PER_ARM): Comparison & { appliedAt: string | null } {
  const row = getDb().prepare("SELECT createdAt FROM prompt_versions WHERE id=?").get(promptVersionId) as { createdAt: string } | undefined;
  const main = mainTickets(entries.filter((e) => e.scope !== "live"));
  if (!row) return { ...versionCompare([], "antes", "depois", minPerArm), appliedAt: null };
  const before = armStats("antes", main.filter((e) => e.createdAt < row.createdAt));
  const after = armStats("depois", main.filter((e) => e.createdAt >= row.createdAt));
  return { a: before, b: after, ...judge(before, after, minPerArm), appliedAt: row.createdAt };
}

/**
 * The stake A/B of §2f: the formula against the owner's own band ladder, on the same short lists.
 * Alternated by day so neither arm gets the easy nights, and refused a verdict on the same rule.
 */
export function stakePolicyForDay(day: string): "formula" | "escada" {
  const n = Number(day.replaceAll("-", ""));
  return Number.isFinite(n) && n % 2 === 0 ? "formula" : "escada";
}

export interface StakeArm { key: "formula" | "escada"; days: number; bets: number; units: number; pnl: number; roi: number }

/** What each arm actually risked and what came back, read from the filed short lists. */
export function stakePolicyCompare(minPerArm = AB_MIN_PER_ARM): { arms: StakeArm[]; verdict: string } {
  const rows = getDb().prepare(
    `SELECT i.stakePolicy AS key, i.day, i.ledgerId, i.units, i.ladderUnits, i.oddsDecimal
     FROM daily_selection_items i WHERE i.scope='pre'`,
  ).all() as { key: "formula" | "escada"; day: string; ledgerId: string; units: number; ladderUnits: number; oddsDecimal: number }[];
  const outcomes = new Map(readLedger().map((e) => [e.id, e]));

  const arms: StakeArm[] = (["formula", "escada"] as const).map((key) => {
    const own = rows.filter((r) => r.key === key);
    const staked = own.reduce((a, r) => a + (key === "formula" ? r.units : r.ladderUnits), 0);
    const pnl = own.reduce((a, r) => {
      const entry = outcomes.get(r.ledgerId);
      if (!entry || (entry.outcome !== "won" && entry.outcome !== "lost")) return a;
      const u = key === "formula" ? r.units : r.ladderUnits;
      return a + (entry.outcome === "won" ? u * (entry.combinedDecimal - 1) : -u);
    }, 0);
    const bets = own.filter((r) => { const e = outcomes.get(r.ledgerId); return e && (e.outcome === "won" || e.outcome === "lost"); }).length;
    return { key, days: new Set(own.map((r) => r.day)).size, bets, units: staked, pnl, roi: staked ? pnl / staked : NaN };
  });

  const short = arms.some((a) => a.bets < minPerArm);
  return {
    arms,
    verdict: short
      ? `amostra insuficiente: ${arms.map((a) => `${a.key} ${a.bets}`).join(", ")} bilhetes decididos, mínimo de ${minPerArm} por braço. Se a escada empatar daqui a alguns meses, a escada vence por ser mais simples.`
      : arms[0].roi > arms[1].roi ? "a fórmula está à frente no retorno por unidade arriscada." : "a régua de faixa está à frente no retorno por unidade arriscada.",
  };
}
