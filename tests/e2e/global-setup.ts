import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { startFakeMercadoPago } from "./fake-mercadopago";
import { writeEspnFixtures } from "./espn-fixtures";
import { etKey } from "./espn-world";

/** The Brasília day of a moment — the same calendar the short list is built on (ledger/proof.ts). */
const brasiliaDayOf = (d: Date) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

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

  // A WNBA game on a fixed Brasília day a few days out, with one ticket that clears every cut of the
  // short list (evidence 100, confidence medium, one leg, 1.38 at 80 %, a market with a canonical
  // name) and two that do not — so /app/hoje has a card to render and a discard pile behind it, and
  // the day is pinned rather than read off the wall clock.
  const HOJE_DAY = brasiliaDayOf(new Date(Date.now() + 3 * 86_400_000));
  // A second slate day, for the state where the wallet is shut. See the calibration seed below.
  const NOTHING_DAY = brasiliaDayOf(new Date(Date.now() + 4 * 86_400_000));
  const hojeStart = new Date(Date.parse(`${HOJE_DAY}T21:00:00-03:00`)).toISOString();
  const pra = (player: string, athleteId: string, line: number, odds: number, selection: string, p: number) => ({
    selection, market: "player prop", odds: String(odds), oddsDecimal: odds, explanation: "e2e", evidence: "e2e", fairProbability: p, athleteId, book: "Betano",
    settlement: { type: "player_prop", player, stat: "PRA", line, side: "over", sourceBasis: "measured history" },
  });
  const hojeSlate = { dataNote: "e2e", suggestions: [
    // The one that should be picked: raw edge 0.80 × 1.38 − 1 = 10.4 %, inside the 4–20 % window.
    // 1.38 at 77.5 %: a 6.9 % raw edge which, with the calibration seeded below, survives cut 8 at
    // 2.4 % shrunk and sizes at 1.50 u — a number the formula produced, not the 2 u ceiling and not
    // the 0.25 u floor. Cut 8 is the binding constraint here rather than the floor, and that is
    // structural: 25·shrunk/(d−1) ≥ 0.25 whenever shrunk ≥ 2 %, so an open wallet can never reach
    // the floor. The floor only ever binds in the measurement regime, which is the day below.
    { id: "hoje-main", kind: "single", bandKey: "safe", title: "Paige Bueckers mais de 24,5 PRA", background: "e2e",
      legs: [pra("Paige Bueckers", "8001", 24.5, 1.38, "Paige Bueckers mais de 24,5 pontos+rebotes+assistências", 0.775)],
      combinedDecimal: 1.38, combinedAmerican: "-263", impliedProbability: 1 / 1.38, modelledProbability: 0.775, edgePct: 6.9,
      riskNote: "e2e", confidence: "medium", evidenceScore: 100, evidenceNotes: ["e2e"] },
    // Discarded by cut 5: 24x is outside 1.30–5.00, and the long band stays generated and visible on /app.
    { id: "hoje-long", kind: "single", bandKey: "long", title: "Bilhete de banda longa", background: "e2e",
      legs: [pra("Hana Melo", "8002", 39.5, 24, "Hana Melo mais de 39,5 PRA", 0.1)],
      combinedDecimal: 24, combinedAmerican: "+2300", impliedProbability: 1 / 24, modelledProbability: 0.1, edgePct: 140,
      riskNote: "e2e", confidence: "medium", evidenceScore: 100, evidenceNotes: ["e2e"] },
    // Discarded by cut 2: evidence below 100.
    { id: "hoje-weak", kind: "single", bandKey: "value", title: "Bilhete sem evidência", background: "e2e",
      legs: [pra("Gabi Reis", "8003", 18.5, 1.9, "Gabi Reis mais de 18,5 PRA", 0.62)],
      combinedDecimal: 1.9, combinedAmerican: "-111", impliedProbability: 1 / 1.9, modelledProbability: 0.62, edgePct: 17.8,
      riskNote: "e2e", confidence: "medium", evidenceScore: 55, evidenceNotes: [] },
  ] };
  db.prepare("INSERT INTO predictions (id,scope,sportKey,gameId,dateKey,lang,matchup,startsAt,payload,generatedAt,costUsd) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
    .run("pred_e2e_hoje", "game", "wnba", "990000103", etKey(new Date(hojeStart)), "pt", "Dallas Wings @ Connecticut Sun", hojeStart, JSON.stringify(hojeSlate), generatedAt, 0);
  fs.writeFileSync(path.join(dir, "hoje-day.json"), JSON.stringify({ day: HOJE_DAY, sportKey: "wnba", gameId: "990000103", nothingDay: NOTHING_DAY }));

  // The same slate one day later, on its own game. Nothing about the ticket is wrong — it clears
  // all ten cuts — but the day is deliberately left uncalibrated (see the seed below), so the
  // policy is in the measurement regime and the formula sizes it at 0.14 u. Under the floor, so no
  // stake: this is the day the owner's "0,25 u numa 1,86" used to be invented on.
  const nothingStart = new Date(Date.parse(`${NOTHING_DAY}T21:00:00-03:00`)).toISOString();
  const nothingSlate = { dataNote: "e2e", suggestions: [
    { id: "nada-main", kind: "single", bandKey: "safe", title: "Arike Ogunbowale mais de 21,5 PRA", background: "e2e",
      legs: [pra("Arike Ogunbowale", "8010", 21.5, 1.38, "Arike Ogunbowale mais de 21,5 pontos+rebotes+assistências", 0.8)],
      combinedDecimal: 1.38, combinedAmerican: "-263", impliedProbability: 1 / 1.38, modelledProbability: 0.8, edgePct: 10.4,
      riskNote: "e2e", confidence: "medium", evidenceScore: 100, evidenceNotes: ["e2e"] },
  ] };
  db.prepare("INSERT INTO predictions (id,scope,sportKey,gameId,dateKey,lang,matchup,startsAt,payload,generatedAt,costUsd) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
    .run("pred_e2e_nada", "game", "wnba", "990000104", etKey(new Date(nothingStart)), "pt", "Dallas Wings @ Las Vegas Aces", nothingStart, JSON.stringify(nothingSlate), generatedAt, 0);

  db.close();
  // The books' prices on the pro game (990000101), written through the real store so the "Abrir na
  // casa" links under its tickets are built by the code that builds them live.
  // The fake world kicks that game off five hours from the run's clock (tests/e2e/espn-world.ts); the
  // seconds between the two clocks sit well inside the matcher's 30-minute window.
  const startsAt = new Date(Date.now() + 5 * 3_600_000).toISOString();
  const b = spawnSync("npx", ["tsx", "tests/e2e/seed-books.mts", startsAt], { env: { ...process.env, DATA_DIR: "data/e2e", AUTH_SECRET: process.env.AUTH_SECRET ?? "e2e-secret-that-is-long-enough-for-the-guard" }, stdio: "pipe", encoding: "utf8" });
  if (b.status !== 0) throw new Error(`seed-books failed: ${b.stderr || b.stdout}`);
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
  // Twelve decided live reads on the game under way, so /prova's live block has a sample to
  // measure: they promised about 90% and landed a third of it, which is the shape the real ledger
  // of 22/09/2026 has — and the block's whole job is to say so out loud.
  const liveAt = new Date(Date.now() - 2 * 3_600_000).toISOString();
  const liveLeg = (selection: string, computed: number, won: boolean) =>
    ({ selection, market: "player_prop", sourceBasis: "measured history", predictedProbability: computed, computedProbability: computed, oddsDecimal: 1.6, outcome: won ? "won" : "lost" });
  const liveEntry = (n: number, period: number, won: boolean) => ({
    id: `990000102:live${period * 10}:mid:e2e-${n}`, gameId: "990000102", sportKey: "wnba", matchup: "Dunas Divers @ Cedro Comets",
    createdAt: liveAt, startsAt: liveAt, settledAt: liveAt, bandKey: "mid", kind: "parlay", title: `Leitura ao vivo ${n}`,
    combinedDecimal: 2.56, modelledProbability: 0.9, evidenceScore: 60, scope: "live", minute: period * 10, period, clockLeft: 4.5,
    outcome: won ? "won" : "lost",
    legs: [liveLeg(`Gabi Reis mais de ${n},5 pontos`, 0.95, won), liveLeg(`Hana Melo mais de ${n},5 rebotes`, 0.93, true)],
  });
  // Four of twelve land where the reads' own chances expected about eleven.
  const liveEntries = [1, 2, 3, 4, 5, 6].map((n) => liveEntry(n, 2, n <= 2)).concat([7, 8, 9, 10, 11, 12].map((n) => liveEntry(n, 3, n <= 8)));
  /*
   * A settled pre-game history big enough and honest enough to CLOSE the calibration, so
   * /app/hoje has a day where the wallet is actually open. Without it every day is a closed day
   * and the screen's whole reason for existing — "which ones, and how much" — is never exercised.
   *
   * The gate wants all three: 300+ settled legs, a bias under 3 points, and σ_p at or under 0.08.
   * 330 legs in three honest buckets deliver 0.15 points of bias and σ_p at its floor.
   *
   * Two dates, doing two different jobs, and both deliberate:
   *
   *   · `startsAt` is in August, BEFORE the published record window, so /prova and the public
   *     ledger never count these and every existing proof assertion keeps its numbers. That the
   *     wallet still sees them is the split this layer is built on: the window governs what is
   *     PUBLISHED, never what the correction and the gate compute with.
   *   · `settledAt` is on NOTHING_DAY, because a day is never part of its own calibration
   *     (leave-one-day-out). So selecting NOTHING_DAY hides this whole history from itself and
   *     lands in the measurement regime, while HOJE_DAY sees all of it and opens the wallet. One
   *     ledger, both states, and the switch is a rule the policy already had.
   */
  const calAt = `${NOTHING_DAY}T12:00:00.000Z`;
  const calEntries = [[0.55, 60], [0.65, 72], [0.75, 82]].flatMap(([p, won], b) =>
    Array.from({ length: 110 }, (_, i) => {
      const hit = i < won;
      return {
        id: `cal-${b}-${i}`, gameId: `9600000${b}`, sportKey: "wnba", matchup: "Storm @ Lynx",
        createdAt: "2026-08-10T00:00:00.000Z", startsAt: `2026-08-${String(10 + b).padStart(2, "0")}T23:00:00.000Z`,
        settledAt: calAt, bandKey: "safe", kind: "single", title: `Calibração ${b}-${i}`,
        combinedDecimal: Number((1 / p + 0.1).toFixed(2)), modelledProbability: p, evidenceScore: 100,
        outcome: hit ? "won" : "lost",
        legs: [{ selection: `Linha de calibração ${b}-${i}`, market: "player_prop", sourceBasis: "measured history",
          settlement: { type: "player_prop", player: `Jogadora ${b}`, stat: "PRA", line: 20.5, side: "over", sourceBasis: "measured history" },
          predictedProbability: p, computedProbability: p, oddsDecimal: Number((1 / p + 0.1).toFixed(2)), outcome: hit ? "won" : "lost" }],
      };
    }));
  fs.writeFileSync(path.join(ledgerDir, "predictions.jsonl"), [...entries, ...liveEntries, ...calEntries].map((e) => JSON.stringify(e)).join("\n") + "\n");

  // Checkout goes to a local fake of the Mercado Pago API for the whole run.
  const fakeMp = await startFakeMercadoPago();
  return async () => { await new Promise((r) => fakeMp.close(r)); };
}
