import { describe, expect, it } from "vitest";
import { correlationFlags, flagText, marketKeyFor, resolveParsedLeg, resolveTypedLeg, type GameContext } from "@/lib/bets/deep-slip";
import { parseLine, playerMention, teamMention } from "@/lib/resolve/names";
import { onDemandVerdict, refreshVerdict } from "@/lib/server/on-demand-policy";
import { linesMoved } from "@/lib/server/priority-refresh";
import { slipPrice } from "@/lib/server/slip-pricing";
import { getPlan } from "@/lib/plans";

const team = (abbreviation: string, displayName: string, id: string) => ({ id, abbreviation, displayName, name: displayName });
const games: GameContext[] = [
  { id: "g1", sportKey: "wnba", startsAt: "", home: team("AUR", "Aurora Aces", "1"), away: team("BOR", "Boreal Birds", "2"),
    athletes: [{ id: "7101", name: "Ana Lima", team: "AUR" }, { id: "7102", name: "Bia Souza", team: "AUR" }, { id: "7201", name: "Duda Alves", team: "BOR" }] },
  { id: "g2", sportKey: "soccer-bra", startsAt: "", home: team("CAM", "Atlético-MG", "3"), away: team("SAO", "São Paulo", "4"), athletes: [{ id: "88", name: "Hulk", team: "CAM" }] },
];

describe("reading typed legs", () => {
  it("finds lines in the ways bettors write them", () => {
    expect(parseLine("Ana Lima mais de 17,5 pontos")).toEqual({ side: "over", line: 17.5 });
    expect(parseLine("Under 2.5 goals")).toEqual({ side: "under", line: 2.5 });
    expect(parseLine("Hulk 2+ finalizações")).toEqual({ side: "over", line: 1.5 });
    expect(parseLine("Galo vence")).toBeNull();
  });

  it("matches players by full name or a unique surname, and teams by alias", () => {
    expect(playerMention("lima over 17.5", games[0].athletes)?.id).toBe("7101");
    expect(playerMention("souza e lima", games[0].athletes)?.id).toBeUndefined();
    expect(teamMention("Galo vence", games[1].home)).toBeGreaterThan(0);
    expect(teamMention("Tricolor paulista para vencer", games[1].away)).toBeGreaterThan(0);
    expect(teamMention("Inter vence", games[1].away)).toBe(0);
  });

  it("resolves player, moneyline, total and unknown legs to the right game", () => {
    const p = resolveTypedLeg({ selection: "Ana Lima mais de 17,5 pontos", market: "", odds: "1.87" }, 0, games);
    expect(p).toMatchObject({ kind: "player", gameId: "g1", athleteId: "7101", marketKey: "points", line: 17.5, side: "over", team: "AUR" });
    expect(resolveTypedLeg({ selection: "Atlético Mineiro vence", market: "Resultado final", odds: "2.1" }, 1, games)).toMatchObject({ kind: "moneyline", gameId: "g2", team: "CAM" });
    expect(resolveTypedLeg({ selection: "Galo x São Paulo menos de 2,5 gols", market: "", odds: "1.8" }, 2, games)).toMatchObject({ kind: "total", gameId: "g2", team: null, side: "under" });
    expect(resolveTypedLeg({ selection: "Flamengo vence", market: "", odds: "1.5" }, 3, games).kind).toBe("unknown");
    expect(marketKeyFor("Hulk 2+ finalizações no alvo", "soccer-bra")).toBe("shots_on_target");
    expect(resolveParsedLeg({ index: 4, player: "Duda Alves", team: null, stat: "assists", line: 5.5, side: "over" }, games)).toMatchObject({ kind: "player", athleteId: "7201", via: "parse", marketKey: "assists" });
  });
});

describe("correlation flags", () => {
  it("flags teammates, the same player twice, and a favourite paired with the under", () => {
    const legs = [
      resolveTypedLeg({ selection: "Ana Lima mais de 17,5 pontos", market: "", odds: "" }, 0, games),
      resolveTypedLeg({ selection: "Bia Souza mais de 6,5 rebotes", market: "", odds: "" }, 1, games),
      resolveTypedLeg({ selection: "Ana Lima mais de 4,5 assistências", market: "", odds: "" }, 2, games),
      resolveTypedLeg({ selection: "Duda Alves mais de 15,5 pontos", market: "", odds: "" }, 3, games),
      resolveTypedLeg({ selection: "Atlético-MG vence", market: "", odds: "" }, 4, games),
      resolveTypedLeg({ selection: "Atlético-MG x São Paulo menos de 2,5 gols", market: "", odds: "" }, 5, games),
    ];
    const flags = correlationFlags(legs, { g1: "AUR", g2: "CAM" });
    expect(flags).toEqual([
      { kind: "same_team", legs: [0, 1] },
      { kind: "same_player", legs: [0, 2] },
      { kind: "same_team", legs: [1, 2] },
      { kind: "fights", legs: [4, 5] },
    ]);
    expect(flagText(flags[0], "pt")).toContain("Linhas 1 e 2");
    // The underdog with the under does not fight.
    expect(correlationFlags(legs, { g2: "SAO" }).some((f) => f.kind === "fights")).toBe(false);
  });
});

describe("Max: price, headroom and refresh", () => {
  it("prices the deep analysis at 8 for Max and 14 for the others", () => {
    expect(slipPrice({ role: "user", plan: getPlan("max") }, true)).toBe(8);
    expect(slipPrice({ role: "user", plan: getPlan("pro") }, true)).toBe(14);
    expect(slipPrice({ role: "user", plan: getPlan("pro") }, false)).toBe(8);
    expect(slipPrice({ role: "admin", plan: getPlan("max") }, true)).toBe(0);
  });

  it("lets Max go 50% past the global generation cap, and no further", () => {
    const base = { role: "user" as const, planGamesPerDay: null, userCountToday: 0, globalDailyCap: 10, userDailyCap: 20, adminDailyCap: 15, alreadyGenerated: false, started: false };
    expect(onDemandVerdict({ ...base, globalCountToday: 10 })).toBe("cap_global");
    expect(onDemandVerdict({ ...base, globalCountToday: 14, priority: true })).toBe("generate");
    expect(onDemandVerdict({ ...base, globalCountToday: 15, priority: true })).toBe("cap_global");
  });

  it("offers a refresh only when an input changed, within the caps", () => {
    const base = { isMax: true, exists: true, started: false, lineupAlert: false, hoursSinceGeneration: 7, linesMoved: false, userCountToday: 0, globalCountToday: 0, caps: { perUser: 3, global: 10 } };
    expect(refreshVerdict(base)).toBe("unchanged");
    expect(refreshVerdict({ ...base, linesMoved: true })).toBe("available");
    expect(refreshVerdict({ ...base, linesMoved: true, hoursSinceGeneration: 2 })).toBe("unchanged");
    expect(refreshVerdict({ ...base, lineupAlert: true, hoursSinceGeneration: 0 })).toBe("available");
    expect(refreshVerdict({ ...base, lineupAlert: true, userCountToday: 3 })).toBe("cap_user");
    expect(refreshVerdict({ ...base, lineupAlert: true, globalCountToday: 10 })).toBe("cap_global");
    expect(refreshVerdict({ ...base, isMax: false, lineupAlert: true })).toBe("not_max");
    expect(refreshVerdict({ ...base, started: true, lineupAlert: true })).toBe("started");
  });

  it("sees a moved line or a 10-cent price change, and ignores noise", () => {
    const prop = { athleteId: "7101", oddsDecimal: 1.87, settlement: { type: "player_prop" as const, stat: "points", line: 17.5, side: "over" as const, sourceBasis: "" } };
    const ml = { oddsDecimal: 1.67, settlement: { type: "moneyline" as const, teamAbbreviation: "AUR", sourceBasis: "" } };
    const total = { oddsDecimal: 1.91, settlement: { type: "total" as const, line: 160.5, side: "over" as const, sourceBasis: "" } };
    const now = { props: [{ athleteId: "7101", marketKey: "points", side: "over" as const, line: 17.5, decimal: 1.92 }], moneyline: { AUR: 1.7 }, total: 160.5 };
    expect(linesMoved([prop, ml, total], now)).toBe(false);
    expect(linesMoved([prop], { ...now, props: [{ ...now.props[0], decimal: 1.97 }] })).toBe(true);
    expect(linesMoved([prop], { ...now, props: [{ ...now.props[0], line: 18.5 }] })).toBe(true);
    expect(linesMoved([ml], { ...now, moneyline: { AUR: 1.8 } })).toBe(true);
    expect(linesMoved([total], { ...now, total: 161.5 })).toBe(true);
  });
});
