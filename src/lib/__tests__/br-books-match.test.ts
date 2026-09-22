import { describe, expect, it } from "vitest";
import { aliasesOf, describeEvent, matchEvent, type MatchableGame } from "@/lib/sources/br-books/match";
import type { BookEvent } from "@/lib/sources/br-books/types";

const game = (id: string, home: string, away: string, startsAt: string, abbr = ["HOM", "AWY"]): MatchableGame => ({
  id, startsAt, home: { abbreviation: abbr[0], name: home.split(" ").pop()!, displayName: home }, away: { abbreviation: abbr[1], name: away.split(" ").pop()!, displayName: away },
});
const ev = (home: string, away: string, startsAt: string, externalIds: Record<string, string> = {}): BookEvent => ({ key: `x:y:${home}`, home, away, startsAt, externalIds, sport: "basketball" });

const slate: MatchableGame[] = [
  game("401857190", "Washington Mystics", "Connecticut Sun", "2026-09-22T23:30:00Z", ["WSH", "CONN"]),
  game("401857191", "Indiana Fever", "Minnesota Lynx", "2026-09-23T00:00:00Z", ["IND", "MIN"]),
  game("401857192", "Las Vegas Aces", "Los Angeles Sparks", "2026-09-23T02:00:00Z", ["LV", "LA"]),
];

describe("book event → ESPN game", () => {
  it("matches on both names and a kickoff within thirty minutes", () => {
    expect(matchEvent(ev("Washington Mystics", "Connecticut Sun", "2026-09-22T23:30:00Z"), slate)).toEqual({ gameId: "401857190", matchedBy: "names", swapped: false });
    // Superbet's clock is a minute off; Betnacional rounds to the half hour.
    expect(matchEvent(ev("Indiana Fever", "Minnesota Lynx", "2026-09-23T00:07:00Z"), slate)?.gameId).toBe("401857191");
    expect(matchEvent(ev("Indiana Fever", "Minnesota Lynx", "2026-09-23T01:00:00Z"), slate)).toBeNull();
  });

  it("notices when the book lists the home side second (Betfair, Sportingbet)", () => {
    expect(matchEvent(ev("Connecticut Sun", "Washington Mystics", "2026-09-22T23:30:00Z"), slate)).toEqual({ gameId: "401857190", matchedBy: "names", swapped: true });
  });

  it("knows the short spellings Brazilian books use", () => {
    expect(aliasesOf(slate[2].away)).toContain("la sparks");
    expect(matchEvent(ev("LA Sparks", "Las Vegas Aces", "2026-09-23T02:00:00Z"), slate)).toMatchObject({ gameId: "401857192", swapped: true });
    expect(matchEvent(ev("Las Vegas Aces", "Phoenix Mercury", "2026-09-23T02:00:00Z"), slate)).toBeNull();
  });

  it("inherits a match through a shared external id, even when the names differ", () => {
    const known = new Map([["betradar:68096448", "401857190"]]);
    expect(matchEvent(ev("W. Mystics", "C. Sun", "2026-09-22T23:30:00Z", { betradar: "68096448" }), slate, known)).toEqual({ gameId: "401857190", matchedBy: "external", swapped: false });
    expect(matchEvent(ev("Connecticut Sun", "Washington Mystics", "2026-09-22T23:30:00Z", { betradar: "68096448" }), slate, known)).toMatchObject({ matchedBy: "external", swapped: true });
    // An id learned for a game that is not on this slate does not match anything.
    expect(matchEvent(ev("A", "B", "2026-09-22T23:30:00Z", { betradar: "1" }), slate, new Map([["betradar:1", "999"]]))).toBeNull();
  });

  it("describes an unmatched event for the admin list", () => {
    expect(describeEvent(ev("Atlético-MG", "Grêmio", "2026-10-03T21:30:00Z"))).toBe("Atletico-MG × Gremio (2026-10-03 21:30Z)");
  });
});
