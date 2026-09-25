import { describe, expect, it } from "vitest";
import { CAP_MIN_GAP, CAP_MIN_LEGS, MEASURED_CAPS, applyMeasuredCaps } from "@/lib/bets/gates";

/**
 * Os tetos medidos: o que o laço de aprendizado aprendeu em 21 jogos, virado código.
 *
 * Eles só puxam para baixo, e isso é a regra que estes testes existem para guardar. Um teto que
 * pudesse subir número precisaria estar certo nas duas direções para não fazer mal, e a medição que
 * temos não sustenta isso — sustenta que certas fatias prometem muito mais do que entregam.
 */

const perna = (fairProbability: number, extra: Partial<{ settlement: { side?: string } | null; sourceBasis: string }> = {}) =>
  ({ fairProbability, settlement: null, sourceBasis: "measured history", ...extra });

describe("tetos medidos", () => {
  it("nunca sobem um número, em nenhum escopo", () => {
    for (const escopo of ["pre", "live"] as const) {
      for (let p = 0.02; p < 1; p += 0.01) {
        const out = applyMeasuredCaps(perna(p), escopo);
        expect(out.fairProbability).toBeLessThanOrEqual(p + 1e-9);
      }
    }
  });

  it("derruba a zona morta do pré-jogo para a entrega medida", () => {
    // 106 pernas decididas: prometeu 62%, entregou 31%.
    const out = applyMeasuredCaps(perna(0.65), "pre");
    expect(out.fairProbability).toBeCloseTo(0.31, 6);
    expect(out.applied.map((a) => a.id)).toContain("pre_zona_morta");
  });

  it("deixa em paz a faixa logo abaixo, que está calibrada", () => {
    // 50-60% no pré-jogo: 352 pernas, −2 pontos. Mexer nela seria estragar o que funciona.
    for (const p of [0.5, 0.55, 0.599]) {
      expect(applyMeasuredCaps(perna(p), "pre").applied).toHaveLength(0);
    }
  });

  it("não aplica a zona morta do pré-jogo ao ao vivo, onde a faixa está calibrada", () => {
    // Ao vivo, 60-70% erra 1 ponto em 151 pernas.
    expect(applyMeasuredCaps(perna(0.65), "live").applied.map((a) => a.id)).not.toContain("pre_zona_morta");
  });

  it("teta tudo acima de 80% no ao vivo", () => {
    for (const p of [0.85, 0.93, 0.99]) {
      const out = applyMeasuredCaps(perna(p), "live");
      expect(out.fairProbability).toBeCloseTo(0.8, 6);
      expect(out.applied.map((a) => a.id)).toContain("live_alta_confianca");
    }
  });

  it("não teta alta confiança no pré-jogo, onde a faixa é SUBconfiante", () => {
    // A proposta que pedia isso citava 191 pernas a 63% — que são do ao vivo. No pré-jogo essa faixa
    // tem 17 pernas e entrega 100%. O teto teria cortado bilhete bom por uma fatia lida do escopo
    // errado, e este teste existe para que ninguém o reintroduza sem medir.
    const out = applyMeasuredCaps(perna(0.85), "pre");
    expect(out.applied).toHaveLength(0);
    expect(out.fairProbability).toBeCloseTo(0.85, 6);
  });

  it("deixa passar a fatia que não alcança o piso de evidência", () => {
    // Linha de casa em 1,5-2x erra 9 pontos em 166 pernas. Nove é menos que dez, então não vira
    // teto — e o invariante abaixo é o que impede alguém de baixar o piso para ela caber.
    const out = applyMeasuredCaps(perna(0.55, { sourceBasis: "book line" }), "pre");
    expect(out.applied).toHaveLength(0);
  });

  it("cada teto carrega a evidência que o sustenta, acima do piso de amostra", () => {
    for (const c of MEASURED_CAPS) {
      expect(c.legs).toBeGreaterThanOrEqual(CAP_MIN_LEGS);
      expect(Math.abs(c.claimed - c.delivered) * 100).toBeGreaterThanOrEqual(CAP_MIN_GAP);
      expect(c.why).toMatch(/pernas/);
      // O teto nunca é mais generoso que o que a fatia entregou de verdade.
      expect(c.cap).toBeLessThan(c.claimed);
    }
  });

  it("um número já honesto atravessa sem tocar em nada", () => {
    const out = applyMeasuredCaps(perna(0.52), "pre");
    expect(out.applied).toHaveLength(0);
    expect(out.fairProbability).toBeCloseTo(0.52, 6);
  });
});
