/**
 * Reads the Brazilian books now and prints what came back: per adapter, per matched game, and the
 * player lines where a book is out of step. The same job the cron runs (`?job=books`), from the
 * shell, so an operator can check a new adapter or a new league without waiting for a tick.
 *
 *   DATA_DIR=data pnpm tsx scripts/books-run.mts wnba soccer-bra
 *   BOOKS_DUMP=/tmp/books.json pnpm tsx scripts/books-run.mts wnba   # also writes the raw rows
 */
import fs from "node:fs";
import { runBooksJob, listUnmatchedEvents, listCoverage, pricesForGame } from "@/lib/server/book-prices";
import { compareLeg, propSignals } from "@/lib/sources/br-books/compare";
import { booksConfig } from "@/lib/sources/br-books/registry";

const sports = process.argv.slice(2).filter((s) => !s.startsWith("-"));
const started = Date.now();
const result = await runBooksJob({ sports });
console.log(`\n== books job ${result.runId}: ${result.status} in ${Math.round(result.ms / 1000)} s — ${result.games} games, ${result.rows} rows, ${result.events} events (${result.matched} matched)`);
for (const a of result.adapters) console.log(`   ${a.id.padEnd(22)} ${a.status.padEnd(8)} rows=${String(a.rows).padStart(5)} events=${String(a.events).padStart(3)} matched=${String(a.matched).padStart(3)} ${Math.round(a.ms / 1000)}s ${a.error ?? ""}`);

const unmatched = listUnmatchedEvents();
if (unmatched.length) {
  console.log(`\n== unmatched (${unmatched.length}):`);
  for (const u of unmatched.slice(0, 20)) console.log(`   ${u.book.padEnd(16)} ${u.home} × ${u.away} ${u.startsAt} ${u.league ?? ""} ext=${JSON.stringify(u.externalIds)}`);
}

const cfg = booksConfig();
const dump: Record<string, unknown> = { ranAt: new Date().toISOString(), result, unmatched, games: [] as unknown[] };
console.log(`\n== coverage (dispersion threshold ${cfg.dispersionPct}%):`);
for (const c of listCoverage()) {
  const prices = pricesForGame(c.gameId);
  const signals = propSignals(prices, { dispersionPct: cfg.dispersionPct }, 10);
  const ml = compareLeg(prices, { market: "moneyline", side: "away" });
  console.log(`\n-- ${c.sportKey} ${c.gameId} ${c.startsAt}: ${c.books.length} books (${c.books.join(", ")}), ${c.prices} prices, ${c.props} props`);
  if (ml.quotes.length) console.log(`   away ML: ${ml.quotes.map((q) => `${q.book} ${q.decimal}`).join(" | ")}${ml.exchange ? ` | exchange ${ml.exchange.decimal}/${ml.exchange.lay ?? "-"}` : ""}${ml.bestVsWorstPct !== null ? ` → best vs worst ${ml.bestVsWorstPct}%` : ""}`);
  for (const s of signals) {
    const d = s.comparison.dispersion[0];
    const alt = s.comparison.lineAlternatives.find((a) => a.better);
    console.log(`   ${s.player} ${s.stat} ${s.side} ${s.line}: ${s.comparison.quotes.map((q) => `${q.book} ${q.decimal}`).join(" | ")}${d ? ` → ${d.book} ${d.pct > 0 ? "+" : ""}${d.pct}% vs median ${d.othersMedian}` : ""}${alt ? ` → line ${alt.line} @ ${alt.decimal} at ${alt.book}` : ""}`);
  }
  (dump.games as unknown[]).push({ ...c, signals, awayMoneyline: ml, prices });
}
if (process.env.BOOKS_DUMP) { fs.writeFileSync(process.env.BOOKS_DUMP, JSON.stringify(dump, null, 1)); console.log(`\nwrote ${process.env.BOOKS_DUMP}`); }
console.log(`\ndone in ${Math.round((Date.now() - started) / 1000)} s`);
