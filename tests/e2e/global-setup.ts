import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { startFakeMercadoPago } from "./fake-mercadopago";
import { writeEspnFixtures } from "./espn-fixtures";
import { etKey } from "./espn-world";

// Fresh database, then the real seed script writes the slate the specs read.
export default async function globalSetup() {
  const dir = path.join(process.cwd(), "data", "e2e");
  fs.rmSync(dir, { recursive: true, force: true });
  // The fake ESPN the dev server replays (ESPN_FIXTURES), with times relative to now.
  writeEspnFixtures(path.join(dir, "espn-fixtures"));
  const r = spawnSync("npx", ["tsx", "scripts/seed-sev-val.mts"], { env: { ...process.env, DATA_DIR: "data/e2e", ADMIN_EMAIL: "admin@betmatic.app", ADMIN_PASSWORD: "betmatic2026" }, stdio: "pipe", encoding: "utf8" });
  if (r.status !== 0) throw new Error(`seed failed: ${r.stderr}`);
  // The seed is "overnight" inventory: the free plan reads tickets on a two-hour delay, so a
  // just-written row would be invisible to free accounts in the specs.
  const Database = (await import("better-sqlite3")).default;
  const db = new Database(path.join(dir, "betmatic.db"));
  const generatedAt = new Date(Date.now() - 3 * 3_600_000).toISOString();
  db.prepare("UPDATE predictions SET generatedAt = ?").run(generatedAt);
  // A game on today's slate (ESPN knows nothing about it) so the sitemap and the public game page
  // have an upcoming fixture to list and to render from the stored slate alone.
  const todayKey = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()).replace(/-/g, "");
  const src = db.prepare("SELECT payload FROM predictions WHERE gameId = '401882878' AND lang = 'pt'").get() as { payload: string };
  db.prepare("INSERT INTO predictions (id,scope,sportKey,gameId,dateKey,lang,matchup,startsAt,payload,generatedAt,costUsd) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
    .run("pred_e2e_today", "game", "soccer-esp", "990000001", todayKey, "pt", "Girona @ Betis", new Date(Date.now() + 3 * 3_600_000).toISOString(), src.payload, generatedAt, 0);
  // Tickets on the WNBA game under way (990000102), so the live panel has legs to follow.
  const liveStart = new Date(Date.now() - 1.5 * 3_600_000);
  const prop = (player: string, athleteId: string, stat: string, line: number, side: "over" | "under", selection: string, odds: number) => ({
    selection, market: "player prop", odds: String(odds), oddsDecimal: odds, explanation: "e2e", evidence: "e2e", fairProbability: 0.55, athleteId,
    settlement: { type: "player_prop", player, stat, line, side, sourceBasis: "measured history" },
  });
  const ticket = (id: string, bandKey: string, title: string, legs: unknown[], odds: number, p: number) => ({
    id, kind: legs.length > 1 ? "parlay" : "single", bandKey, title, background: "e2e", legs, combinedDecimal: odds, combinedAmerican: "+100",
    impliedProbability: 1 / odds, modelledProbability: p, edgePct: 1, riskNote: "e2e", confidence: "medium", evidenceScore: 60, evidenceNotes: [],
  });
  const liveSlate = { dataNote: "e2e", suggestions: [
    ticket("live-a", "value", "Dupla que já bateu", [prop("Gabi Reis", "7301", "points", 12.5, "over", "Gabi Reis mais de 12,5 pontos", 1.8), prop("Hana Melo", "7401", "rebounds", 7.5, "over", "Hana Melo mais de 7,5 rebotes", 1.9)], 3.42, 0.3),
    ticket("live-b", "mid", "Gabi decide", [prop("Gabi Reis", "7301", "points", 22.5, "over", "Gabi Reis mais de 22,5 pontos", 2.6), { selection: "Cedro Comets vence", market: "moneyline", odds: "-120", oddsDecimal: 1.83, explanation: "e2e", evidence: "e2e", fairProbability: 0.52, settlement: { type: "moneyline", teamAbbreviation: "CED", side: "home", sourceBasis: "book line" } }], 4.76, 0.18),
    ticket("live-c", "value", "Hana abaixo", [prop("Hana Melo", "7401", "rebounds", 5.5, "under", "Hana Melo menos de 5,5 rebotes", 2.1)], 2.1, 0.45),
  ] };
  db.prepare("INSERT INTO predictions (id,scope,sportKey,gameId,dateKey,lang,matchup,startsAt,payload,generatedAt,costUsd) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
    .run("pred_e2e_live", "game", "wnba", "990000102", etKey(liveStart), "pt", "Dunas Divers @ Cedro Comets", liveStart.toISOString(), JSON.stringify(liveSlate), generatedAt, 0);
  db.close();
  // A small settled ledger so the public track record, permalinks and the bankroll have data.
  const ledgerDir = path.join(dir, "ledger");
  fs.mkdirSync(ledgerDir, { recursive: true });
  const leg = (selection: string, outcome: string, odds: number) => ({ selection, market: "total", sourceBasis: "book line", predictedProbability: 0.55, oddsDecimal: odds, outcome });
  const entries = [
    { id: "401882878:value:Sevilha FC vence", gameId: "401882878", sportKey: "soccer-esp", matchup: "Valencia @ Sevilla", createdAt: "2026-09-11T10:00:00.000Z", startsAt: "2026-09-11T19:00:00.000Z", settledAt: "2026-09-11T20:00:00.000Z", bandKey: "value", kind: "single", title: "Sevilha vence em casa", combinedDecimal: 2.0, modelledProbability: 0.51, evidenceScore: 78, outcome: "won", legs: [leg("Sevilha FC vence", "won", 2.0)] },
    { id: "401882878:mid:Mais de 2,5 gols|Ambas marcam", gameId: "401882878", sportKey: "soccer-esp", matchup: "Valencia @ Sevilla", createdAt: "2026-09-11T10:00:00.000Z", startsAt: "2026-09-11T19:00:00.000Z", settledAt: "2026-09-11T20:00:00.000Z", bandKey: "mid", kind: "parlay", title: "Jogo aberto", combinedDecimal: 4.6, modelledProbability: 0.22, evidenceScore: 52, outcome: "lost", legs: [{ ...leg("Mais de 2,5 gols", "lost", 2.3), actual: "total 2 vs line 2.5" }, { ...leg("Ambas marcam", "won", 2.0), actual: "both scored" }] },
    // Pending tickets: a legacy row with no kickoff time and one whose game is still ahead stay private;
    // one whose game is under way is public.
    { id: "401882878:safe:Sevilha ou empate", gameId: "401882878", sportKey: "soccer-esp", matchup: "Valencia @ Sevilla", createdAt: "2026-09-11T10:00:00.000Z", bandKey: "safe", kind: "single", title: "Sevilha não perde", combinedDecimal: 1.26, modelledProbability: 0.77, evidenceScore: 85, outcome: "pending", legs: [leg("Sevilha ou empate", "pending", 1.26)] },
    { id: "990000001:value:Betis vence|Mais de 1,5 gols", gameId: "990000001", sportKey: "soccer-esp", matchup: "Girona @ Betis", createdAt: new Date().toISOString(), startsAt: new Date(Date.now() + 3 * 3_600_000).toISOString(), bandKey: "value", kind: "parlay", title: "Betis em casa com gols", combinedDecimal: 2.4, modelledProbability: 0.45, evidenceScore: 70, outcome: "pending", legs: [leg("Betis vence", "pending", 1.8), leg("Mais de 1,5 gols", "pending", 1.33)] },
    { id: "401882878:long:Sevilha vence de virada", gameId: "401882878", sportKey: "soccer-esp", matchup: "Valencia @ Sevilla", createdAt: "2026-09-11T10:00:00.000Z", startsAt: "2026-09-11T19:00:00.000Z", bandKey: "long", kind: "single", title: "Virada do Sevilha", combinedDecimal: 21, modelledProbability: 0.05, evidenceScore: 30, outcome: "pending", legs: [leg("Sevilha vence de virada", "pending", 21)] },
  ];
  fs.writeFileSync(path.join(ledgerDir, "predictions.jsonl"), entries.map((e) => JSON.stringify(e)).join("\n") + "\n");

  // Checkout goes to a local fake of the Mercado Pago API for the whole run.
  const fakeMp = await startFakeMercadoPago();
  return async () => { await new Promise((r) => fakeMp.close(r)); };
}
