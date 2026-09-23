/**
 * How linkable tonight's tickets actually are, before and after the best-effort slip.
 *
 *   DATA_DIR=/tmp/scratch npx tsx scripts/slip-measure.mts
 *
 * Reads the book rows the books job already stored in DATA_DIR (run scripts/books-run.mts first),
 * builds the same shape of ticket the prompt composes out of the game's REAL priced prop board —
 * fifteen tickets per game, one to four legs, drawn in the prop board's own order plus the game's
 * moneyline and total — and asks two questions of each:
 *
 *   BEFORE  the old rule: one book prices EVERY leg at the exact line and its URL scheme takes a
 *           whole slip. Anything less got no ticket link at all.
 *   AFTER   coverage.ts: full, partial (with the missing legs named), near (only a rung one step
 *           away), or nothing.
 *
 * No model is called and nothing is written to the ledger: the legs are real lines off the real
 * prop board, and which book carries them is decided entirely by the stored rows.
 */
import { listCoverage, pricesForGame } from "@/lib/server/book-prices";
import { buildPropCandidates } from "@/lib/props/candidates";
import { getGameDetail } from "@/lib/sources/espn";
import { compareSuggestionsWith } from "@/lib/server/book-compare";
import { supportsTicketLink } from "@/lib/sources/br-books/deeplinks";
import { getSport } from "@/lib/sports";
import type { BetLeg, BetSuggestion } from "@/lib/types";

const LEG_COUNTS = [1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 3, 3, 3, 4, 4];

const leg = (selection: string, odds: number, settlement: BetLeg["settlement"]): BetLeg => ({
  selection, market: "player prop", odds: String(odds), oddsDecimal: odds, explanation: "", evidence: "", fairProbability: 1 / odds, settlement,
});

async function legsFor(gameId: string, sportKey: string): Promise<BetLeg[]> {
  const detail = await getGameDetail(gameId, false, sportKey).catch(() => null);
  if (!detail) return [];
  const candidates = await buildPropCandidates(detail).catch(() => null);
  const out: BetLeg[] = [];
  for (const p of candidates?.props ?? []) {
    const stat = p.marketKey ?? p.market;
    if (!p.priced || !p.decimal || p.line === undefined || (p.side !== "over" && p.side !== "under")) continue;
    const label = getSport(sportKey).markets.find((m) => m.key === stat)?.label.pt ?? stat;
    out.push(leg(`${p.player} ${p.side === "over" ? "mais de" : "menos de"} ${p.line} ${label}`, p.decimal, { type: "player_prop", player: p.player, stat, line: p.line, side: p.side, sourceBasis: "measured history" }));
  }
  // The game's own two published markets, the short legs a safe band leans on.
  const book = detail.books[0];
  if (book?.homeMoneyline) out.unshift({ ...leg(`${detail.game.home.displayName} vence`, americanTo(book.homeMoneyline), { type: "moneyline", teamAbbreviation: detail.game.home.abbreviation, side: "home", sourceBasis: "book line" }), market: "moneyline" });
  if (book?.overUnder && book.overOdds) out.push({ ...leg(`Mais de ${book.overUnder}`, americanTo(book.overOdds), { type: "total", line: book.overUnder, side: "over", sourceBasis: "book line" }), market: "total" });
  return out;
}

const americanTo = (a: number) => (a > 0 ? 1 + a / 100 : 1 + 100 / Math.abs(a));

const ticket = (id: string, legs: BetLeg[]): BetSuggestion => ({
  id, kind: legs.length > 1 ? "parlay" : "single", bandKey: "value", title: id, background: "", legs,
  combinedDecimal: Number(legs.reduce((p, l) => p * l.oddsDecimal, 1).toFixed(2)), combinedAmerican: "+100",
  impliedProbability: 0.5, modelledProbability: 0.5, edgePct: 0, riskNote: "", confidence: "medium", evidenceScore: 50, evidenceNotes: [],
});

const totals = { full: 0, partial: 0, near: 0, none: 0, before: 0, tickets: 0, legs: 0, legsLinked: 0 };
const gaps: number[] = [];

for (const c of listCoverage()) {
  const pool = await legsFor(c.gameId, c.sportKey ?? "wnba");
  if (pool.length < 4) { console.log(`-- ${c.sportKey} ${c.gameId}: only ${pool.length} priced legs on the board, skipped`); continue; }
  const detail = await getGameDetail(c.gameId, false, c.sportKey ?? "wnba");
  const suggestions = LEG_COUNTS.map((n, i) => ticket(`t${i}`, Array.from({ length: n }, (_, k) => pool[(i * 2 + k) % pool.length])));
  const prices = pricesForGame(c.gameId);
  const out = compareSuggestionsWith(prices, suggestions, detail!.game, c.sportKey ?? "wnba");
  const row = { full: 0, partial: 0, near: 0, none: 0, before: 0 };
  for (const t of out) {
    const candidates = [t.slip.best, ...t.slip.others].filter((x) => !!x);
    // The old rule, reproduced: the highest-paying book that prices EVERY leg, and only if that
    // book's own scheme carries a whole slip.
    const complete = candidates.filter((x) => x.full).sort((a, b) => b.decimal - a.decimal)[0];
    const legs = t.legs.length;
    if (complete && (legs === 1 || supportsTicketLink(complete.platform))) { row.before += 1; totals.before += 1; }
    row[t.slip.kind] += 1;
    totals[t.slip.kind] += 1;
    totals.tickets += 1;
    totals.legs += legs;
    totals.legsLinked += t.legs.filter((l) => l && l.links.length).length;
    for (const n of t.slip.nearLines) gaps.push(n.gap);
  }
  console.log(`-- ${c.sportKey} ${c.gameId} (${c.books.length} books, ${c.props} props, ${pool.length} priced legs on the board): before ${row.before}/15 | after full ${row.full} partial ${row.partial} near ${row.near} none ${row.none}`);
}

const pct = (n: number) => `${Math.round((n / Math.max(totals.tickets, 1)) * 100)}%`;
console.log(`\n== ${totals.tickets} tickets, ${totals.legs} legs`);
console.log(`   BEFORE  whole-ticket link ${totals.before} (${pct(totals.before)})   nothing ${totals.tickets - totals.before} (${pct(totals.tickets - totals.before)})`);
console.log(`   AFTER   full ${totals.full} (${pct(totals.full)})  partial ${totals.partial} (${pct(totals.partial)})  near ${totals.near} (${pct(totals.near)})  none ${totals.none} (${pct(totals.none)})`);
console.log(`   legs with a link of their own: ${totals.legsLinked}/${totals.legs} (unchanged by this work)`);
if (gaps.length) {
  const s = [...gaps].sort((a, b) => a - b);
  console.log(`   near lines offered: ${gaps.length}, chance gap min ${s[0].toFixed(3)} median ${s[Math.floor(s.length / 2)].toFixed(3)} max ${s[s.length - 1].toFixed(3)}`);
}
