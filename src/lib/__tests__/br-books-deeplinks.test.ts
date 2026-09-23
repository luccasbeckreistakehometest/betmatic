import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { affiliateTagsFromEnv, bookEnvKey, DEEP_LINK_REGISTRY, deepLinkFor, supportsTicketLink, ticketDeepLinkFor, withAffiliate } from "@/lib/sources/br-books/deeplinks";
import { ALL_ADAPTERS } from "@/lib/sources/br-books/registry";
import { parseSuperbetEvent, superbetEvent, superbetEventUrl, type SuperbetEventDetail } from "@/lib/sources/br-books/superbet";
import { kambiEvent, parseKambiOffers, type KambiEventOffers } from "@/lib/sources/br-books/kambi";
import { altenarEvent, parseAltenarEvent, type AltenarEventDetails } from "@/lib/sources/br-books/altenar";
import { exchangeEvent, parseExchangeMarkets, type ExchangePayload } from "@/lib/sources/br-books/betfair-exchange";
import { cdsEvent, parseCdsFixture, type CdsFixtures } from "@/lib/sources/br-books/sportingbet";
import { parseRampRows, type RampPayload } from "@/lib/sources/br-books/betnacional";
import type { BookPrice } from "@/lib/sources/br-books/types";
import { compareSuggestionsWith } from "@/lib/server/book-compare";
import type { BetSuggestion } from "@/lib/types";

const fixture = <T>(name: string): T => JSON.parse(fs.readFileSync(path.join(process.cwd(), "src/lib/__tests__/fixtures/br-books", name), "utf8")) as T;
const AT = "2026-09-22T12:00:00.000Z";
const WINDOW = { from: "2026-09-22T11:00:00.000Z", to: "2026-09-24T12:00:00.000Z" };
const find = (rows: BookPrice[], f: Partial<BookPrice>) => rows.find((r) => Object.entries(f).every(([k, v]) => (r as unknown as Record<string, unknown>)[k] === v))!;

// The Mystics × Sun fixture of 22/09/2026 at every book, parsed the way the job parses it.
const superbet = (() => {
  const event = superbetEvent({ event_id: 14033464, fixture: { betradar_id: "68096448", event_name: "Washington Mystics (F)·Connecticut Sun (F)", utc_date: "2026-09-22T23:30:00Z", tournament_id: 2174, sport_id: 4 } }, "basketball", "EUA - WNBA (F)")!;
  return parseSuperbetEvent(fixture<SuperbetEventDetail>("superbet-event-14033464.json"), event, AT);
})();
const kto = (() => {
  const payload = fixture<KambiEventOffers>("kambi-event-1027216026.json");
  return parseKambiOffers(payload, kambiEvent(payload.events![0], "basketball", "KTO", "ktobr")!, "KTO", AT);
})();
const estrelabet = (() => {
  const detail = fixture<AltenarEventDetails>("altenar-eventdetails-16614649.json");
  const competitors = new Map((detail.competitors ?? []).map((c) => [c.id, c.name]));
  return parseAltenarEvent(detail, altenarEvent(detail, "basketball", "estrelabet", competitors, "WNBA")!, "EstrelaBet", AT);
})();
const betfair = parseExchangeMarkets(fixture<ExchangePayload>("betfair-bymarket.json"), exchangeEvent({ id: "36094852", name: "Connecticut Sun @ Washington Mystics", openDate: "2026-09-22T23:30:00.000Z" }, "basketball", "wnba")!, AT);
const sportingbet = (() => {
  const f = fixture<CdsFixtures>("sportingbet-fixtures.json").fixtures!.find((x) => x.id === "19919149")!;
  return parseCdsFixture(f, cdsEvent(f, "basketball")!, AT);
})();
const betnacional = parseRampRows(fixture<RampPayload>("betnacional-basketball.json"), "wnba", "basketball", WINDOW.from, WINDOW.to, AT);

describe("the adapters keep the ids a deep link needs", () => {
  it("Superbet: event id, outcome id, the odd's uuid and its special-bet value", () => {
    expect(find(superbet, { market: "moneyline", side: "home" }).ref).toEqual({ eventId: "14033464", marketId: "759", outcomeId: "2182", uuid: "cf563fdf-1ecc-5750-8384-97929d21c197", specialBetValue: undefined });
    const prop = find(superbet, { market: "player_prop", player: "Georgia Amoore", side: "over", line: 7.5 });
    expect(prop.ref).toMatchObject({ eventId: "14033464", outcomeId: "5788", specialBetValue: "Amoore, Georgia-7.5" });
    expect(superbet.every((p) => p.url === superbetEventUrl(p.event))).toBe(true);
  });
  it("KTO: event, bet offer and outcome ids as Kambi prints them", () => {
    expect(find(kto, { market: "moneyline", side: "home" }).ref).toEqual({ eventId: "1027216026", marketId: "2694757276", outcomeId: "4345413448" });
  });
  it("EstrelaBet: event, market and odd ids (no scheme uses them yet, but they are kept)", () => {
    expect(find(estrelabet, { market: "moneyline", side: "home" }).ref).toEqual({ eventId: "16614649", marketId: "1744347226", outcomeId: "4538886470" });
  });
  it("Betfair Exchange: market id, selection id and the runner's handicap", () => {
    expect(find(betfair, { market: "moneyline", side: "away" }).ref).toEqual({ eventId: "36094852", marketId: "1.262696224", outcomeId: "1519948", handicap: "0" });
  });
  it("Sportingbet: the fixture-game-result triplet", () => {
    expect(find(sportingbet, { market: "spread", side: "away" }).ref).toEqual({ eventId: "19919149", marketId: "1560207544", outcomeId: "2301308044" });
  });
  it("Betnacional: the event id at least", () => {
    expect(find(betnacional, { market: "moneyline", side: "home" }).ref).toMatchObject({ eventId: "916559498", marketId: "99974622" });
  });
});

describe("deepLinkFor", () => {
  it("Superbet: the betslip route with bets[] as its own share builder writes it, landing on the event page", () => {
    const link = deepLinkFor(find(superbet, { market: "moneyline", side: "home" }))!;
    expect(link).toMatchObject({ book: "Superbet", kind: "betslip", verified: true, selections: 1 });
    expect(link.url).toBe("https://superbet.bet.br/betslip?bets%5B%5D=14033464%2C2182%2C%2C0%2Ccf563fdf-1ecc-5750-8384-97929d21c197&type=simple&target_screen=soccer_event_details");
    // A player line carries its special-bet value in the third field, percent-encoded so its own
    // comma cannot split the field (the site's builder does the same).
    const prop = deepLinkFor(find(superbet, { market: "player_prop", player: "Georgia Amoore", side: "over", line: 7.5 }))!;
    expect(new URL(prop.url).searchParams.get("bets[]")).toBe("14033464,5788,Amoore%2C%20Georgia-7.5,0,9e1ce12e-5805-559c-90f0-0e2ee2d93f52");
  });

  it("Superbet: a row stored before the uuid existed falls back to the event page", () => {
    const row = find(superbet, { market: "moneyline", side: "home" });
    const link = deepLinkFor({ ...row, ref: { eventId: "14033464", outcomeId: "2182" } })!;
    expect(link).toMatchObject({ kind: "event", verified: true, selections: 0, url: "https://superbet.bet.br/odds/basquete/washington-mystics-x-connecticut-sun-14033464" });
    expect(deepLinkFor({ ...row, ref: undefined })!.kind).toBe("event");
  });

  it("KTO: Kambi's coupon in the hash, as KTO's own promo cards write it — built, never opened", () => {
    const link = deepLinkFor(find(kto, { market: "moneyline", side: "home" }))!;
    expect(link).toEqual({ book: "KTO", kind: "betslip", verified: false, selections: 1, url: "https://www.kto.bet.br/app/esportes/#?coupon=combination|4345413448|0|replace" });
    expect(deepLinkFor({ ...find(kto, { market: "moneyline", side: "home" }), ref: undefined })).toBeNull();
  });

  it("Betfair Exchange: the market page under the English sport slug the exchange's own anchors use", () => {
    expect(deepLinkFor(find(betfair, { market: "moneyline", side: "away" }))).toEqual({ book: "Betfair Exchange", kind: "market", verified: true, selections: 0, url: "https://www.betfair.bet.br/exchange/plus/basketball/market/1.262696224" });
    const soccer = { ...find(betfair, { market: "moneyline", side: "away" }), sport: "soccer" as const };
    expect(deepLinkFor(soccer)!.url).toContain("/exchange/plus/football/market/");
  });

  it("Sportingbet: Entain's options triplet on the sports home", () => {
    expect(deepLinkFor(find(sportingbet, { market: "spread", side: "away" }))).toEqual({ book: "Sportingbet", kind: "betslip", verified: true, selections: 1, url: "https://www.sportingbet.bet.br/pt-br/sports?options=19919149-1560207544-2301308044&type=single" });
  });

  it("Betnacional: the event page by sport and event id", () => {
    expect(deepLinkFor(find(betnacional, { market: "moneyline", side: "home" }))).toEqual({ book: "Betnacional", kind: "event", verified: true, selections: 0, url: "https://betnacional.bet.br/event/2/0/916559498" });
  });

  it("an Altenar tenant builds nothing: its widget showed a plain client no event URL, and none is guessed", () => {
    expect(deepLinkFor(find(estrelabet, { market: "moneyline", side: "home" }))).toBeNull();
  });
});

describe("ticketDeepLinkFor", () => {
  it("carries every leg into one Superbet slip, in the order given", () => {
    const legs = [find(superbet, { market: "moneyline", side: "home" }), find(superbet, { market: "player_prop", player: "Georgia Amoore", side: "over", line: 7.5 })];
    const link = ticketDeepLinkFor(legs)!;
    expect(link).toMatchObject({ book: "Superbet", kind: "betslip", selections: 2 });
    const bets = new URL(link.url).searchParams.getAll("bets[]");
    expect(bets).toHaveLength(2);
    expect(bets[0]).toMatch(/^14033464,2182,,0,/);
    expect(bets[1]).toMatch(/^14033464,5788,Amoore%2C%20Georgia-7\.5,0,/);
  });

  it("Sportingbet: several triplets and type=combo; KTO: outcome ids comma-separated", () => {
    const sb = ticketDeepLinkFor([find(sportingbet, { market: "spread", side: "away" }), find(sportingbet, { market: "total", side: "over" })])!;
    expect(sb.url).toMatch(/^https:\/\/www\.sportingbet\.bet\.br\/pt-br\/sports\?options=19919149-1560207544-2301308044,19919149-\d+-\d+&type=combo$/);
    const k = ticketDeepLinkFor([find(kto, { market: "moneyline", side: "home" }), find(kto, { market: "moneyline", side: "away" })])!;
    expect(k).toMatchObject({ verified: false, selections: 2, url: "https://www.kto.bet.br/app/esportes/#?coupon=combination|4345413448,4345413449|0|replace" });
  });

  it("is null across books, at a book whose scheme takes one selection, or when a leg lacks its ids", () => {
    expect(ticketDeepLinkFor([find(superbet, { market: "moneyline", side: "home" }), find(kto, { market: "moneyline", side: "home" })])).toBeNull();
    expect(ticketDeepLinkFor([find(betfair, { market: "moneyline", side: "away" }), find(betfair, { market: "moneyline", side: "home" })])).toBeNull();
    expect(ticketDeepLinkFor([find(superbet, { market: "moneyline", side: "home" }), { ...find(superbet, { market: "moneyline", side: "away" }), ref: undefined }])).toBeNull();
    expect(ticketDeepLinkFor([])).toBeNull();
    // One row is the single-selection link.
    expect(ticketDeepLinkFor([find(betfair, { market: "moneyline", side: "away" })])!.kind).toBe("market");
    expect(supportsTicketLink("superbet") && supportsTicketLink("kambi") && supportsTicketLink("sportingbet")).toBe(true);
    expect(supportsTicketLink("betfair-exchange") || supportsTicketLink("betnacional") || supportsTicketLink("altenar")).toBe(false);
  });
});

describe("affiliate tags", () => {
  it("names the env key after the book, upper snake case, accents dropped", () => {
    expect(["Superbet", "KTO", "Aposta Ganha", "Betfair Exchange", "BetPix365", "Betnacional"].map(bookEnvKey)).toEqual(["SUPERBET", "KTO", "APOSTA_GANHA", "BETFAIR_EXCHANGE", "BETPIX365", "BETNACIONAL"]);
  });

  it("reads BOOK_AFFILIATE_* from the env and drops empty values", () => {
    expect(affiliateTagsFromEnv({ BOOK_AFFILIATE_SUPERBET: "btag=abc123", BOOK_AFFILIATE_KTO: "  ", BOOK_AFFILIATE_BETFAIR_EXCHANGE: "utm_source=betmatic&utm_medium=link", OTHER: "x" })).toEqual({ SUPERBET: "btag=abc123", BETFAIR_EXCHANGE: "utm_source=betmatic&utm_medium=link" });
  });

  it("appends the tag verbatim to the query, before a hash, and only for the tagged book", () => {
    const affiliate = { SUPERBET: "btag=abc123", KTO: "utm_source=betmatic", BETNACIONAL: "#ref=bm" };
    expect(deepLinkFor(find(superbet, { market: "moneyline", side: "home" }), { affiliate })!.url).toMatch(/&target_screen=soccer_event_details&btag=abc123$/);
    // KTO's deep link lives in the hash: the tag goes into the query in front of it.
    expect(deepLinkFor(find(kto, { market: "moneyline", side: "home" }), { affiliate })!.url).toBe("https://www.kto.bet.br/app/esportes/?utm_source=betmatic#?coupon=combination|4345413448|0|replace");
    expect(deepLinkFor(find(betnacional, { market: "moneyline", side: "home" }), { affiliate })!.url).toBe("https://betnacional.bet.br/event/2/0/916559498#ref=bm");
    expect(deepLinkFor(find(betfair, { market: "moneyline", side: "away" }), { affiliate })!.url).toBe("https://www.betfair.bet.br/exchange/plus/basketball/market/1.262696224");
    expect(withAffiliate("https://x.test/a", "?btag=1")).toBe("https://x.test/a?btag=1");
    expect(withAffiliate("https://x.test/a?b=1", "&btag=1")).toBe("https://x.test/a?b=1&btag=1");
    expect(withAffiliate("https://x.test/a", "")).toBe("https://x.test/a");
  });
});

describe("the registry", () => {
  it("names every book the adapters read, and every scheme it calls verified has a URL form and a source", () => {
    for (const a of ALL_ADAPTERS) expect(DEEP_LINK_REGISTRY.some((r) => r.book === a.book), a.book).toBe(true);
    for (const r of DEEP_LINK_REGISTRY) {
      expect(r.source.length, r.book).toBeGreaterThan(20);
      if (r.kind !== "none") expect(r.scheme.startsWith("https://"), r.book).toBe(true);
      if (r.verified) expect(r.kind, r.book).not.toBe("none");
    }
    // The one betslip scheme that was never opened says so.
    expect(DEEP_LINK_REGISTRY.find((r) => r.book === "KTO")).toMatchObject({ kind: "betslip", verified: false });
  });
});

describe("the prices payload", () => {
  const game = { home: { abbreviation: "WSH", displayName: "Washington Mystics" }, away: { abbreviation: "CONN", displayName: "Connecticut Sun" } };
  const base = { market: "player prop", odds: "1.90", oddsDecimal: 1.9, explanation: "", evidence: "", fairProbability: 0.5 };
  const s = (id: string, legs: BetSuggestion["legs"]): BetSuggestion => ({ id, kind: legs.length > 1 ? "parlay" : "single", bandKey: "value", title: id, background: "", legs, combinedDecimal: 2, combinedAmerican: "+100", impliedProbability: 0.5, modelledProbability: 0.5, edgePct: 0, riskNote: "", confidence: "medium", evidenceScore: 50, evidenceNotes: [] });
  const prices = [...superbet, ...kto, ...estrelabet, ...betfair, ...sportingbet, ...betnacional];

  it("carries one link per book that prices the leg, best first, and one for the whole ticket at the best single book", () => {
    const out = compareSuggestionsWith(prices, [
      s("ml", [{ ...base, selection: "Mystics", oddsDecimal: 1.07, settlement: { type: "moneyline", teamAbbreviation: "WSH", sourceBasis: "" } }]),
      s("double", [
        { ...base, selection: "Mystics", oddsDecimal: 1.07, settlement: { type: "moneyline", teamAbbreviation: "WSH", sourceBasis: "" } },
        { ...base, selection: "Amoore o7.5", settlement: { type: "player_prop", player: "Georgia Amoore", stat: "points", line: 7.5, side: "over", sourceBasis: "" } },
      ]),
    ], game, "wnba", { affiliate: { SUPERBET: "btag=e2e" } });
    const ml = out[0].legs[0]!;
    // Books in the quotes' order (best price first); the exchange is a reference, never a link; a
    // book without a scheme (EstrelaBet) is simply absent.
    expect(ml.quotes.map((q) => q.book)).toEqual(["KTO", "EstrelaBet", "Superbet", "Betnacional"]);
    expect(ml.links.map((l) => [l.book, l.kind, l.verified])).toEqual([["KTO", "betslip", false], ["Superbet", "betslip", true], ["Betnacional", "event", true]]);
    expect(ml.links.find((l) => l.book === "Superbet")!.url).toMatch(/&btag=e2e$/);
    expect(ml.links.find((l) => l.book === "KTO")!.url).toBe("https://www.kto.bet.br/app/esportes/#?coupon=combination|4345413448|0|replace");
    // A one-leg ticket's link is the leg's link at the best single book (KTO pays 1.08, Superbet 1.07).
    expect(out[0].bestSingleBook?.book).toBe("KTO");
    expect(out[0].slip).toMatchObject({ kind: "full", best: { book: "KTO", covered: [0], decimal: 1.08 } });
    expect(out[0].slip.best!.link).toMatchObject({ book: "KTO", selections: 1 });
    // The double is priced whole only by Superbet, whose scheme carries both legs in one slip.
    expect(out[1].bestSingleBook?.book).toBe("Superbet");
    expect(out[1].slip.kind).toBe("full");
    expect(out[1].slip.best!.link).toMatchObject({ book: "Superbet", kind: "betslip", selections: 2 });
    expect(new URL(out[1].slip.best!.link.url).searchParams.getAll("bets[]")).toHaveLength(2);
  });

  it("falls back to the book's own page when its scheme takes one selection, and never counts an unnamed leg as covered", () => {
    const rows = prices.filter((p) => p.book === "Betnacional" || p.book === "Betfair Exchange");
    const out = compareSuggestionsWith(rows, [
      s("both", [{ ...base, selection: "Mystics", oddsDecimal: 1.07, settlement: { type: "moneyline", teamAbbreviation: "WSH", sourceBasis: "" } }, { ...base, selection: "Sun", oddsDecimal: 8, settlement: { type: "moneyline", teamAbbreviation: "CONN", sourceBasis: "" } }]),
      s("unnamed", [{ ...base, selection: "Mystics", oddsDecimal: 1.07, settlement: { type: "moneyline", teamAbbreviation: "WSH", sourceBasis: "" } }, { ...base, selection: "?", settlement: { type: "other", sourceBasis: "" } }]),
    ], game, "wnba");
    expect(out[0].bestSingleBook?.book).toBe("Betnacional");
    expect(out[0].legs[0]!.links).toEqual([{ book: "Betnacional", kind: "event", verified: true, selections: 0, url: "https://betnacional.bet.br/event/2/0/916559498" }]);
    // Betnacional prices both sides of the moneyline but its URL scheme carries no selection: the
    // reader is still sent to the right page, with the coverage said out loud and the link's own
    // reach (selections 0, "page") said beside it.
    expect(out[0].slip).toMatchObject({ kind: "full", best: { book: "Betnacional", covered: [0, 1] } });
    expect(out[0].slip.best!.link).toMatchObject({ kind: "event", selections: 0 });
    // A leg the settlement descriptor cannot name is missing at every book: the ticket is partial,
    // never full, because a link that quietly dropped it would build a shorter ticket.
    expect(out[1].slip.kind).toBe("partial");
    expect(out[1].slip.best).toMatchObject({ book: "Betnacional", covered: [0], missing: [{ index: 1, reason: "market" }], full: false });
    expect(out[1].legs[1]).toBeNull();
  });
});
