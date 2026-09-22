import { describe, expect, it } from "vitest";
import { cleanDecimal, milestoneLine, milestoneRung, normalisePlayer, normaliseTeam, parseLineValue, playerKey, sideFromLabel, statFromLabel, teamKey } from "@/lib/sources/br-books/normalise";
import { ADAPTER_IDS, booksConfig, enabledAdapterIds, SKIPPED_BOOKS } from "@/lib/sources/br-books/registry";
import { parseRobots, robotsBlocks, networkAllowed } from "@/lib/sources/br-books/http";

describe("br-books normalisation", () => {
  it("writes players the way ESPN does, whatever the book printed", () => {
    expect(normalisePlayer("Amoore, Georgia")).toBe("Georgia Amoore");
    expect(normalisePlayer("Shakira Austin (WAS)")).toBe("Shakira Austin");
    expect(normalisePlayer("  Kiki   Iriafen ")).toBe("Kiki Iriafen");
    expect(playerKey("Amoore, Georgia")).toBe(playerKey("Georgia Amoore (WAS)"));
    expect(playerKey("Kelsey Plum (LV)")).toBe("kelsey plum");
  });

  it("drops the women's-league marker from team names", () => {
    expect(normaliseTeam("Connecticut Sun (F)")).toBe("Connecticut Sun");
    expect(normaliseTeam("Washington Mystics (W)")).toBe("Washington Mystics");
    expect(normaliseTeam("Taiwan, Femininos")).toBe("Taiwan");
    expect(teamKey("Atlético-MG")).toBe("atletico mg");
  });

  it("maps every book's label onto the repo's market keys, longest combo first", () => {
    expect(statFromLabel("Jogador - Total de Pontos + Rebotes + Assistências (Inc. prorrogação)", "basketball")).toBe("pra");
    expect(statFromLabel("Pts-Reb-Ast - Georgia Amoore (WAS) (Incl.Prorrogação)", "basketball")).toBe("pra");
    expect(statFromLabel("Reb-Ast - Sonia Citron (WAS)", "basketball")).toBe("ra");
    expect(statFromLabel("Jogador - Total de Pontos + Assistências", "basketball")).toBe("pa");
    expect(statFromLabel("Jogador - Total de Pontos + Rebotes", "basketball")).toBe("pr");
    expect(statFromLabel("Cestas de 3 Pontos Convertidas pelo Jogador", "basketball")).toBe("threes");
    expect(statFromLabel("3pt conseguidos Mais de/Menos de  (incluindo Prorrogação)", "basketball")).toBe("threes");
    expect(statFromLabel("Assistências do Jogador", "basketball")).toBe("assists");
    expect(statFromLabel("Rebotes Mais de/Menos de", "basketball")).toBe("rebounds");
    expect(statFromLabel("Pontos Mais de/Menos de", "basketball")).toBe("points");
    expect(statFromLabel("Player Points", "basketball")).toBe("points");
    expect(statFromLabel("Total de Roubos de Bola", "basketball")).toBe("steals");
    expect(statFromLabel("Finalizações no alvo do jogador", "soccer")).toBe("shots_on_target");
    expect(statFromLabel("Jogador - Finalizações", "soccer")).toBe("shots");
    expect(statFromLabel("Cartão do jogador", "soccer")).toBe("cards");
    expect(statFromLabel("Ímpar/Par", "basketball")).toBeNull();
  });

  it("reads sides, lines, rungs and prices in both number formats", () => {
    expect(sideFromLabel("Amoore, Georgia - Mais de 7.5")).toBe("over");
    expect(sideFromLabel("Menos de 149.5")).toBe("under");
    expect(sideFromLabel("Washington Mystics")).toBeNull();
    expect(parseLineValue("-21.5")).toBe(-21.5);
    expect(parseLineValue("+14,5")).toBe(14.5);
    expect(parseLineValue("17.5|WAS|dst:player:427780")).toBe(17.5);
    expect(milestoneRung("18+")).toBe(18);
    expect(milestoneRung("Terá 10 ou mais pontos")).toBe(10);
    expect(milestoneLine(10)).toBe(9.5);
    expect(cleanDecimal(1.9091)).toBe(1.9091);
    expect(cleanDecimal("1,83")).toBe(1.83);
    expect(cleanDecimal(1)).toBeNull();
    expect(cleanDecimal(0)).toBeNull();
  });
});

describe("br-books registry", () => {
  it("lists every adapter that answered a plain client and every book that did not", () => {
    expect(ADAPTER_IDS).toEqual(["superbet", "kambi:kto", "altenar:estrelabet", "altenar:apostaganha", "altenar:betpix365", "altenar:lotogreen", "altenar:vaidebet", "betfair-exchange", "sportingbet", "betnacional"]);
    expect(SKIPPED_BOOKS.map((s) => s.book)).toContain("Betano");
    expect(SKIPPED_BOOKS.map((s) => s.book)).toContain("Betsson");
  });

  it("reads BR_BOOKS: unset means all outside tests and none inside them, `none` means none, unknown ids are ignored", () => {
    expect(enabledAdapterIds({})).toEqual(ADAPTER_IDS);
    expect(enabledAdapterIds({ VITEST: "true" })).toEqual([]);
    expect(enabledAdapterIds({ BR_BOOKS: "none" })).toEqual([]);
    expect(enabledAdapterIds({ BR_BOOKS: " superbet, Kambi:KTO ,nope" })).toEqual(["superbet", "kambi:kto"]);
  });

  it("keeps the tunables inside sane bounds", () => {
    expect(booksConfig({})).toEqual({ dispersionPct: 7, horizonHours: 48, adapterTimeoutMs: 90_000 });
    expect(booksConfig({ BOOKS_DISPERSION_PCT: "0", BOOKS_HORIZON_HOURS: "12", BOOKS_ADAPTER_TIMEOUT_MS: "10" })).toEqual({ dispersionPct: 1, horizonHours: 12, adapterTimeoutMs: 5_000 });
  });
});

describe("br-books http policy", () => {
  it("never touches the network under vitest", () => {
    expect(networkAllowed()).toBe(false);
  });

  it("honours robots.txt for the anonymous agent only", () => {
    const rules = parseRobots("User-agent: Adsbot-Google\nAllow: /promo\nUser-agent: *\nDisallow: /*/api/\nDisallow: /account/\n# comment\nDisallow: /sstp*\nCrawl-delay: 2");
    expect(rules).toEqual(["/*/api/", "/account/", "/sstp*"]);
    expect(robotsBlocks(rules, "/pt-br/sports/api/x")).toBe(true);
    expect(robotsBlocks(rules, "/cds-api/bettingoffer/fixtures")).toBe(false);
    expect(robotsBlocks(rules, "/sstp-anything")).toBe(true);
    expect(robotsBlocks(rules, "/offering/v2018/ktobr/listView/basketball/wnba.json")).toBe(false);
  });
});
