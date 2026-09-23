/**
 * The history already published still says "perna". The product now calls one selection of a ticket
 * "uma linha", and /prova prints the product's own words beside model-written titles stored months
 * ago — "O jogo inteiro de Dallas, seis pernas" is a real row. This rewrites the noun in the prose
 * the model wrote, and nowhere else: never a field name, never a testid, never an English string.
 *
 * Dry run by default. It prints every change it would make and writes nothing:
 *
 *   DATA_DIR=data pnpm tsx scripts/backfill-linha.mts
 *   DATA_DIR=data pnpm tsx scripts/backfill-linha.mts --apply
 */
import fs from "node:fs";
import path from "node:path";
import { getDb } from "@/lib/server/db";
import type { BetSlate, LedgerEntry } from "@/lib/types";

const APPLY = process.argv.includes("--apply");
const DATA = process.env.DATA_DIR ?? path.join(process.cwd(), "data");
const LEDGER = path.join(DATA, "ledger", "predictions.jsonl");

/** Feminine both ways, so only the noun moves: perna → linha, pernas → linhas, capital kept. */
const rewrite = (s: string): string =>
  s.replace(/\bPernas\b/g, "Linhas").replace(/\bPerna\b/g, "Linha").replace(/\bpernas\b/g, "linhas").replace(/\bperna\b/g, "linha");

const hits = (s: string | undefined): boolean => !!s && /\bpernas?\b/i.test(s);
let changed = 0;
const show = (where: string, before: string, after: string) => {
  changed += 1;
  console.log(`  ${where}\n    - ${before.slice(0, 160)}\n    + ${after.slice(0, 160)}`);
};

// ── The ledger: the prose the model wrote on each entry and each leg.
console.log(`== ledger ${LEDGER}`);
const lines = fs.existsSync(LEDGER) ? fs.readFileSync(LEDGER, "utf8").split("\n").filter((l) => l.trim()) : [];
const entries = lines.map((l) => JSON.parse(l) as LedgerEntry);
for (const e of entries) {
  if (hits(e.title)) { const next = rewrite(e.title); show(`ledger ${e.id} · title`, e.title, next); e.title = next; }
  for (const leg of e.legs) {
    if (hits(leg.selection)) { const next = rewrite(leg.selection); show(`ledger ${e.id} · selection`, leg.selection, next); leg.selection = next; }
  }
}
if (APPLY && lines.length) fs.writeFileSync(LEDGER, entries.map((e) => JSON.stringify(e)).join("\n") + "\n", "utf8");

// ── The stored slates: every string the model writes and the page prints.
const db = getDb();
const PROSE = ["title", "background", "riskNote", "swapReason", "dataNote"] as const;
const rows = db.prepare("SELECT id, lang, payload FROM predictions").all() as { id: string; lang: string; payload: string }[];
console.log(`== predictions (${rows.length} rows)`);
for (const row of rows) {
  if (row.lang !== "pt" || !hits(row.payload)) continue;
  const slate = JSON.parse(row.payload) as BetSlate;
  for (const s of slate.suggestions) {
    for (const key of PROSE) {
      const value = s[key as keyof typeof s];
      if (typeof value === "string" && hits(value)) {
        const next = rewrite(value);
        show(`prediction ${row.id} · ${key}`, value, next);
        (s as unknown as Record<string, string>)[key] = next;
      }
    }
    for (const leg of s.legs) {
      for (const key of ["explanation", "evidence"] as const) {
        if (hits(leg[key])) { const next = rewrite(leg[key]); show(`prediction ${row.id} · leg.${key}`, leg[key], next); leg[key] = next; }
      }
    }
  }
  if (hits(slate.dataNote)) { const next = rewrite(slate.dataNote); show(`prediction ${row.id} · dataNote`, slate.dataNote, next); slate.dataNote = next; }
  if (APPLY) db.prepare("UPDATE predictions SET payload=? WHERE id=?").run(JSON.stringify(slate), row.id);
}

// ── The bankroll titles the scan route wrote ("Print · 3 pernas").
const bank = db.prepare("SELECT id, title FROM bankroll_entries WHERE title LIKE '%perna%'").all() as { id: string; title: string }[];
console.log(`== bankroll (${bank.length} rows)`);
for (const b of bank) {
  const next = rewrite(b.title);
  show(`bankroll ${b.id} · title`, b.title, next);
  if (APPLY) db.prepare("UPDATE bankroll_entries SET title=? WHERE id=?").run(next, b.id);
}

console.log(`\n${changed} ${changed === 1 ? "string" : "strings"} ${APPLY ? "reescritas" : "a reescrever (dry run: nada foi gravado — rode com --apply)"}.`);
