/**
 * Book prices for the seeded WNBA game (990000101, Aurora Aces × Boreal Birds), written through the
 * real store so the schema, the matcher and the read path are the ones production runs. The ids
 * are shaped like the books' own (Superbet event/outcome/uuid, Kambi outcome, Betfair market) so
 * the "Abrir na casa" links under the tickets are built by the same code that builds them live.
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
const row = (book: string, platform: string, ev: BookEvent, p: Partial<BookPrice>): BookPrice => ({ book, platform, sport: "basketball", event: ev, market: "moneyline", decimal: 1.9, fetchedAt: now.toISOString(), ...p });

const sb = event("superbet:superbet:99000101", { superbet: "99000101", betradar: "99000101" });
const kambi = event("kambi:ktobr:1029000101", { kambi: "1029000101" });
const bf = event("betfair-exchange:betfair:36000101", { betfair: "36000101" });
const prices: BookPrice[] = [
  // Superbet prices every leg the mock tickets carry: Ana Lima 17.5 pts, Bia Souza 6.5 reb, the home moneyline.
  row("Superbet", "superbet", sb, { side: "home", decimal: 1.62, ref: { eventId: "99000101", marketId: "759", outcomeId: "2182", uuid: "e2e0aaaa-0000-5000-8000-000000000001" } }),
  row("Superbet", "superbet", sb, { side: "away", decimal: 2.3, ref: { eventId: "99000101", marketId: "759", outcomeId: "2183", uuid: "e2e0aaaa-0000-5000-8000-000000000002" } }),
  row("Superbet", "superbet", sb, { market: "player_prop", player: "Ana Lima", stat: "points", line: 17.5, side: "over", decimal: 1.95, kind: "total", ref: { eventId: "99000101", marketId: "233565", outcomeId: "5788", uuid: "e2e0aaaa-0000-5000-8000-000000000003", specialBetValue: "Lima, Ana-17.5" } }),
  row("Superbet", "superbet", sb, { market: "player_prop", player: "Ana Lima", stat: "points", line: 17.5, side: "under", decimal: 1.8, kind: "total", ref: { eventId: "99000101", marketId: "233565", outcomeId: "5789", uuid: "e2e0aaaa-0000-5000-8000-000000000004", specialBetValue: "Lima, Ana-17.5" } }),
  row("Superbet", "superbet", sb, { market: "player_prop", player: "Bia Souza", stat: "rebounds", line: 6.5, side: "over", decimal: 1.88, kind: "total", ref: { eventId: "99000101", marketId: "233566", outcomeId: "5788", uuid: "e2e0aaaa-0000-5000-8000-000000000005", specialBetValue: "Souza, Bia-6.5" } }),
  // The mock model's first prop on this game (its double is Eva Nunes + Bia Souza): priced here so the
  // whole double has one book — and one link — behind it.
  row("Superbet", "superbet", sb, { market: "player_prop", player: "Eva Nunes", stat: "rebounds", line: 7.5, side: "over", decimal: 1.9, kind: "total", ref: { eventId: "99000101", marketId: "233566", outcomeId: "5788", uuid: "e2e0aaaa-0000-5000-8000-000000000006", specialBetValue: "Nunes, Eva-7.5" } }),
  row("Superbet", "superbet", sb, { market: "player_prop", player: "Eva Nunes", stat: "rebounds", line: 7.5, side: "under", decimal: 1.85, kind: "total", ref: { eventId: "99000101", marketId: "233566", outcomeId: "5787", uuid: "e2e0aaaa-0000-5000-8000-000000000007", specialBetValue: "Nunes, Eva-7.5" } }),
  // KTO prices the moneyline only (as it does the WNBA live), with Kambi-shaped ids.
  row("KTO", "kambi", kambi, { side: "home", decimal: 1.6, ref: { eventId: "1029000101", marketId: "2694000101", outcomeId: "4345000101" } }),
  row("KTO", "kambi", kambi, { side: "away", decimal: 2.35, ref: { eventId: "1029000101", marketId: "2694000101", outcomeId: "4345000102" } }),
  // The exchange: a real market (lay within 10% of the back) so the fair price is the midpoint.
  row("Betfair Exchange", "betfair-exchange", bf, { side: "home", decimal: 1.64, lay: 1.68, ref: { eventId: "36000101", marketId: "1.290000101", outcomeId: "1519001", handicap: "0" } }),
  row("Betfair Exchange", "betfair-exchange", bf, { side: "away", decimal: 2.4, lay: 2.5, ref: { eventId: "36000101", marketId: "1.290000101", outcomeId: "1519002", handicap: "0" } }),
];

ensureBooksSchema();
const out = persistPrices(prices, "wnba", [game], now);
if (out.matched !== 3) throw new Error(`seed-books: expected the three book events to match game 990000101, got ${JSON.stringify(out)}`);
console.log(`seed-books: ${out.rows} rows, ${out.events} events, ${out.matched} matched`);
