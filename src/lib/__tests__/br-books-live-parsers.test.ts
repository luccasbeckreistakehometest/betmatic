import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { selectKambiLiveEvents, kambiEvent, parseKambiOffers, type KambiEventOffers, type KambiLiveView } from "@/lib/sources/br-books/kambi";
import { selectAltenarLiveEvents, altenarEvent, parseAltenarEvent, type AltenarEventDetails, type AltenarLiveList } from "@/lib/sources/br-books/altenar";
import { selectSuperbetLiveEvents, superbetEvent, parseSuperbetEvent, type SuperbetEventDetail, type SuperbetListEvent } from "@/lib/sources/br-books/superbet";
import type { BookPrice } from "@/lib/sources/br-books/types";

/**
 * The in-play feeds, parsed from bytes captured live on 24/09/2026.
 *
 * Every fixture here is a real answer from the book's own public live endpoint to a plain client:
 * Kambi's `event/live/open.json` and the bet-offer document of a STARTED event, Altenar's
 * `GetLiveEvents` and the `GetEventDetails` of the game it named, Superbet's `index=live` list and
 * the per-event document of a game in its third quarter. Where a capture carries no game in a
 * league this product sells — nothing in the NBA or the WNBA was on a board at 06:00 UTC on a
 * September Thursday — the league filter's ACCEPT path is exercised by re-keying a real event onto
 * the league's own id, which is stated at each such spot; the REJECT path uses the real bytes.
 */
const fixture = <T>(name: string): T => JSON.parse(fs.readFileSync(path.join(process.cwd(), "src/lib/__tests__/fixtures/br-books", name), "utf8")) as T;
const AT = "2026-09-24T06:05:00.000Z";
const find = (rows: BookPrice[], f: Partial<BookPrice>) => rows.find((r) => Object.entries(f).every(([k, v]) => (r as unknown as Record<string, unknown>)[k] === v));

describe("KTO / Kambi in play", () => {
  const live = fixture<KambiLiveView>("kambi-live-open.json");

  it("selects by the same league tree the pre-game reader uses, and nothing else", () => {
    // Real capture: football friendlies, esports football and an ATP match. None is a sold league.
    expect(selectKambiLiveEvents(live, "wnba")).toEqual([]);
    expect(selectKambiLiveEvents(live, "nba")).toEqual([]);
    expect(selectKambiLiveEvents(live, "soccer-bra")).toEqual([]);
    expect(selectKambiLiveEvents(live, "tennis-atp")).toEqual([]);
  });

  it("takes a live event whose own tree is the sold league's", () => {
    // The same real event with its path re-keyed to basketball/wnba: the accept path of the filter.
    const wnba: KambiLiveView = {
      liveEvents: [{ ...live.liveEvents![0], event: { ...live.liveEvents![0].event, path: [{ termKey: "basketball" }, { termKey: "wnba" }] } }],
    };
    expect(selectKambiLiveEvents(wnba, "wnba").map((e) => e.id)).toEqual([1029242711]);
  });

  it("skips an event with no live bet offer and one that has not started", () => {
    const base = live.liveEvents![0];
    const shaped = (over: Record<string, unknown>): KambiLiveView => ({
      liveEvents: [{ ...base, event: { ...base.event, path: [{ termKey: "basketball" }, { termKey: "wnba" }], ...over } }],
    });
    expect(selectKambiLiveEvents(shaped({ liveBoCount: 0 }), "wnba")).toEqual([]);
    expect(selectKambiLiveEvents(shaped({ state: "NOT_STARTED" }), "wnba")).toEqual([]);
  });

  it("prices a live board and stamps every row in play", () => {
    const offers = fixture<KambiEventOffers>("kambi-live-betoffer-1029221084.json");
    const event = kambiEvent(offers.events![0], "basketball", "KTO", "ktobr")!;
    const rows = parseKambiOffers(offers, event, "KTO", AT, undefined, true);
    // Kambi prices are in thousandths: OT_ONE 3550 is 3.55.
    expect(find(rows, { market: "moneyline", side: "home" })?.decimal).toBe(3.55);
    expect(find(rows, { market: "moneyline", side: "away" })?.decimal).toBe(1.27);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.inPlay === true)).toBe(true);
    // A live bet offer carries no criterion.lifetime; the full-time filter must still let it through.
    expect(offers.betOffers!.every((o) => !o.criterion?.lifetime)).toBe(true);
  });

  it("leaves a pre-game read unstamped, so the two populations never merge", () => {
    const offers = fixture<KambiEventOffers>("kambi-live-betoffer-1029221084.json");
    const event = kambiEvent(offers.events![0], "basketball", "KTO", "ktobr")!;
    expect(parseKambiOffers(offers, event, "KTO", AT).every((r) => r.inPlay === undefined)).toBe(true);
  });
});

describe("Altenar in play", () => {
  const live = fixture<AltenarLiveList>("altenar-live-basketball.json");

  it("rejects a live championship the product does not sell", () => {
    // Real capture: the tenant's only live basketball game was a "BSKT CUP" fixture.
    expect(selectAltenarLiveEvents(live, "wnba")).toEqual([]);
    expect(selectAltenarLiveEvents(live, "nba")).toEqual([]);
  });

  it("takes the live event when its championship is the sold league", () => {
    // The same real payload with the championship named WNBA: the accept path of the filter.
    const wnba: AltenarLiveList = { ...live, champs: [{ id: live.champs![0].id, name: "WNBA" }] };
    const picked = selectAltenarLiveEvents(wnba, "wnba");
    expect(picked.map((p) => p.ev.id)).toEqual([17821103]);
    expect(picked[0].league).toBe("WNBA");
  });

  it("prices the live board the tenant returned for that event", () => {
    const detail = fixture<AltenarEventDetails>("altenar-live-event-17821103.json");
    const competitors = new Map((detail.competitors ?? []).map((c) => [c.id, c.name]));
    const event = altenarEvent(detail, "basketball", "estrelabet", competitors, "WNBA")!;
    const rows = parseAltenarEvent(detail, event, "EstrelaBet", AT, undefined, true);
    // The handicap was re-hung for the state of the game, and both sides of it are priced.
    expect(find(rows, { market: "spread", side: "home", line: 10.5 })?.decimal).toBe(1.79);
    expect(find(rows, { market: "spread", side: "away", line: -10.5 })?.decimal).toBe(1.84);
    expect(find(rows, { market: "total", side: "over", line: 124.5 })?.decimal).toBe(1.69);
    expect(rows.every((r) => r.inPlay === true)).toBe(true);
  });
});

describe("Superbet in play", () => {
  const list = fixture<{ events: SuperbetListEvent[] }>("superbet-live-index.json");
  const names = new Map<number, string>([[2174, "EUA - WNBA (F)"], [2401, "Rússia - Liga"], [89188, "Simulados"]]);

  it("drops a finished game that is still sitting on the live index", () => {
    // Real capture: two WNBA games on the live index, both FINISHED with zero live odds.
    const wnba = list.events.filter((e) => e.fixture.tournament_id === 2174);
    expect(wnba.length).toBe(2);
    expect(wnba.every((e) => e.inplay_stats_metadata?.status === "FINISHED")).toBe(true);
    expect(selectSuperbetLiveEvents(list.events, "wnba", names)).toEqual([]);
  });

  it("takes a started game of the sold league that has a live board", () => {
    // A real STARTED event (29 live odds) re-keyed onto the WNBA tournament id.
    const started = list.events.find((e) => e.event_id === 15091084)!;
    const shaped = [{ ...started, fixture: { ...started.fixture, tournament_id: 2174 } }, ...list.events];
    expect(selectSuperbetLiveEvents(shaped, "wnba", names).map((p) => p.ev.event_id)).toEqual([15091084]);
  });

  it("needs the live index's own odds count, not just a STARTED status", () => {
    const started = list.events.find((e) => e.event_id === 15091084)!;
    const dry = [{ ...started, fixture: { ...started.fixture, tournament_id: 2174 }, inplay_stats_metadata: { ...started.inplay_stats_metadata, counts: { odds: { "1": 0, "2": 0 } } } }];
    expect(selectSuperbetLiveEvents(dry, "wnba", names)).toEqual([]);
  });

  it("prices the live board the same per-event document returned", () => {
    const detail = fixture<SuperbetEventDetail>("superbet-live-event-15091084.json");
    const started = list.events.find((e) => e.event_id === 15091084)!;
    const event = superbetEvent(started, "basketball", "EUA - WNBA (F)")!;
    const rows = parseSuperbetEvent(detail, event, AT, true);
    expect(find(rows, { market: "moneyline", side: "home" })?.decimal).toBe(1.02);
    expect(find(rows, { market: "moneyline", side: "away" })?.decimal).toBe(9.5);
    // The total was re-hung in play at 149.5 and both sides carry a live price.
    expect(find(rows, { market: "total", side: "over", line: 149.5 })?.decimal).toBe(1.85);
    expect(find(rows, { market: "total", side: "under", line: 149.5 })?.decimal).toBe(1.83);
    expect(rows.every((r) => r.inPlay === true)).toBe(true);
    // The running quarter's own markets are noise for a ticket that settles on the final box score.
    expect(rows.some((r) => r.line === 38.5)).toBe(false);
  });
});
