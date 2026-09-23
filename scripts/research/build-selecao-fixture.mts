/**
 * Regenerates `src/lib/__tests__/fixtures/selecao-3-noites.json` — the pre-game candidates the
 * selection policy's regression suite runs on — from a copy of the production ledger.
 *
 * This exists because the fixture had no generator for its first two lives, and a fixture nobody
 * can rebuild is a debt: the ledger was re-graded on 23/09 (the settle vocabulary could not read
 * PTS+AST, REB+AST or PTS+REB, so 57 settled linhas had been filed as unmeasurable) and 29 of the
 * 123 outcomes moved, four of them from void to a WIN. Without this script the next re-grade is
 * somebody guessing.
 *
 *   pnpm tsx scripts/research/build-selecao-fixture.mts \
 *     --ledger src/lib/__tests__/fixtures/ledger-prod-20260923.jsonl
 *
 *   # writing nothing, just reporting what would change:
 *   pnpm tsx scripts/research/build-selecao-fixture.mts --ledger <file> --dry
 *
 * ## The one field the ledger does not carry
 *
 * `confidence` lives on the served BetSuggestion, in the `predictions` table, and never reaches the
 * ledger. It is not cosmetic — it is cut 3, and it removes 70 of these 123 tickets — so the script
 * refuses to invent it:
 *
 *   · with `--db <path>` it comes from `predictions.payload`, matched on the suggestion id, and
 *     the carry-forward is switched OFF. A ticket the database cannot answer for is listed by name
 *     and the run fails. Falling back quietly would mean a fixture that still depends on its own
 *     previous version to exist, which is the debt this script exists to clear;
 *   · `--carry-forward-missing` re-enables it for exactly those named leftovers, printing every
 *     one. It exists because `predictions` keeps only the LATEST slate per game and language: game
 *     401857209 was regenerated at 23:57 on 22/09, after twelve of its tickets had already been
 *     served and written to the ledger, so their suggestion ids are gone from the database and
 *     matching on ticket identity (game, band, selections) does not find them either. Those twelve
 *     values are not invented — they are the real served ones, carried from the previous fixture —
 *     but they can no longer be re-verified against production, and dropping the tickets instead
 *     would silently change every measurement the suite makes. The flag is the honest middle: you
 *     have to type it, and it tells you what it did;
 *   · without `--db` at all it carries everything forward, and says so.
 *
 * Everything else is derived from the ledger, so a re-grade only ever moves outcomes.
 */
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { brasiliaDay } from "@/lib/ledger/proof";
import { canonicalMarket } from "@/lib/ledger/stat-key";
import type { BetSlate, LedgerEntry } from "@/lib/types";

const arg = (flag: string): string | undefined => {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const DRY = process.argv.includes("--dry");
const OUT = path.join(process.cwd(), "src/lib/__tests__/fixtures/selecao-3-noites.json");
const LEDGER = arg("--ledger");
if (!LEDGER) {
  console.error("usage: build-selecao-fixture.mts --ledger <ledger.jsonl> [--db <betmatic.db>] [--carry-forward-missing] [--dry]");
  process.exit(1);
}

/** The shape the suite reads: a `Candidate` plus the day it belongs to and how it settled. */
interface FixtureRow {
  ledgerId: string;
  suggestionId: string;
  gameId: string;
  sportKey: string;
  scope: "pre" | "live";
  bandKey: string;
  decimal: number;
  modelProbability: number;
  legs: number;
  players: string[];
  markets: string[];
  evidenceScore: number;
  confidence: "high" | "medium" | "low";
  startsAt: string;
  day: string;
  outcome: string;
  alternativeOf?: string;
}

const entries = fs.readFileSync(LEDGER, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as LedgerEntry);
// Pre-game only. A live read is a different population with its own fixture and its own measure.
const pre = entries.filter((e) => e.scope !== "live");

/** `confidence` by suggestion id, from a `predictions` copy when one is given. */
function confidenceFromDb(file: string): Map<string, string> {
  const out = new Map<string, string>();
  const db = new Database(file, { readonly: true });
  for (const row of db.prepare("SELECT payload FROM predictions").all() as { payload: string }[]) {
    let slate: BetSlate;
    try { slate = JSON.parse(row.payload) as BetSlate; } catch { continue; }
    for (const s of slate.suggestions ?? []) if (s.id && s.confidence) out.set(s.id, s.confidence);
  }
  db.close();
  return out;
}

/** `confidence` by ledger id, carried forward from the fixture already on disk. */
function confidenceFromFixture(): Map<string, string> {
  if (!fs.existsSync(OUT)) return new Map();
  const rows = JSON.parse(fs.readFileSync(OUT, "utf8")) as FixtureRow[];
  return new Map(rows.map((r) => [r.ledgerId, r.confidence]));
}

const dbFile = arg("--db");
const CARRY = process.argv.includes("--carry-forward-missing");
// With a database in hand the carry-forward is not a safety net, it is a way to keep an old value
// alive without noticing. It comes back only when asked for by name, and never quietly.
const bySuggestion = dbFile ? confidenceFromDb(dbFile) : new Map<string, string>();
const byLedgerId = !dbFile || CARRY ? confidenceFromFixture() : new Map<string, string>();
console.log(dbFile
  ? `confidence: from ${path.relative(process.cwd(), dbFile)} (${bySuggestion.size} suggestion ids)${CARRY ? ", carry-forward allowed for what it cannot answer" : ", carry-forward off"}`
  : "confidence: CARRIED FORWARD from the fixture on disk — pass --db <betmatic.db> for a real rebuild");

const rows: FixtureRow[] = [];
const unresolved: string[] = [];
const carried: string[] = [];
for (const e of pre) {
  const fromDb = bySuggestion.get(e.suggestionId ?? "");
  const confidence = fromDb ?? byLedgerId.get(e.id);
  if (!confidence) { unresolved.push(e.id); continue; }
  if (!fromDb && dbFile) carried.push(e.id);
  rows.push({
    ledgerId: e.id,
    suggestionId: e.suggestionId ?? "",
    gameId: e.gameId,
    sportKey: e.sportKey,
    scope: "pre",
    bandKey: e.bandKey,
    decimal: e.combinedDecimal,
    modelProbability: e.modelledProbability,
    legs: e.legs.length,
    // The concentration rule counts appearances of a player, so a leg with no named player
    // contributes nothing rather than an empty string that would collide with every other one.
    players: [...new Set(e.legs.map((l) => l.settlement?.player).filter((p): p is string => !!p))],
    // Canonical keys, because that is what cut 9 reads. An unmapped market stays "unmapped" and the
    // policy refuses it — dropping it here would hide exactly the case the cut exists for.
    markets: e.legs.map((l) => canonicalMarket(l, e.sportKey) ?? "unmapped"),
    evidenceScore: e.evidenceScore ?? 0,
    confidence: confidence as FixtureRow["confidence"],
    startsAt: e.startsAt ?? "",
    day: brasiliaDay(e.startsAt ?? e.createdAt),
    outcome: e.outcome,
    ...(e.alternativeOf ? { alternativeOf: e.alternativeOf } : {}),
  });
}

if (unresolved.length) {
  console.error(`\n${unresolved.length} ticket(s) with no confidence, and it is cut 3 so none of them may be guessed:`);
  for (const id of unresolved.slice(0, 20)) console.error(`  ${id}`);
  console.error(dbFile
    ? "\nThat database does not hold the slate that served them. Nothing was written."
    : "\nPass --db <betmatic.db> with the predictions table that served them.");
  process.exit(1);
}

if (carried.length) {
  console.log(`\n${carried.length} ticket(s) the database could not answer for, carried forward by name:`);
  for (const id of carried) console.log(`  ${id.slice(0, 96)}`);
}

rows.sort((a, b) => a.day.localeCompare(b.day) || a.ledgerId.localeCompare(b.ledgerId));

const before = fs.existsSync(OUT) ? (JSON.parse(fs.readFileSync(OUT, "utf8")) as FixtureRow[]) : [];
const was = new Map(before.map((r) => [r.ledgerId, r.outcome]));
const moved = rows.filter((r) => was.has(r.ledgerId) && was.get(r.ledgerId) !== r.outcome);
const days = [...new Set(rows.map((r) => r.day))].sort();
const settled = rows.filter((r) => r.outcome === "won" || r.outcome === "lost");

console.log(`${rows.length} pre-game tickets over ${days.length} nights (${days.join(", ")})`);
console.log(`${settled.length} decided, ${settled.filter((r) => r.outcome === "won").length} green`);
console.log(`${moved.length} outcome(s) moved since the fixture on disk`);
for (const r of moved.slice(0, 40)) console.log(`  ${was.get(r.ledgerId)} -> ${r.outcome}  ${r.ledgerId.slice(0, 72)}`);

if (DRY) { console.log("\n--dry: nothing written"); process.exit(0); }
fs.writeFileSync(OUT, `${JSON.stringify(rows, null, 2)}\n`, "utf8");
console.log(`\nwrote ${path.relative(process.cwd(), OUT)}`);
