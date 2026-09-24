/**
 * Book prices for the seeded WNBA game (990000101, Aurora Aces × Boreal Birds), written through the
 * real store so the schema, the matcher and the read path are the ones production runs. The ids
 * are shaped like the books' own (Superbet event/outcome/uuid, Kambi outcome, Betfair market) so
 * the "Abrir na casa" links under the tickets are built by the same code that builds them live.
 *
 * The prices are chosen so the game's three main tickets land on three different answers to "where
 * can I place this?", which is what the specs read:
 *
 *   moneyline single ("Vitória do mandante")  no book row at all → NOTHING MATCHES, said plainly
 *   prop single ("A linha mais medida")       Superbet has the exact line → the WHOLE ticket
 *   prop double ("Dupla de jogadores")        Superbet has one of the two, and posts the other one
 *                                             rung away → PART of the ticket, the missing leg named,
 *                                             and the rung offered separately as a different bet
 *
 * Eva Nunes' line is priced by three feeds on purpose: Superbet (the best price), KTO (the worst,
 * so "vs pior" has a book) and the exchange with a real back/lay pair (so "justo" comes from the
 * midpoint rather than a no-vig mean).
 *
 *   DATA_DIR=data/e2e npx tsx tests/e2e/seed-books.mts <startsAt ISO>
 */
import { ensureBooksSchema, persistPrices } from "@/lib/server/book-prices";
import type { BookEvent, BookPrice } from "@/lib/sources/br-books/types";
import type { Game } from "@/lib/types";

const startsAt = process.argv[2] ?? new Date(Date.now() + 5 * 3_600_000).toISOString();
const now = new Date();
const team = (id: string, abbreviation: string, displayName: string): Game["home"] => ({ id, abbreviation, name: displayName.split(" ").pop()!, displayName });
const game: Game = { id: "990000101", sportKey: "wnba", startsAt, status: "scheduled", statusDetail: "", home: team("9901", "AUR", "Aurora Aces"), away: team("9902", "BOR", "Boreal Birds") };

const event = (key: string, externalIds: Record<string, string>): BookEvent => ({ key, home: "Aurora Aces", away: "Boreal Birds", startsAt, externalIds, sport: "basketball", league: "WNBA" });
const row = (book: string, platform: string, ev: BookEvent, p: Partial<BookPrice>): BookPrice => ({ book, platform, sport: "basketball", event: ev, market: "player_prop", kind: "total", decimal: 1.9, fetchedAt: now.toISOString(), ...p });

const sb = event("superbet:superbet:99000101", { superbet: "99000101", betradar: "99000101" });
const kambi = event("kambi:ktobr:1029000101", { kambi: "1029000101" });
const bf = event("betfair-exchange:betfair:36000101", { betfair: "36000101" });
const superbetRef = (outcomeId: string, uuid: string, specialBetValue?: string) => ({ eventId: "99000101", marketId: "233565", outcomeId, uuid, specialBetValue });

const prices: BookPrice[] = [
  // Eva Nunes over 7.5 rebounds is the mock model's first prop: the single ticket is that leg alone
  // and the double is that leg plus Bia Souza. Superbet posts it, so the single has a whole-ticket link.
  row("Superbet", "superbet", sb, { player: "Eva Nunes", stat: "rebounds", line: 7.5, side: "over", decimal: 1.95, ref: superbetRef("5788", "e2e0aaaa-0000-5000-8000-000000000001", "Nunes, Eva-7.5") }),
  row("Superbet", "superbet", sb, { player: "Eva Nunes", stat: "rebounds", line: 7.5, side: "under", decimal: 1.85, ref: superbetRef("5789", "e2e0aaaa-0000-5000-8000-000000000002", "Nunes, Eva-7.5") }),
  // Bia Souza, the double's second leg, is posted ONE RUNG AWAY (7.5, not the ticket's 6.5): the
  // double's link carries one of two legs and the rung is offered beside it as a different bet.
  row("Superbet", "superbet", sb, { player: "Bia Souza", stat: "rebounds", line: 7.5, side: "over", decimal: 2.1, ref: superbetRef("5790", "e2e0aaaa-0000-5000-8000-000000000003", "Souza, Bia-7.5") }),
  row("Superbet", "superbet", sb, { player: "Bia Souza", stat: "rebounds", line: 7.5, side: "under", decimal: 1.72, ref: superbetRef("5791", "e2e0aaaa-0000-5000-8000-000000000004", "Souza, Bia-7.5") }),
  // Ana Lima's points line backs the alternative tickets' legs.
  row("Superbet", "superbet", sb, { player: "Ana Lima", stat: "points", line: 17.5, side: "over", decimal: 1.95, ref: superbetRef("5792", "e2e0aaaa-0000-5000-8000-000000000005", "Lima, Ana-17.5") }),
  row("Superbet", "superbet", sb, { player: "Ana Lima", stat: "points", line: 17.5, side: "under", decimal: 1.8, ref: superbetRef("5793", "e2e0aaaa-0000-5000-8000-000000000006", "Lima, Ana-17.5") }),
  // KTO prices Eva Nunes' line too, a shade worse: the runner-up book under "outras casas", and the
  // "pior" side of the leg's best-vs-worst line. Kambi-shaped ids.
  row("KTO", "kambi", kambi, { player: "Eva Nunes", stat: "rebounds", line: 7.5, side: "over", decimal: 1.8, ref: { eventId: "1029000101", marketId: "2694000101", outcomeId: "4345000101" } }),
  row("KTO", "kambi", kambi, { player: "Eva Nunes", stat: "rebounds", line: 7.5, side: "under", decimal: 1.95, ref: { eventId: "1029000101", marketId: "2694000101", outcomeId: "4345000102" } }),
  // The exchange: a real market (lay within 10% of the back) so the leg's fair price is the midpoint.
  // It is never a place to bet in the product — the comparison's reference, never a candidate book.
  row("Betfair Exchange", "betfair-exchange", bf, { player: "Eva Nunes", stat: "rebounds", line: 7.5, side: "over", decimal: 1.98, lay: 2.02, ref: { eventId: "36000101", marketId: "1.290000101", outcomeId: "1519001", handicap: "7.5" } }),
  row("Betfair Exchange", "betfair-exchange", bf, { player: "Eva Nunes", stat: "rebounds", line: 7.5, side: "under", decimal: 2.02, lay: 2.08, ref: { eventId: "36000101", marketId: "1.290000101", outcomeId: "1519002", handicap: "7.5" } }),
  // No moneyline row anywhere, on purpose: the game's moneyline ticket is the case where nothing a
  // book published matches the ticket, and the product has to say so instead of inventing a link.
];

/**
 * The CROSS-GAME slate: "as múltiplas do dia entre jogos". The mock builds two doubles inside the
 * window of src/lib/bets/cross-policy.ts — one line per match, four different players — so the books
 * have to be read ACROSS matches for either to have a link at all. Two books, two answers:
 *
 *   Superbet     posts both lines of the first double, and its bets[] names the match per selection
 *                → ONE slip with two matches in it, at the product of the two prices.
 *   Betnacional  posts both too, but its URL scheme opens ONE event page → the honest label is
 *                "abrir a página", and on a cross-game ticket that page holds half the bet.
 *
 * The second double (Bia Souza at 6.5 + Lia Teles) is the partial case across matches: Superbet
 * prices Lia Teles at the rung and Bia Souza one rung away, so the link carries one leg of two and
 * the near line is offered beside it as a different bet.
 *
 * The milestone rungs stay seeded although no ticket reaches them now: they are the prices a reader
 * sees under "onde apostar" for the long lines the window no longer emits, and dropping them would
 * quietly change what the book pages hold.
 *
 * The fake world kicks the three games off five, six and seven hours out (tests/e2e/espn-world.ts).
 */
const slateGame = (id: string, hours: number, home: Game["home"], away: Game["home"]): Game =>
  ({ ...game, id, startsAt: new Date(Date.parse(startsAt) + hours * 3_600_000).toISOString(), home, away });
const g103 = slateGame("990000103", 1, team("9905", "EST", "Estrela Stars"), team("9906", "FAR", "Farol Flames"));
const g104 = slateGame("990000104", 2, team("9907", "GAR", "Garoa Gulls"), team("9908", "HOR", "Horizonte Hawks"));

const slateEvent = (key: string, home: string, away: string, ids: Record<string, string>, startsAtIso: string): BookEvent =>
  ({ key, home, away, startsAt: startsAtIso, externalIds: ids, sport: "basketball", league: "WNBA" });
/** A milestone rung ("25+ pontos") as the store holds it: an over at N − 0,5. */
const milestone = (book: string, platform: string, ev: BookEvent, player: string, line: number, decimal: number, ref: BookPrice["ref"]): BookPrice =>
  row(book, platform, ev, { player, stat: "points", line, side: "over", decimal, kind: "milestone", ref });

const sb103 = slateEvent("superbet:superbet:99000103", "Estrela Stars", "Farol Flames", { superbet: "99000103" }, g103.startsAt);
const sb104 = slateEvent("superbet:superbet:99000104", "Garoa Gulls", "Horizonte Hawks", { superbet: "99000104" }, g104.startsAt);
const bn101 = slateEvent("betnacional:betnacional:88000101", "Aurora Aces", "Boreal Birds", { betnacional: "88000101" }, startsAt);
const bn103 = slateEvent("betnacional:betnacional:88000103", "Estrela Stars", "Farol Flames", { betnacional: "88000103" }, g103.startsAt);
const bn104 = slateEvent("betnacional:betnacional:88000104", "Garoa Gulls", "Horizonte Hawks", { betnacional: "88000104" }, g104.startsAt);
const bnRef = (eventId: string, outcomeId: string) => ({ eventId, marketId: "77", outcomeId });

/** A player line as the store holds it, on another match's event. */
const crossLine = (book: string, platform: string, ev: BookEvent, player: string, stat: string, line: number, decimal: number, ref: BookPrice["ref"]): BookPrice =>
  row(book, platform, ev, { player, stat, line, side: "over", decimal, ref });

const slatePrices: BookPrice[] = [
  // The first double's two legs, both at the rung the ticket names: one Superbet slip, two matches.
  crossLine("Superbet", "superbet", sb103, "Júlia Dias", "rebounds", 7.5, 1.92, { eventId: "99000103", marketId: "233565", outcomeId: "5797", uuid: "e2e0aaaa-0000-5000-8000-000000000010", specialBetValue: "Dias, Júlia-7.5" }),
  crossLine("Betnacional", "betnacional", bn103, "Júlia Dias", "rebounds", 7.5, 1.88, bnRef("88000103", "203")),
  crossLine("Betnacional", "betnacional", bn101, "Eva Nunes", "rebounds", 7.5, 1.9, bnRef("88000101", "201")),
  // The second double's Lia Teles leg. Bia Souza, its other leg, is posted one rung away above.
  crossLine("Superbet", "superbet", sb104, "Lia Teles", "rebounds", 9.5, 1.86, { eventId: "99000104", marketId: "233565", outcomeId: "5798", uuid: "e2e0aaaa-0000-5000-8000-000000000011", specialBetValue: "Teles, Lia-9.5" }),
  milestone("Superbet", "superbet", sb, "Ana Lima", 24.5, 4.8, superbetRef("5794", "e2e0aaaa-0000-5000-8000-000000000007", "Lima, Ana-24.5")),
  milestone("Superbet", "superbet", sb103, "Iara Costa", 24.5, 4.7, { eventId: "99000103", marketId: "233565", outcomeId: "5795", uuid: "e2e0aaaa-0000-5000-8000-000000000008", specialBetValue: "Costa, Iara-24.5" }),
  milestone("Superbet", "superbet", sb104, "Kika Pires", 25.5, 4.9, { eventId: "99000104", marketId: "233565", outcomeId: "5796", uuid: "e2e0aaaa-0000-5000-8000-000000000009", specialBetValue: "Pires, Kika-25.5" }),
  milestone("Betnacional", "betnacional", bn101, "Ana Lima", 24.5, 4.5, bnRef("88000101", "101")),
  milestone("Betnacional", "betnacional", bn103, "Iara Costa", 24.5, 4.4, bnRef("88000103", "103")),
  milestone("Betnacional", "betnacional", bn104, "Kika Pires", 25.5, 4.6, bnRef("88000104", "104")),
];

// One write for both, because a second call for the same book and event would retire the rows the
// first one had just stored: `persistPrices` ends by retiring whatever that book did not post this
// round, which is exactly right for a live read and exactly wrong for a seed in two halves.
ensureBooksSchema();
const out = persistPrices([...prices, ...slatePrices], "wnba", [game, g103, g104], now);
if (out.events !== 8 || out.matched !== 8) throw new Error(`seed-books: expected eight book events, all matched, got ${JSON.stringify(out)}`);
console.log(`seed-books: ${out.rows} rows, ${out.events} events, ${out.matched} matched`);
