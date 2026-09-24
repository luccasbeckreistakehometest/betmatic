/**
 * Which proposals must never become prompt text.
 *
 * The most expensive lesson of 23/09/2026: the system prompt already forbade concentrating a slate
 * on one player, and the build broke it anyway — Ariel Atkins under 6.5 points rode 14 tickets and
 * lost all 14. A rule that asks the model to police itself is a preference, not a gate, and writing
 * it into the prompt a second time buys nothing but a longer prompt. bets/gates.ts is what actually
 * holds, because it counts.
 *
 * So a proposal is routed before it is offered. If what it asks for can be decided by COUNTING or
 * COMPARING values the builder already holds at emit time, it is a code gate: it goes to the queue
 * marked as needing an implementation, never as a sentence, and no approve button can turn it into
 * one. Everything else — how to weigh a source, which thesis to prefer, how to phrase a probability
 * — is judgement, which is exactly what a prompt is for.
 *
 * The routing is deliberately conservative in one direction only: a rule wrongly sent to the prompt
 * is a sentence the model may ignore, which is the failure the product already had. A rule wrongly
 * sent to the code queue is a change that waits for a human. Neither is free, and the rules below
 * fire on explicit, checkable shapes rather than on a hunch about the wording.
 */

export type Channel = "prompt" | "code_gate";

export interface CodeGateRule {
  /** The gate this would belong to, named after bets/gates.ts where one already exists. */
  id: string;
  /** Portuguese, for the panel: what a human has to go and implement. */
  why: string;
  /** Factor dimensions whose rule is, by construction, a count or a comparison the code can make. */
  dims: string[];
  patterns: RegExp[];
}

/**
 * Each rule names something the builder can already answer without asking a model.
 *
 * `dims` are the factor-report dimensions (ledger/factors.ts). A factor cut by `athleteId` is a
 * statement about one player's exposure, which is a count; `minutesBucket` is the projection the
 * availability gate already reads; `computedGapBucket` is the distance between the model's number
 * and the one the code computed, which is arithmetic the code does on every leg; `ticketSize` is the
 * number of legs, which cross-policy.ts already caps.
 */
export const CODE_GATE_RULES: CodeGateRule[] = [
  {
    id: "player_concentration",
    why: "Quantos bilhetes uma mesma jogadora carrega é contagem, e o teto já existe em bets/gates.ts (capPlayerConcentration). Isto é ajuste de portão, não frase de prompt.",
    dims: ["athleteId"],
    patterns: [
      /\b(concentra|concentração|concentracao)\w*/i,
      /\bmesm[ao]s?\s+(jogador|jogadora|atleta|player|seleção|selecao|linha)/i,
      /\b(mais de|máximo de|maximo de|no máximo|no maximo|limite de|até)\s+\d+\s+(bilhete|bilhetes|ticket|tickets)/i,
      /\b(um|uma|the same|a single)\s+(jogador|jogadora|player)\w*\s+(em|in)\s+\d+/i,
    ],
  },
  {
    id: "availability",
    why: "Quem está fora, e quantos minutos a projeção dá, o código já lê linha a linha (bets/gates.ts, unplayableReason). Isto é ajuste de portão, não frase de prompt.",
    dims: ["minutesBucket"],
    patterns: [
      /\b(desfalque|lesion\w*|escala(ção|cao)|listed out|injury report|boletim médico|boletim medico)\b/i,
      /\b(fora|out)\b[^.]{0,40}\b(lista|report|relatório|relatorio)\b/i,
      /\bminutos?\s+(projetad|esperad|previst)\w*/i,
      /\bprojected minutes\b/i,
    ],
  },
  {
    id: "market_coherence",
    why: "A distância entre o número do modelo e o número calculado pelo código é aritmética que o build já faz em toda linha. Isto é ajuste de portão, não frase de prompt.",
    dims: ["computedGapBucket"],
    patterns: [
      /\b(over e under|under e over|os dois lados|both sides|ambos os lados)\b/i,
      /\b(contradit|contradi(z|tória|toria)|incoerent|incoherent)\w*/i,
      /\b(probabilidade|probability)\b[^.]{0,60}\b(calculad|computed|do código|do codigo)\w*/i,
    ],
  },
  {
    id: "ticket_shape",
    why: "Quantas linhas um bilhete tem é contagem, e bets/cross-policy.ts já impõe um teto. Isto é ajuste de portão, não frase de prompt.",
    dims: ["ticketSize"],
    patterns: [
      /\b(mais de|máximo de|maximo de|no máximo|no maximo|limite de|nunca mais de)\s+\d+\s+(linha|linhas|perna|pernas|leg|legs)/i,
      /\b(at most|no more than)\s+\d+\s+legs?\b/i,
    ],
  },
  {
    id: "hard_threshold",
    why: "A proposta fixa um número que o build pode checar antes de emitir. Um teto verificável pertence ao código, que descarta o bilhete, e não ao prompt, que só pede.",
    dims: [],
    patterns: [
      // An imperative refusal plus a number plus something countable: a threshold, not judgement.
      /\b(nunca|jamais|não emit\w*|nao emit\w*|não use|nao use|não inclua|nao inclua|descart\w*|never emit|never use|drop)\b[^.]{0,80}\b\d+(?:[.,]\d+)?\s*(?:%|\b(?:por cento|minutos?|linhas?|bilhetes?|legs?|tickets?|minutes?)\b)/i,
      /\b(no máximo|no maximo|máximo de|maximo de|limite de|teto de|cap(?:ped)? at|at most)\s+\d+(?:[.,]\d+)?\s*(?:%|\b(?:por cento|minutos?|linhas?|bilhetes?|legs?|tickets?|minutes?)\b)/i,
    ],
  },
];

export interface Classification {
  channel: Channel;
  /** The rule that caught it, when it is a code gate. */
  gate: string | null;
  /** In Portuguese, for the operator: why this is not going into the prompt. */
  reason: string;
}

const PROMPT: Classification = { channel: "prompt", gate: null, reason: "" };

/**
 * Routes one proposal. `dim` is the factor dimension it cites (ledger/factors.ts); `text` is what
 * the post-mortem wants changed. The dimension decides first, because it is structural and a
 * rephrasing cannot dodge it; the wording is the second reading, for a rule that names a threshold
 * while citing a dimension the code does not index.
 */
export function classifyProposal(input: { text: string; dim?: string }): Classification {
  const dim = (input.dim ?? "").trim();
  const text = (input.text ?? "").trim();
  if (!text) return PROMPT;

  for (const rule of CODE_GATE_RULES) {
    if (dim && rule.dims.includes(dim)) {
      return { channel: "code_gate", gate: rule.id, reason: rule.why };
    }
  }
  for (const rule of CODE_GATE_RULES) {
    if (rule.patterns.some((p) => p.test(text))) {
      return { channel: "code_gate", gate: rule.id, reason: rule.why };
    }
  }
  return PROMPT;
}
