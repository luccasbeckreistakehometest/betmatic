import { describe, expect, it } from "vitest";
import {
  NOT_PRICED,
  formatAmerican,
  formatMoney,
  formatNumber,
  formatOdds,
  formatPercent,
  formatUnits,
  impliedFromDecimal,
} from "@/lib/format";

const MINUS = "−";
const NBSP = " ";

describe("pt-BR number formatting", () => {
  it("writes money with a comma decimal, dot thousands and a non-breaking space", () => {
    expect(formatMoney(1234.56, "pt")).toBe(`R$${NBSP}1.234,56`);
    expect(formatMoney(0, "pt")).toBe(`R$${NBSP}0,00`);
  });

  it("never puts a sign on zero and always puts one on a delta", () => {
    expect(formatMoney(0, "pt", { signed: true })).toBe(`R$${NBSP}0,00`);
    expect(formatMoney(12, "pt", { signed: true })).toBe(`+R$${NBSP}12,00`);
    expect(formatUnits(0, "pt")).toBe(`0,00${NBSP}u`);
    expect(formatUnits(2.4, "pt")).toBe(`+2,40${NBSP}u`);
  });

  it("uses the real minus sign, not a hyphen, so columns align", () => {
    expect(formatUnits(-1.74, "pt")).toBe(`${MINUS}1,74${NBSP}u`);
    expect(formatMoney(-50, "pt")).toBe(`${MINUS}R$${NBSP}50,00`);
    expect(formatPercent(-0.185, "pt")).toBe(`${MINUS}18,5${NBSP}%`);
    expect(formatAmerican(1.55, "en")).toBe(`${MINUS}182`);
  });

  it("prints a chance from a fraction with the unit attached", () => {
    expect(formatPercent(0.5, "pt")).toBe(`50,0${NBSP}%`);
    expect(formatPercent(0.417, "pt")).toBe(`41,7${NBSP}%`);
    expect(formatPercent(0.5, "en")).toBe(`50.0${NBSP}%`);
  });

  it("gives odds two decimals so the points line up", () => {
    expect(formatOdds(1.26, "pt")).toBe("1,26");
    expect(formatOdds(21, "pt")).toBe("21,00");
    expect(formatOdds(0, "pt")).toBe(NOT_PRICED);
  });

  it("returns an em dash for anything unpriced instead of a zero", () => {
    expect(formatNumber(Number.NaN, "pt")).toBe(NOT_PRICED);
    expect(formatMoney(Number.POSITIVE_INFINITY, "pt")).toBe(NOT_PRICED);
    expect(formatPercent(Number.NaN, "pt")).toBe(NOT_PRICED);
  });

  it("derives the implied chance a price carries", () => {
    expect(impliedFromDecimal(2)).toBeCloseTo(0.5, 10);
    expect(formatPercent(impliedFromDecimal(2.4), "pt")).toBe(`41,7${NBSP}%`);
    expect(Number.isNaN(impliedFromDecimal(0))).toBe(true);
  });
});
