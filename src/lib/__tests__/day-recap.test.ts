import { describe, expect, it } from "vitest";
import { buildDayRecap, renderDayRecap } from "@/lib/server/day-recap";
import type { LedgerEntry } from "@/lib/types";

const e = (id: string, gameId: string, matchup: string, startsAt: string, outcome: LedgerEntry["outcome"], odds: number, scope?: "live", period?: number, alt = false): LedgerEntry => ({
  id, gameId, sportKey: "wnba", matchup, createdAt: startsAt, startsAt, settledAt: startsAt, bandKey: "mid", kind: "parlay", title: id,
  combinedDecimal: odds, modelledProbability: 0.3, outcome, ...(scope ? { scope, period, minute: 20 } : {}), ...(alt ? { alternativeOf: "x" } : {}), legs: [],
});

// The operator asked not to watch anything: the night's picture arrives by mail once it has settled.
describe("the day's recap", () => {
  const rows = [
    // 22/09 in Brasília: a game at 23:30Z on the 22nd is still the 22nd (20:30 BRT).
    e("pre-w", "g1", "CON @ WSH", "2026-09-22T23:30:00.000Z", "won", 1.8),
    e("pre-l", "g1", "CON @ WSH", "2026-09-22T23:30:00.000Z", "lost", 5.4),
    e("alt", "g1", "CON @ WSH", "2026-09-22T23:30:00.000Z", "won", 2, undefined, undefined, true),
    e("q2-w", "g1", "CON @ WSH", "2026-09-22T23:30:00.000Z", "won", 3.5, "live", 2),
    e("q3-l", "g1", "CON @ WSH", "2026-09-22T23:30:00.000Z", "lost", 9, "live", 3),
    e("g2-pre", "g2", "MIN @ IND", "2026-09-23T00:00:00.000Z", "won", 2.2),
    e("g2-open", "g2", "MIN @ IND", "2026-09-23T00:00:00.000Z", "pending", 4),
    // Another day entirely.
    e("other", "g9", "A @ B", "2026-09-21T23:00:00.000Z", "won", 2),
  ];

  it("counts the day's money on the pre-game tickets only, and the live reads apart, by quarter", () => {
    const r = buildDayRecap("2026-09-22", rows);
    // `decided` is the balance's own count now: the pre-game tickets, the ones with a real price.
    expect(r.decided).toBe(3);
    expect(r.pending).toBe(1);
    expect(r.pre).toMatchObject({ decided: 3, won: 2 });
    expect(r.live).toMatchObject({ decided: 2, won: 1, verdict: "dentro" });
    expect(r.live.expectedWins).toBeCloseTo(0.6, 6);
    expect(r.quarters.map((q) => [q.label, q.decided, q.won])).toEqual([["2º quarto", 1, 1], ["3º quarto", 1, 0]]);
    expect(r.pre.returned).toBeCloseTo(1.8 + 2.2, 6);
    expect(r.staked).toBe(3);
    expect(r.games.map((g) => g.matchup)).toEqual(["CON @ WSH", "MIN @ IND"]);
    expect(r.games[0].quarters).toHaveLength(2);
  });

  it("writes a subject with the day's pre-game record and a body that names every game", () => {
    const mail = renderDayRecap(buildDayRecap("2026-09-22", rows));
    expect(mail.subject).toContain("Resumo de 22/09/2026");
    // The subject no longer adds the two scopes together: pre-game money, then the live gap.
    expect(mail.subject).toContain("pré-jogo 2/3");
    expect(mail.subject).toContain("ao vivo 1/2");
    expect(mail.subject).not.toMatch(/3\/5/);
    expect(mail.text).toContain("PRÉ-JOGO");
    expect(mail.text).toContain("AO VIVO");
    expect(mail.text).toContain("2º quarto");
    expect(mail.text).toContain("CON @ WSH");
    expect(mail.text).toContain("MIN @ IND");
    expect(mail.text).toContain("1 ainda pendentes");
    expect(mail.text).toContain("/prova");
    expect(mail.text).not.toContain("TOTAL DO DIA");
  });

  it("keeps every unit and every ROI out of the live block", () => {
    const mail = renderDayRecap(buildDayRecap("2026-09-22", rows));
    const live = mail.text.slice(mail.text.indexOf("AO VIVO"), mail.text.indexOf("POR JOGO"));
    expect(live).not.toMatch(/\d+,\d+\s*u/);
    expect(live).not.toContain("ROI");
    expect(live).toContain("chance média que demos");
    expect(live).toContain("esperados");
    expect(live).toContain("pontos");
    expect(mail.text).toContain("Dinheiro é só do pré-jogo.");
    expect(mail.text).not.toContain("retorno dela é de referência");
  });

  it("says nothing was decided rather than dividing by zero", () => {
    const r = buildDayRecap("2026-09-20", rows);
    expect(r).toMatchObject({ decided: 0, pending: 0, roi: 0 });
    expect(renderDayRecap(r).text).toContain("nenhum decidido");
    expect(renderDayRecap(r).text).toContain("nenhuma leitura decidida");
  });
});
