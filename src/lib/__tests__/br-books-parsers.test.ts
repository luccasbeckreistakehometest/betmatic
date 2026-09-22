import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { parseSuperbetEvent, selectSuperbetEvents, superbetEvent, splitEventName, type SuperbetEventDetail, type SuperbetListEvent } from "@/lib/sources/br-books/superbet";
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
    expect(find(rows, { market: "spread", side: "away", line: -7 })?.decimal).toBe(3.7);
    expect(find(rows, { market: "total", side: "over", line: 150.5 })?.decimal).toBe(1.4167);
    expect(find(rows, { market: "total", side: "under", line: 150 })?.decimal).toBe(2.85);
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
    expect(find(rows, { market: "spread", side: "away", line: -35.5 })?.decimal).toBe(1.01);
    expect(find(rows, { market: "total", side: "under", line: 120.5 })?.decimal).toBe(2);
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
