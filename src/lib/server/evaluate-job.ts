import { appliedHypotheses, recordVerdict, type HypothesisVerdict } from "@/lib/ledger/hypotheses";
import { beforeAfter } from "@/lib/ledger/ab";
import { readLedger } from "@/lib/ledger/store";

/**
 * The half of learning that nobody builds: going back to check.
 *
 * A rule gets proposed, an admin applies it, and that is normally where the story ends — the prompt
 * grows a paragraph a week and nobody can say whether any of them helped. This job reads every
 * applied hypothesis, compares the tickets written before the prompt version that carried it against
 * the ones written after, and files the answer next to the rule. Zero tokens: it is arithmetic over
 * the ledger, so it can run every day forever.
 *
 * Most answers will be "inconclusive" for a long time, and that is the honest answer, not a bug:
 * `beforeAfter` refuses a verdict under 100 decided main tickets per arm.
 */
const VERDICT: Record<"a" | "b" | "tie" | "insufficient", HypothesisVerdict> = {
  // "a" is the before arm: the record was better before the rule went in.
  a: "worse",
  b: "improved",
  tie: "no_change",
  insufficient: "inconclusive",
};

export interface EvaluateResult {
  evaluated: number;
  improved: number;
  worse: number;
  inconclusive: number;
  skipped: number;
  rows: { id: string; verdict: HypothesisVerdict; note: string }[];
}

export function runEvaluateJob(): EvaluateResult {
  const entries = readLedger({ excludeLive: true });
  const out: EvaluateResult = { evaluated: 0, improved: 0, worse: 0, inconclusive: 0, skipped: 0, rows: [] };

  for (const h of appliedHypotheses()) {
    // A rule applied by hand, with no prompt version behind it, has no "before" to compare against.
    if (!h.promptVersionId) { out.skipped += 1; continue; }
    const cmp = beforeAfter(h.promptVersionId, entries);
    const verdict = VERDICT[cmp.verdict];
    const note = `${cmp.note} antes: ${cmp.a.decided} decididos, acerto ${pct(cmp.a.hitRate)}; depois: ${cmp.b.decided} decididos, acerto ${pct(cmp.b.hitRate)}.`;
    recordVerdict(h.id, verdict, note);
    out.evaluated += 1;
    if (verdict === "improved") out.improved += 1;
    else if (verdict === "worse") out.worse += 1;
    else if (verdict === "inconclusive") out.inconclusive += 1;
    out.rows.push({ id: h.id, verdict, note });
  }
  return out;
}

const pct = (x: number) => (Number.isFinite(x) ? `${(x * 100).toFixed(0)}%` : "—");
