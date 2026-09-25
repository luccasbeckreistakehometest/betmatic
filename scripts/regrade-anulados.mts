/**
 * Re-grades tickets written off as "não é possível medir" while ESPN in fact had the gamelog.
 *
 * The cause is in ledger/settle.ts: the gamelog cache lives six hours and the settlement grace is
 * also six hours from tip-off, so a ticket built close to kickoff settles against a log fetched
 * BEFORE the game, never finds the event, and is voided minutes before the cache would refresh. On
 * 24/09/2026 that cost 84 of 133 tickets. The settler now retries past the cache; this script is for
 * the ones already on disk.
 *
 *   DRY RUN:  pnpm tsx scripts/regrade-anulados.mts
 *   APPLY:    pnpm tsx scripts/regrade-anulados.mts --apply
 *
 * Only ever touches legs whose `actual` is exactly "não é possível medir", and only when a forced
 * read actually finds the game. A leg ESPN still cannot serve is left voided: this corrects a
 * measurement failure, it does not invent outcomes. The file is backed up before a write.
 */
import fs from "node:fs";
import path from "node:path";
import { getPlayerHistory } from "@/lib/sources/espn";
import { matchAthlete, resolveStatLabels, statTotal } from "@/lib/props/history";
import type { LedgerEntry, SettledLeg } from "@/lib/types";

const APPLY = process.argv.includes("--apply");
const FILE = path.join(process.env.DATA_DIR ?? path.join(process.cwd(), "data"), "ledger", "predictions.jsonl");
const UNMEASURABLE = "não é possível medir";

const grade = (value: number, line: number, side: string) =>
  value === line ? "push" : (side === "under" ? value < line : value > line) ? "won" : "lost";

/** A ticket is won only if every leg won; one lost leg loses it; anything undecided holds it. */
function ticketOutcome(legs: SettledLeg[]): LedgerEntry["outcome"] {
  if (legs.some((l) => l.outcome === "lost")) return "lost";
  if (legs.some((l) => l.outcome === "pending")) return "pending";
  const decided = legs.filter((l) => l.outcome === "won" || l.outcome === "push");
  if (!decided.length) return "void";
  return legs.every((l) => l.outcome === "void") ? "void" : "won";
}

const entries: LedgerEntry[] = fs.readFileSync(FILE, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
const logs = new Map<string, Awaited<ReturnType<typeof getPlayerHistory>>>();

let touchedLegs = 0, touchedTickets = 0, stillUnmeasurable = 0;
const changes: string[] = [];

for (const entry of entries) {
  if (entry.outcome !== "void") continue;
  let changed = false;

  for (const leg of entry.legs as SettledLeg[]) {
    if (leg.outcome !== "void" || leg.actual !== UNMEASURABLE) continue;
    const s = leg.settlement;
    if (!s || s.type !== "player_prop" || !s.player || s.line === undefined) continue;
    const labels = resolveStatLabels(s.stat ?? "", entry.sportKey);
    if (!labels) { stillUnmeasurable += 1; continue; }

    // The athlete id stored on the leg is the one the pipeline already resolved; fall back to the
    // name only when it is missing, so a re-grade never picks a different player than the build did.
    const athleteId = leg.athleteId ?? matchAthlete(s.player, [])?.id;
    if (!athleteId) { stillUnmeasurable += 1; continue; }

    const key = `${entry.sportKey}:${athleteId}`;
    if (!logs.has(key)) logs.set(key, await getPlayerHistory(entry.sportKey, athleteId, true).catch(() => null));
    const played = logs.get(key)?.games.find((g) => g.eventId === entry.gameId);
    if (!played) { stillUnmeasurable += 1; continue; }

    const value = statTotal(played, labels);
    if (!Number.isFinite(value)) { stillUnmeasurable += 1; continue; }

    const outcome = grade(value, s.line, s.side ?? "over");
    changes.push(`${entry.matchup} · ${leg.selection} → ${outcome} (${labels.join("+")} ${value} vs ${s.line})`);
    leg.outcome = outcome as SettledLeg["outcome"];
    leg.actual = `${labels.join("+")} ${value} vs ${s.line}`;
    touchedLegs += 1;
    changed = true;
  }

  if (changed) {
    entry.outcome = ticketOutcome(entry.legs as SettledLeg[]);
    touchedTickets += 1;
  }
}

console.log(`${APPLY ? "APLICANDO" : "SIMULAÇÃO (use --apply para gravar)"}`);
console.log(`bilhetes no ledger: ${entries.length}`);
console.log(`pernas recuperadas: ${touchedLegs} · bilhetes reprocessados: ${touchedTickets}`);
console.log(`pernas que seguem sem medição: ${stillUnmeasurable}`);
console.log();
for (const c of changes.slice(0, 40)) console.log("  " + c);
if (changes.length > 40) console.log(`  … e mais ${changes.length - 40}`);

if (!APPLY) { console.log("\nnada foi gravado."); process.exit(0); }
if (!touchedLegs) { console.log("\nnada a gravar."); process.exit(0); }

const backup = `${FILE}.bak-regrade-${Date.now()}`;
fs.copyFileSync(FILE, backup);
fs.writeFileSync(FILE, entries.map((e) => JSON.stringify(e)).join("\n") + "\n");
console.log(`\ngravado. backup em ${backup}`);
