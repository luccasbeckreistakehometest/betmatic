import { describe, expect, it } from "vitest";
import { moneylineOf } from "@/lib/sources/espn";

// ESPN's scoreboard dropped `homeTeamOdds.moneyLine` in September 2026: the table showed "— / —"
// for every WNBA game while the summary still carried the price. The reader takes every shape.
describe("the moneyline, wherever ESPN puts it", () => {
  it("reads the new scoreboard shape (close, then open, as strings)", () => {
    const odds = { homeTeamOdds: { favorite: true }, awayTeamOdds: { underdog: true }, moneyline: { home: { close: { odds: "-1650" }, open: { odds: "-1400" } }, away: { open: { odds: "+800" } } } };
    expect(moneylineOf(odds, "home")).toBe(-1650);
    expect(moneylineOf(odds, "away")).toBe(800);
  });
  it("keeps reading the old field the summary still carries", () => {
    expect(moneylineOf({ homeTeamOdds: { moneyLine: -1650 }, awayTeamOdds: { moneyLine: 950 } }, "away")).toBe(950);
  });
  it("treats a missing, empty or zero price as not posted", () => {
    expect(moneylineOf(undefined, "home")).toBeUndefined();
    expect(moneylineOf({ moneyline: { home: { close: { odds: "" } } } }, "home")).toBeUndefined();
    expect(moneylineOf({ homeTeamOdds: { moneyLine: 0 } }, "home")).toBeUndefined();
  });
});
