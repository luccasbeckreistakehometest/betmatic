import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseGameLines, parsePropBets } from "@/lib/sources/espn-props";
import { noVigPair } from "@/lib/odds";

const fixture = (name: string) => JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", name), "utf8"));

describe("ESPN propBets mapping", () => {
  const wnba = parsePropBets(fixture("espn-propbets-wnba-401857190.json"), "wnba");

  it("maps at least 30 basketball props with sides and lines", () => {
    expect(wnba.length).toBeGreaterThanOrEqual(30);
    const keys = new Set(wnba.map((p) => p.marketKey));
    for (const k of ["points", "rebounds", "assists", "threes", "pra"]) expect(keys.has(k)).toBe(true);
    expect(wnba.every((p) => p.decimal > 1 && Number.isFinite(p.line))).toBe(true);
  });

  it("reads a Total pair as over then under, with the margin removed", () => {
    const pair = wnba.filter((p) => p.athleteId === "869" && p.marketKey === "points" && p.kind === "total" && p.line === 6.5);
    expect(pair.map((p) => [p.side, p.decimal])).toEqual([["over", 1.78], ["under", 1.96]]);
    expect(pair[0].noVigFair! + pair[1].noVigFair!).toBeCloseTo(1, 6);
    expect(pair[0].openDecimal).toBe(1.87);
  });

  it("turns a milestone N+ into an over at N - 0.5 and keeps the open price only for the same rung", () => {
    const six = wnba.find((p) => p.athleteId === "869" && p.marketKey === "points" && p.kind === "milestone" && p.line === 5.5);
    expect(six).toMatchObject({ side: "over", decimal: 1.55, openDecimal: null, openLine: 6.5 });
  });

  it("keeps soccer names scoped to soccer, including the yes/no markets", () => {
    const bra = parsePropBets(fixture("espn-propbets-bra-401841239.json"), "soccer-bra");
    const keys = new Set(bra.map((p) => p.marketKey));
    for (const k of ["shots", "shots_on_target", "fouls_committed", "goals", "cards"]) expect(keys.has(k)).toBe(true);
    const shots2 = bra.find((p) => p.athleteId === "302628" && p.marketKey === "shots" && p.line === 1.5);
    expect(shots2).toMatchObject({ decimal: 1.23, side: "over" });
    const card = bra.find((p) => p.athleteId === "302628" && p.marketKey === "cards");
    expect(card).toMatchObject({ line: 0.5, decimal: 3, kind: "yes" });
    // The maps are scoped by sport: read as basketball, only the one shared name ("Assists Milestones") survives.
    expect(new Set(parsePropBets(fixture("espn-propbets-bra-401841239.json"), "wnba").map((p) => p.marketKey))).toEqual(new Set(["assists"]));
  });

  it("returns nothing for a payload without items", () => {
    expect(parsePropBets({}, "wnba")).toEqual([]);
  });
});

describe("ESPN game lines", () => {
  it("reads open, current and close per provider", () => {
    const [dk, b365] = parseGameLines(fixture("espn-odds-bra-final-401841235.json"));
    expect(dk.provider).toBe("DraftKings");
    expect(dk.open?.homeMl).toBe(1.71);
    expect(dk.close?.homeMl).toBe(1.86);
    expect(dk.close?.total).toBe(2.5);
    expect(b365.provider).toBe("Bet 365");
    expect(b365.open).toBeNull();
    const pre = parseGameLines(fixture("espn-odds-bra-401841239.json"))[0];
    expect(pre.close).toBeNull();
    expect(pre.current?.draw).toBe(4.5);
    expect(pre.current?.spread).toBe(-1.5);
  });

  it("strips the vig from a -110/-110 market to 50/50", () => {
    const fair = noVigPair(1.909, 1.909);
    expect(fair.a).toBeCloseTo(0.5, 6);
  });
});
