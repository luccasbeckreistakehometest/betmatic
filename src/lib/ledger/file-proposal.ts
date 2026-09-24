import { getPromptVersion, type RewriteFn } from "@/lib/server/prompts";
import { proposeFromLesson } from "@/lib/ledger/hypotheses";
import { classifyProposal } from "@/lib/ledger/code-gate";
import { createProposal, LEARN_MIN_DECIDED, type ProposalRow } from "@/lib/ledger/proposals";
import { lastUsage } from "@/lib/ai/extract";
import type { FactorStat } from "@/lib/ledger/factor-report";
import type { PostMortem } from "@/lib/ledger/learn";

/**
 * The single door into production.
 *
 * Both post-mortems — the per-game one and the daily window sweep — end here, because two ways to
 * change the prompt means two sets of rules and the weaker one decides. Everything the owner asked
 * for lives in this one function: the code-gate routing, the 20-decided sample gate, the memory of
 * what has already been tried, and the rewrite computed NOW so the operator reads the exact text
 * before clicking rather than after.
 *
 * Nothing here applies anything. It only files a row.
 */

export interface ProposalOrigin {
  /** The game a per-game post-mortem read; empty for the daily window sweep. */
  gameId: string;
  matchup: string;
  sportKey?: string;
}

export interface FileProposalArgs {
  pm: PostMortem;
  /** The measured rows the post-mortem was shown, by id. */
  factors: Map<string, FactorStat>;
  runId: string;
  origin: ProposalOrigin;
  /** Settled tickets the post-mortem read, for the panel. */
  tickets: number;
  rewrite: RewriteFn;
}

export interface FileProposalResult {
  proposal: ProposalRow | null;
  /** In Portuguese, for the run's note: why nothing was queued, when nothing was. */
  note: string;
  costUsd: number;
}

const cost = () => lastUsage?.costUsd ?? 0;

/**
 * One proposal per run reaches the prompt, at most.
 *
 * The post-mortem already speaks with one voice about what to change (`promptFeedback`); the lessons
 * beside it are the measured findings, and the ones the code can check become queue items of their
 * own. Offering three prompt rewrites from one run would put the operator in front of three texts
 * that each assume the other two were not applied.
 */
export async function filePromptProposal(args: FileProposalArgs): Promise<FileProposalResult> {
  const { pm, factors, runId, origin, tickets, rewrite } = args;
  const feedback = pm.promptFeedback.trim();
  if (!feedback) return { proposal: null, note: "", costUsd: 0 };

  const factor = factors.get(pm.promptFeedbackFactorStatId ?? "");
  // The citation rule binds only when there is something to cite: on a ledger too thin for any
  // factor to have a sample, demanding one would silence the loop to enforce a rule about an empty
  // table. With factors on file and none cited, the proposal is not evidence and is dropped.
  if (factors.size && !factor) {
    return { proposal: null, note: "A proposta de prompt foi descartada: não citou um fator medido.", costUsd: 0 };
  }

  // The memory of what has already been tried runs before the queue, not after it. A fingerprint
  // already on file means the operator has seen this idea; a proposal that reverses a live rule is
  // blocked and stays a hypothesis, because two sentences arguing opposite things inside one prompt
  // cancel each other in silence and nobody can read the result.
  const hypothesis = factor ? proposeFromLesson({ factorStatId: factor.id, text: feedback }, factor, runId) : null;
  if (hypothesis?.status === "duplicate") {
    return { proposal: null, note: `A proposta repete uma hipótese já registrada (${hypothesis.note}); não foi enfileirada de novo.`, costUsd: 0 };
  }
  if (hypothesis?.status === "blocked") {
    return { proposal: null, note: `A proposta contradiz uma regra já aplicada (${hypothesis.note}); ficou como hipótese bloqueada, para uma pessoa decidir qual das duas vale.`, costUsd: 0 };
  }

  const base = {
    runId, gameId: origin.gameId, matchup: origin.matchup, sportKey: origin.sportKey ?? "", kind: "game" as const,
    feedback, factorStatId: factor?.id ?? "", tickets, hypothesisId: hypothesis?.id ?? null,
  };
  const evidence = factor
    ? { dim: factor.dim, value: factor.value, scope: factor.scope, legs: factor.legs, hitRate: factor.hitRate, predicted: factor.predicted, qValue: factor.qValue }
    : {};

  // Routed before anything is spent: a rule the code can check never becomes prompt text, so there
  // is nothing to rewrite and no call to pay for.
  const routed = classifyProposal({ text: feedback, dim: factor?.dim });
  if (routed.channel === "code_gate") {
    return {
      proposal: createProposal({ ...base, channel: "code_gate", gate: routed.gate ?? "", rationale: routed.reason, evidence, decided: factor?.legs ?? 0 }),
      note: `A proposta foi classificada como portão de código (${routed.gate}) e não vira texto de prompt.`,
      costUsd: 0,
    };
  }

  // The sample gate is read before the rewrite for the same reason: a proposal that cannot be
  // offered is a proposal that must not cost a model call to write out in full.
  const decided = factor?.legs ?? 0;
  if (decided < LEARN_MIN_DECIDED) {
    return {
      proposal: createProposal({ ...base, channel: "prompt", evidence, decided }),
      note: `A proposta ficou abaixo do portão de amostra (${decided} de ${LEARN_MIN_DECIDED}) e foi registrada sem ser oferecida.`,
      costUsd: 0,
    };
  }

  const current = { pt: getPromptVersion("game", "pt"), en: getPromptVersion("game", "en") };
  const out = await rewrite({ kind: "game", current: { pt: current.pt.content, en: current.en.content }, feedback });
  return {
    proposal: createProposal({
      ...base, channel: "prompt", evidence, decided,
      rationale: out.rationale, contentPt: out.pt, contentEn: out.en,
      basePromptId: current.pt.id ?? "", costUsd: cost(),
    }),
    note: "",
    costUsd: cost(),
  };
}

/**
 * The lessons the code can check, filed as work for a person.
 *
 * A gate already in the queue for the same measured slice is not filed again every night: the
 * operator's list has to be a list of things to do, not a log of the same thing.
 */
export function fileCodeGates(args: {
  lessons: { factorStatId: string; text: string }[];
  factors: Map<string, FactorStat>;
  runId: string;
  origin: ProposalOrigin;
  tickets: number;
  hypothesisIdFor: (factorStatId: string) => string | null;
  alreadyFiled: (gate: string, factorStatId: string) => boolean;
}): ProposalRow[] {
  const out: ProposalRow[] = [];
  for (const lesson of args.lessons) {
    const factor = args.factors.get(lesson.factorStatId);
    if (!factor) continue;
    const routed = classifyProposal({ text: lesson.text, dim: factor.dim });
    if (routed.channel !== "code_gate" || args.alreadyFiled(routed.gate ?? "", factor.id)) continue;
    out.push(createProposal({
      runId: args.runId, gameId: args.origin.gameId, matchup: args.origin.matchup, sportKey: args.origin.sportKey ?? "",
      kind: "game", channel: "code_gate", gate: routed.gate ?? "", feedback: lesson.text, rationale: routed.reason,
      factorStatId: factor.id, decided: factor.legs, tickets: args.tickets,
      evidence: { dim: factor.dim, value: factor.value, scope: factor.scope, legs: factor.legs, hitRate: factor.hitRate, predicted: factor.predicted, qValue: factor.qValue },
      hypothesisId: args.hypothesisIdFor(factor.id),
    }));
  }
  return out;
}
