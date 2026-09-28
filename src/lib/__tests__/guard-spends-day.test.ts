import { describe, expect, it, beforeEach } from "vitest";
import path from "node:path";
import fs from "node:fs";

/**
 * O dia só é gasto quando houve trabalho.
 *
 * Em 27/09/2026 o job das múltiplas rodou às 03:00 UTC — que ainda é o dia anterior na chave de
 * horário do Leste com que a grade é endereçada. Viu zero jogos, gerou nada, e marcou o dia como
 * feito. Quando os quatro jogos entraram no cardápio, ele já estava "pronto por hoje", e a seção de
 * múltiplas ficou vazia a noite inteira. Zero bilhetes por causa de fuso horário.
 */
const DIR = path.join(process.cwd(), "data", "unit-guard-spends");
process.env.DATA_DIR = DIR;
fs.rmSync(DIR, { recursive: true, force: true });

const { onceADay, alreadyRanToday } = await import("@/lib/server/job-guard");
const { getDb } = await import("@/lib/server/db");

beforeEach(() => { getDb().prepare("DELETE FROM job_runs").run(); });

describe("onceADay e o dia que não foi gasto", () => {
  it("um trabalho de verdade fecha o dia", async () => {
    const out = await onceADay("x", () => ({ feito: 1 }), { spendsDay: (r) => r.feito > 0 });
    expect(out.ran).toBe(true);
    expect(alreadyRanToday("x")).toBe(true);
  });

  it("um trabalho sem material deixa o dia aberto para o próximo tique", async () => {
    const primeiro = await onceADay("y", () => ({ feito: 0 }), { spendsDay: (r) => r.feito > 0 });
    expect(primeiro.ran).toBe(false);
    expect(primeiro.note).toMatch(/não tinha material ainda/);
    expect(alreadyRanToday("y")).toBe(false);

    // O tique seguinte, já com material, roda de verdade — que é o que faltou em 27/09.
    const segundo = await onceADay("y", () => ({ feito: 3 }), { spendsDay: (r) => r.feito > 0 });
    expect(segundo.ran).toBe(true);
    expect(alreadyRanToday("y")).toBe(true);
  });

  it("sem o predicado, o comportamento antigo continua valendo", async () => {
    const out = await onceADay("z", () => ({ feito: 0 }));
    expect(out.ran).toBe(true);
    expect(alreadyRanToday("z")).toBe(true);
  });

  it("um erro nunca fecha o dia", async () => {
    await expect(onceADay("w", () => { throw new Error("quebrou"); })).rejects.toThrow("quebrou");
    expect(alreadyRanToday("w")).toBe(false);
  });
});
