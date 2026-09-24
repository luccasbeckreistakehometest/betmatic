import { describe, expect, it } from "vitest";
import { classifyProposal } from "@/lib/ledger/code-gate";

/**
 * The routing that stops the loop repeating the product's most expensive mistake: the system prompt
 * already forbade concentrating a slate on one player, the build broke it anyway, and one selection
 * rode 14 tickets and lost 14. A rule the code can check must never become a sentence the model can
 * ignore — and approving it would not change that, which is why the queue has no button for it.
 */
describe("what belongs to the code, not the prompt", () => {
  it("routes a per-player exposure rule by its dimension, whatever the wording", () => {
    const out = classifyProposal({ text: "prefira menos exposição a essa atleta", dim: "athleteId" });
    expect(out.channel).toBe("code_gate");
    expect(out.gate).toBe("player_concentration");
    expect(out.reason).toMatch(/gates\.ts/);
  });

  it("routes a concentration rule written in prose, with no dimension to lean on", () => {
    expect(classifyProposal({ text: "Nunca coloque a mesma jogadora em mais de 3 bilhetes do mesmo build." }).gate)
      .toBe("player_concentration");
  });

  it("routes availability and projected minutes to the gate that already reads them", () => {
    expect(classifyProposal({ text: "não use linhas de quem está no boletim médico como desfalque" }).gate).toBe("availability");
    expect(classifyProposal({ text: "uma lição qualquer", dim: "minutesBucket" }).gate).toBe("availability");
  });

  it("routes a hard threshold, because a cap the build can check belongs where it is enforced", () => {
    expect(classifyProposal({ text: "Nunca dê mais de 85% a um under colado no número." }).gate).toBe("hard_threshold");
    expect(classifyProposal({ text: "No máximo 4 linhas por bilhete." }).gate).toBe("ticket_shape");
  });

  it("routes a disagreement with the computed probability, which is arithmetic the build already does", () => {
    expect(classifyProposal({ text: "qualquer coisa", dim: "computedGapBucket" }).gate).toBe("market_coherence");
  });
});

describe("what is genuinely judgement, and belongs in the prompt", () => {
  it("keeps a rule about which evidence to weigh", () => {
    const out = classifyProposal({ text: "Ancore o total de cartões nas taxas dos próprios times, e não na média do árbitro, quando o árbitro não estiver confirmado.", dim: "stat" });
    expect(out).toEqual({ channel: "prompt", gate: null, reason: "" });
  });

  it("keeps a rule about how to write a thesis", () => {
    expect(classifyProposal({ text: "Explique em uma frase por que a linha está mal precificada, citando a fonte medida.", dim: "band" }).channel).toBe("prompt");
  });

  it("an empty proposal is not a code gate; it is nothing", () => {
    expect(classifyProposal({ text: "   ", dim: "athleteId" }).channel).toBe("prompt");
  });
});
