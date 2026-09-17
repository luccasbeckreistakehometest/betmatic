import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

// Fresh database, then the real seed script writes the slate the specs read.
export default async function globalSetup() {
  const dir = path.join(process.cwd(), "data", "e2e");
  fs.rmSync(dir, { recursive: true, force: true });
  const r = spawnSync("npx", ["tsx", "scripts/seed-sev-val.mts"], { env: { ...process.env, DATA_DIR: "data/e2e", ADMIN_EMAIL: "admin@betmatic.app", ADMIN_PASSWORD: "betmatic2026" }, stdio: "pipe", encoding: "utf8" });
  if (r.status !== 0) throw new Error(`seed failed: ${r.stderr}`);
  // The seed is "overnight" inventory: the free plan reads tickets on a two-hour delay, so a
  // just-written row would be invisible to free accounts in the specs.
  const Database = (await import("better-sqlite3")).default;
  const db = new Database(path.join(dir, "betmatic.db"));
  db.prepare("UPDATE predictions SET generatedAt = ?").run(new Date(Date.now() - 3 * 3_600_000).toISOString());
  db.close();
  // A small settled ledger so the public track record, permalinks and the bankroll have data.
  const ledgerDir = path.join(dir, "ledger");
  fs.mkdirSync(ledgerDir, { recursive: true });
  const leg = (selection: string, outcome: string, odds: number) => ({ selection, market: "total", sourceBasis: "book line", predictedProbability: 0.55, oddsDecimal: odds, outcome });
  const entries = [
    { id: "401882878:value:Sevilha FC vence", gameId: "401882878", sportKey: "soccer-esp", matchup: "Valencia @ Sevilla", createdAt: "2026-09-11T10:00:00.000Z", settledAt: "2026-09-11T20:00:00.000Z", bandKey: "value", kind: "single", title: "Sevilha vence em casa", combinedDecimal: 2.0, modelledProbability: 0.51, outcome: "won", legs: [leg("Sevilha FC vence", "won", 2.0)] },
    { id: "401882878:mid:Mais de 2,5 gols|Ambas marcam", gameId: "401882878", sportKey: "soccer-esp", matchup: "Valencia @ Sevilla", createdAt: "2026-09-11T10:00:00.000Z", settledAt: "2026-09-11T20:00:00.000Z", bandKey: "mid", kind: "parlay", title: "Jogo aberto", combinedDecimal: 4.6, modelledProbability: 0.22, outcome: "lost", legs: [leg("Mais de 2,5 gols", "lost", 2.3), leg("Ambas marcam", "won", 2.0)] },
    { id: "401882878:safe:Sevilha ou empate", gameId: "401882878", sportKey: "soccer-esp", matchup: "Valencia @ Sevilla", createdAt: "2026-09-11T10:00:00.000Z", bandKey: "safe", kind: "single", title: "Sevilha não perde", combinedDecimal: 1.26, modelledProbability: 0.77, outcome: "pending", legs: [leg("Sevilha ou empate", "pending", 1.26)] },
  ];
  fs.writeFileSync(path.join(ledgerDir, "predictions.jsonl"), entries.map((e) => JSON.stringify(e)).join("\n") + "\n");
}
