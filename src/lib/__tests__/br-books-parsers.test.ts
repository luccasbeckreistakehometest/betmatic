import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { parseSuperbetEvent, selectSuperbetEvents, superbetEvent, splitEventName, tournamentNames, type SuperbetEventDetail, type SuperbetListEvent } from "@/lib/sources/br-books/superbet";
import { kambiEvent, parseKambiOffers, selectKambiEvents, type KambiEventOffers, type KambiListView } from "@/lib/sources/br-books/kambi";
import { altenarEvent, parseAltenarEvent, selectAltenarEvents, type AltenarEventDetails, type AltenarList } from "@/lib/sources/br-books/altenar";
import { exchangeEvent, parseExchangeMarkets, selectNavEvents, splitExchangeName, type ExchangePayload, type NavPayload } from "@/lib/sources/br-books/betfair-exchange";
import { cdsEvent, parseCdsFixture, selectCdsFixtures, splitCdsName, type CdsFixtures } from "@/lib/sources/br-books/sportingbet";
import { parseRampRows, rampStartToIso, type RampPayload } from "@/lib/sources/br-books/betnacional";
import type { BookPrice } from "@/lib/sources/br-books/types";

const fixture = <T>(name: string): T => JSON.parse(fs.readFileSync(path.join(process.cwd(), "src/lib/__tests__/fixtures/br-books", name), "utf8")) as T;
const AT = "2026-09-22T12:00:00.000Z";
const WINDOW = { from: "2026-09-22T11:00:00.000Z", to: "2026-09-24T12:00:00.000Z" };
const find = (rows: BookPrice[], f: Partial<BookPrice>) => rows.find((r) => Object.entries(f).every(([k, v]) => (r as unknown as Record<string, unknown>)[k] === v));

describe("Superbet", () => {
  const detail = fixture<SuperbetEventDetail>("superbet-event-14033464.json");
  const event = superbetEvent({ event_id: 14033464, fixture: { betradar_id: "68096448", event_name: "Washington Mystics (F)·Connecticut Sun (F)", utc_date: "2026-09-22T23:30:00Z", tournament_id: 2174, sport_id: 4 } }, "basketball", "EUA - WNBA (F)")!;
  const rows = parseSuperbetEvent(detail, event, AT);

  it("names the fixture with its betradar id and ESPN-style team names", () => {
    expect(splitEventName("Washington Mystics (F)·Connecticut Sun (F)")).toEqual({ home: "Washington Mystics", away: "Connecticut Sun" });
    expect(event.key).toBe("superbet:superbet:14033464");
    expect(event.externalIds).toEqual({ superbet: "14033464", betradar: "68096448" });
  });

  it("keeps the full-game lines and drops quarters, halves and team totals", () => {
    expect(find(rows, { market: "moneyline", side: "home" })?.decimal).toBe(1.07);
    expect(find(rows, { market: "moneyline", side: "away" })?.decimal).toBe(7.8);
    // "Resultado Final (Tempo Regulamentar)" is a regulation-time market: not the moneyline we settle.
    expect(rows.filter((r) => r.market === "moneyline")).toHaveLength(2);
    expect(find(rows, { market: "spread", side: "home", line: -21.5 })?.decimal).toBe(2.87);
    expect(find(rows, { market: "spread", side: "away", line: 21.5 })?.decimal).toBe(1.31);
    expect(find(rows, { market: "total", side: "over", line: 149.5 })?.decimal).toBe(1.33);
    expect(find(rows, { market: "total", side: "under", line: 150.5 })?.decimal).toBe(2.67);
    expect(rows.filter((r) => r.market === "total")).toHaveLength(4);
  });

  it("reads player pairs and N+ rungs in the repo's vocabulary", () => {
    expect(find(rows, { market: "player_prop", player: "Georgia Amoore", stat: "points", side: "over", line: 7.5 })?.decimal).toBe(1.83);
    expect(find(rows, { market: "player_prop", player: "Georgia Amoore", stat: "points", side: "under", line: 7.5 })?.decimal).toBe(1.88);
    expect(find(rows, { market: "player_prop", player: "Shakira Austin", stat: "rebounds", side: "over", line: 8.5 })?.decimal).toBe(1.67);
    expect(find(rows, { market: "player_prop", player: "Shakira Austin", stat: "pra", side: "under", line: 29.5 })?.decimal).toBe(1.78);
    const rung = find(rows, { market: "player_prop", player: "Georgia Amoore", stat: "points", kind: "milestone" });
    expect(rung).toMatchObject({ side: "over", line: 9.5, decimal: 2.62 });
    expect(find(rows, { market: "player_prop", player: "Georgia Amoore", stat: "threes", kind: "milestone" })).toMatchObject({ line: 1.5, decimal: 1.82 });
    expect(rows.every((r) => r.book === "Superbet" && r.platform === "superbet" && r.fetchedAt === AT)).toBe(true);
  });

  it("selects only the league's upcoming events inside the window", () => {
    const list = fixture<{ events: SuperbetListEvent[] }>("superbet-list.json");
    const names = new Map<number, string>([[2174, "EUA - WNBA (F)"], [3313, "Austrália - NBL"]]);
    const picked = selectSuperbetEvents(list.events, "wnba", names, WINDOW.from, WINDOW.to);
    expect(picked.map((p) => p.ev.event_id)).toEqual([14033464, 14033463]);
    expect(selectSuperbetEvents(list.events, "nba", names, WINDOW.from, WINDOW.to)).toHaveLength(0);
  });

  it("reads the struct's STRING ids, so NBA and the football leagues resolve by name and Série B stays out of Série A", () => {
    const names = tournamentNames(fixture<{ data?: unknown }>("superbet-struct.json"));
    expect(names.get(2174)).toBe("EUA - WNBA (F)");
    expect(names.get(164)).toBe("EUA - NBA");
    expect(names.get(1698)).toBe("Brasil - Brasileiro - Série A");
    const at = (id: number, name: string, utc = "2026-10-02T23:00:00Z"): SuperbetListEvent => ({ event_id: id, fixture: { event_name: name, utc_date: utc, tournament_id: id, sport_id: 5 } });
    const events = [at(1698, "São Paulo·Santos"), at(1697, "Criciúma·Operário PR"), at(106, "Arsenal·Chelsea"), at(96715, "Rodada 7·Rodada 7"), at(14582, "Simba·Yanga"), at(164, "Boston Celtics·Detroit Pistons")];
    const pick = (sport: string) => selectSuperbetEvents(events, sport, names, "2026-10-01T00:00:00Z", "2026-10-03T00:00:00Z").map((p) => p.ev.fixture.event_name);
    expect(pick("soccer-bra")).toEqual(["São Paulo·Santos"]);
    expect(pick("soccer-eng")).toEqual(["Arsenal·Chelsea"]);
    expect(pick("nba")).toEqual(["Boston Celtics·Detroit Pistons"]);
  });
});

describe("Kambi (KTO)", () => {
  const offers = fixture<KambiEventOffers>("kambi-event-1027216026.json");
  const event = kambiEvent(offers.events![0], "basketball", "KTO", "ktobr")!;
  const rows = parseKambiOffers(offers, event, "KTO", AT);

  it("prices are ×1000 and the outcome type carries the side", () => {
    expect(event).toMatchObject({ key: "kambi:ktobr:1027216026", home: "Washington Mystics", away: "Connecticut Sun", startsAt: "2026-09-22T23:30:00Z" });
    expect(find(rows, { market: "moneyline", side: "home" })?.decimal).toBe(1.08);
    expect(find(rows, { market: "moneyline", side: "away" })?.decimal).toBe(8);
    expect(find(rows, { market: "spread", side: "home", line: -10.5 })?.decimal).toBe(1.44);
    expect(find(rows, { market: "spread", side: "away", line: 10.5 })?.decimal).toBe(2.63);
    expect(rows.filter((r) => r.market === "total").map((r) => [r.side, r.line, r.decimal])).toContainEqual(["over", 157.5, 1.77]);
    // Odd/even and the "end of Q4" three-way are not markets we settle.
    expect(rows.filter((r) => r.market === "moneyline")).toHaveLength(2);
  });

  it("lists upcoming events from the list view", () => {
    const list = fixture<KambiListView>("kambi-listview-wnba.json");
    const picked = selectKambiEvents(list, WINDOW.from, WINDOW.to);
    expect(picked.length).toBeGreaterThanOrEqual(5);
    expect(picked[0]).toMatchObject({ id: 1027216026, homeName: "Washington Mystics (F)" });
  });
});

describe("Altenar (EstrelaBet and tenants)", () => {
  const detail = fixture<AltenarEventDetails>("altenar-eventdetails-16614649.json");
  const comps = new Map(detail.competitors!.map((c) => [c.id, c.name]));
  const event = altenarEvent(detail, "basketball", "estrelabet", comps, "WNBA")!;
  const rows = parseAltenarEvent(detail, event, "EstrelaBet", AT);

  it("resolves teams by competitor id and the sides by odd type", () => {
    expect(event).toMatchObject({ key: "altenar:estrelabet:16614649", home: "Washington Mystics", away: "Connecticut Sun" });
    expect(find(rows, { market: "moneyline", side: "home" })?.decimal).toBe(1.0715);
    expect(find(rows, { market: "moneyline", side: "away" })?.decimal).toBe(9.5);
    expect(find(rows, { market: "spread", side: "home", line: -7.5 })?.decimal).toBe(1.2778);
    // `sv` is the home line on both outcomes; the away side's own handicap is +7, as its name says.
    expect(find(rows, { market: "spread", side: "away", line: 7 })?.decimal).toBe(3.7);
    expect(find(rows, { market: "spread", side: "away", line: 7.5 })?.decimal).toBe(3.4);
    expect(find(rows, { market: "spread", side: "away", line: -7 })).toBeUndefined();
    expect(rows.filter((r) => r.market === "spread").every((r) => (r.side === "home") === (r.line! < 0))).toBe(true);
    expect(find(rows, { market: "total", side: "over", line: 150.5 })?.decimal).toBe(1.4167);
    expect(find(rows, { market: "total", side: "under", line: 150 })?.decimal).toBe(2.85);
  });

  it("flips the sign of `sv` for an away outcome whose name carries no handicap", () => {
    const bare: AltenarEventDetails = {
      id: 1, name: "Washington Mystics (F) vs. Connecticut Sun (F)", startDate: "2026-09-22T23:30:00Z",
      competitors: [{ id: 1, name: "Washington Mystics (F)" }, { id: 2, name: "Connecticut Sun (F)" }],
      markets: [{ id: 10, typeId: 223, name: "Handicap (incluindo Prorrogação)", desktopOddIds: [[101], [102]] }],
      odds: [{ id: 101, typeId: 1714, price: 1.3, sv: "-7", competitorId: 1, name: "Washington Mystics (F)" }, { id: 102, typeId: 1715, price: 3.5, sv: "-7", competitorId: 2, name: "Connecticut Sun (F)" }],
    };
    const ev = altenarEvent(bare, "basketball", "estrelabet", new Map([[1, "Washington Mystics (F)"], [2, "Connecticut Sun (F)"]]))!;
    const out = parseAltenarEvent(bare, ev, "EstrelaBet", AT).filter((r) => r.market === "spread");
    expect(out.map((r) => [r.side, r.line, r.decimal])).toEqual([["home", -7, 1.3], ["away", 7, 3.5]]);
  });

  it("reads child markets: over/under pairs by player and N+ ladders", () => {
    expect(find(rows, { market: "player_prop", player: "Shakira Austin", stat: "points", side: "over", line: 17.5 })?.decimal).toBe(1.9091);
    expect(find(rows, { market: "player_prop", player: "Shakira Austin", stat: "points", side: "under", line: 17.5 })?.decimal).toBe(1.8334);
    expect(find(rows, { market: "player_prop", player: "Kiki Iriafen", stat: "rebounds", side: "over", line: 9.5 })?.decimal).toBe(1.8696);
    expect(find(rows, { market: "player_prop", player: "Kiki Iriafen", stat: "points", kind: "milestone", line: 13.5 })?.decimal).toBe(1.3572);
    expect(find(rows, { market: "player_prop", player: "Kiki Iriafen", stat: "points", kind: "milestone", line: 17.5 })?.decimal).toBe(2.2);
    expect(find(rows, { market: "player_prop", player: "Georgia Amoore", stat: "pra", kind: "milestone", line: 10.5 })?.decimal).toBe(1.3449);
    expect(rows.every((r) => r.book === "EstrelaBet" && r.platform === "altenar")).toBe(true);
  });

  it("selects the league's events from the sport list, with the tenant's own id", () => {
    const list = fixture<AltenarList>("altenar-getevents.json");
    const picked = selectAltenarEvents(list, "wnba", WINDOW.from, WINDOW.to);
    expect(picked.map((p) => p.ev.id)).toContain(16614649);
    expect(picked.every((p) => p.league === "WNBA")).toBe(true);
    const nba = selectAltenarEvents(list, "nba", "2026-10-20T00:00:00Z", "2026-10-21T00:00:00Z");
    expect(nba.map((p) => p.ev.name)).toEqual(["Detroit Pistons vs. Boston Celtics"]);
  });
});

describe("Betfair Exchange", () => {
  it("reads the away-first event name and the best back/lay per runner", () => {
    expect(splitExchangeName("Connecticut Sun @ Washington Mystics")).toEqual({ home: "Washington Mystics", away: "Connecticut Sun" });
    const nav = fixture<NavPayload>("betfair-bynode-wnba.json");
    const events = selectNavEvents(nav, WINDOW.from, WINDOW.to);
    expect(events.map((e) => e.id)).toContain("36094852");
    const event = exchangeEvent(events.find((e) => e.id === "36094852")!, "basketball", "wnba")!;
    const rows = parseExchangeMarkets(fixture<ExchangePayload>("betfair-bymarket.json"), event, AT);
    const away = find(rows, { market: "moneyline", side: "away" })!;
    expect(away).toMatchObject({ decimal: 9.6, lay: 11, book: "Betfair Exchange", platform: "betfair-exchange" });
    expect(find(rows, { market: "moneyline", side: "home" })).toMatchObject({ decimal: 1.1, lay: 1.12 });
    // A lone 1.01 back order on a 35-point handicap rung is dust, not a market: dropped, never a fair price.
    expect(find(rows, { market: "spread", side: "away", line: -35.5 })).toBeUndefined();
    expect(rows.filter((r) => r.market === "spread")).toHaveLength(0);
    // A real back with no lay is still a quote (2.0 on the under), just not a reference.
    expect(find(rows, { market: "total", side: "under", line: 120.5 })).toMatchObject({ decimal: 2, lay: undefined });
    // A runner with nothing to back is not a price.
    expect(find(rows, { market: "total", side: "over", line: 120.5 })).toBeUndefined();
  });
});

describe("Sportingbet (Entain CDS)", () => {
  const payload = fixture<CdsFixtures>("sportingbet-fixtures.json");

  it("reads handicap and totals off the fixture list, with the betradar id", () => {
    expect(splitCdsName("Connecticut Sun at Washington Mystics")).toEqual({ home: "Washington Mystics", away: "Connecticut Sun" });
    const [f] = selectCdsFixtures(payload, "wnba", WINDOW.from, WINDOW.to);
    const event = cdsEvent(f, "basketball")!;
    expect(event.externalIds).toEqual({ sportingbet: "19919149", betradar: "68096448" });
    const rows = parseCdsFixture(f, event, AT);
    expect(find(rows, { market: "spread", side: "away", line: 14.5 })?.decimal).toBe(1.95);
    expect(find(rows, { market: "spread", side: "home", line: -14.5 })?.decimal).toBe(1.87);
    expect(find(rows, { market: "total", side: "over", line: 158.5 })?.decimal).toBe(1.91);
  });

  it("leaves a period market alone even when its template category is the generic 'Vencedor'", () => {
    const [f] = selectCdsFixtures(payload, "wnba", WINDOW.from, WINDOW.to);
    const event = cdsEvent(f, "basketball")!;
    // Read live on 22/09/2026: the quarter winner rides under the same template category as the moneyline.
    const quarter = { id: 1560413307, name: { value: "Vencedor - 1º quarto" }, templateCategory: { name: { value: "Vencedor" } }, results: [{ id: 2301883654, odds: 1.28, name: { value: "Washington Mystics" } }, { id: 2301883655, odds: 3.6, name: { value: "Connecticut Sun" } }] };
    const full = { id: 1560413399, name: { value: "Vencedor" }, templateCategory: { name: { value: "Vencedor" } }, results: [{ id: 2301883700, odds: 1.05, name: { value: "Washington Mystics" } }, { id: 2301883701, odds: 9, name: { value: "Connecticut Sun" } }] };
    const rows = parseCdsFixture({ ...f, games: [...(f.games ?? []), quarter, full] }, event, AT);
    expect(rows.filter((r) => r.market === "moneyline").map((r) => [r.side, r.decimal])).toEqual([["home", 1.05], ["away", 9]]);
    expect(find(rows, { market: "moneyline", side: "home" })?.ref).toEqual({ eventId: "19919149", marketId: "1560413399", outcomeId: "2301883700" });
  });

  it("reads a football 1X2 and total", () => {
    const [f] = selectCdsFixtures(payload, "soccer-bra", "2026-10-07T00:00:00Z", "2026-10-08T00:00:00Z");
    const event = cdsEvent(f, "soccer")!;
    expect(event).toMatchObject({ home: "Internacional", away: "Corinthians" });
    const rows = parseCdsFixture(f, event, AT);
    expect(find(rows, { market: "moneyline", side: "draw" })?.decimal).toBe(3.2);
    expect(find(rows, { market: "moneyline", side: "away" })?.decimal).toBe(3.5);
    expect(find(rows, { market: "total", side: "under", line: 2.5 })?.decimal).toBe(1.85);
  });
});

describe("Betnacional (ramp)", () => {
  it("converts Brasília wall-clock time and reads the moneyline rows", () => {
    expect(rampStartToIso("2026-09-22 20:30:00")).toBe("2026-09-22T23:30:00.000Z");
    const rows = parseRampRows(fixture<RampPayload>("betnacional-basketball.json"), "wnba", "basketball", WINDOW.from, WINDOW.to, AT);
    const home = find(rows, { market: "moneyline", side: "home" })!;
    expect(home.event).toMatchObject({ home: "Washington Mystics", away: "Connecticut Sun", startsAt: "2026-09-22T23:30:00.000Z", externalIds: { betnacional: "916559498", betradar: "68096448" } });
    expect(home.decimal).toBe(1.056);
    expect(find(rows, { market: "moneyline", side: "away" })?.decimal).toBe(8);
    expect(rows.filter((r) => /Chicago/.test(r.event.home))).toHaveLength(2);
    expect(rows.every((r) => /WNBA/.test(r.event.league ?? ""))).toBe(true);
  });
});
