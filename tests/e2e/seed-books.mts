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

ensureBooksSchema();
const out = persistPrices(prices, "wnba", [game], now);
if (out.matched !== 3) throw new Error(`seed-books: expected the three book events to match game 990000101, got ${JSON.stringify(out)}`);
console.log(`seed-books: ${out.rows} rows, ${out.events} events, ${out.matched} matched`);
