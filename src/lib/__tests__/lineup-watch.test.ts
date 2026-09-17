import { beforeAll, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

const DIR = path.join(process.cwd(), "data", "unit-lineups");
process.env.DATA_DIR = DIR;
process.env.AUTH_SECRET = "test-secret-that-is-long-enough";
process.env.TELEGRAM_BOT_TOKEN = "";
fs.rmSync(DIR, { recursive: true, force: true });

const HOUR = 3_600_000;
const kickoff = new Date(Date.now() + HOUR).toISOString();
const summary = {
  rosters: [
    { team: { abbreviation: "TUP" }, roster: [
      { starter: true, athlete: { displayName: "Rafa Moura" } },
      { starter: false, athlete: { displayName: "Téo Lins" } },
    ] },
    { team: { abbreviation: "IPE" }, roster: [{ starter: true, athlete: { displayName: "Vini Rocha" } }] },
  ],
};
vi.mock("@/lib/sources/espn-http", async (orig) => ({
  ...(await orig<typeof import("@/lib/sources/espn-http")>()),
  espnJson: async () => summary,
}));
vi.mock("@/lib/sources/espn", async (orig) => ({
  ...(await orig<typeof import("@/lib/sources/espn")>()),
  getGameDetail: async (id: string) => ({
    game: { id, sportKey: "soccer-bra", startsAt: kickoff, status: "scheduled", home: { id: "h", abbreviation: "TUP", displayName: "Tupi FC" }, away: { id: "a", abbreviation: "IPE", displayName: "Ipê EC" } },
    injuries: [], leaders: [{ teamAbbreviation: "IPE", player: "Wil Braga", line: "" }], books: [], rosters: [],
  }),
}));

const { diffLineup, lineupSnapshot, lineupAlertText } = await import("@/lib/live/lineup");
const { runLineupWatch } = await import("@/lib/server/lineups");
const { getDb } = await import("@/lib/server/db");

const prop = (player: string, stat = "shots") => ({ type: "player_prop" as const, player, stat, line: 1.5, side: "over" as const, sourceBasis: "" });

describe("lineup diff", () => {
  const snap = lineupSnapshot(summary, [{ player: "Ana Lima", status: "Out" }, { player: "Bia Souza", status: "Doubtful" }], [{ teamAbbreviation: "IPE", player: "Wil Braga" }]);
  it("marks a benched player, one left out of the squad, and a key absence on a team leg", () => {
    const out = diffLineup([
      { ledgerId: "t1", legIndex: 0, selection: "Rafa 2+ finalizações", settlement: prop("Rafa Moura") },
      { ledgerId: "t1", legIndex: 1, selection: "Téo 2+ finalizações", settlement: prop("Téo Lins") },
      { ledgerId: "t2", legIndex: 0, selection: "Zé 1+ finalização", settlement: prop("Zé Ninguém") },
      { ledgerId: "t3", legIndex: 0, selection: "Ipê vence", settlement: { type: "moneyline", teamAbbreviation: "IPE", sourceBasis: "" } },
    ], snap);
    expect(out.map((a) => [a.ledgerId, a.legIndex, a.kind, a.player])).toEqual([
      ["t1", 1, "bench", "Téo Lins"],
      ["t2", 0, "out", "Zé Ninguém"],
      ["t3", 0, "key_absence", "Wil Braga"],
    ]);
  });

  it("reads injury status changes when no lineup is published (basketball)", () => {
    const bb = lineupSnapshot({}, [{ player: "Ana Lima", status: "Out" }, { player: "Bia Souza", status: "Doubtful" }, { player: "Cris Rocha", status: "Day-To-Day" }], []);
    const out = diffLineup(["Ana Lima", "Bia Souza", "Cris Rocha"].map((p, i) => ({ ledgerId: "b", legIndex: i, selection: p, settlement: prop(p, "points") })), bb);
    expect(out.map((a) => a.kind)).toEqual(["out", "doubt"]);
  });

  it("writes informational copy, never a call to bet", () => {
    const t = lineupAlertText({ kind: "bench", player: "Téo Lins" }, "Téo 2+ finalizações", "Ipê EC @ Tupi FC", "pt");
    expect(t.body).toContain("Téo Lins começa no banco");
    expect(t.body).not.toMatch(/aposte agora|corra|última chance/i);
  });
});

describe("lineup job", () => {
  beforeAll(() => {
    const db = getDb();
    const user = (id: string) => db.prepare("INSERT INTO users (id,email,name,passwordHash,role,planId,planPeriod,coins,lang,createdAt) VALUES (?,?,?,?,?,?,?,?,?,?)").run(id, `${id}@example.com`, id, "x", "user", "free", "monthly", 0, "pt", new Date().toISOString());
    user("saver"); user("paused"); user("stranger"); user("othersaver"); user("fan");
    db.prepare("UPDATE users SET planId='pro', planExpiresAt=? WHERE id='fan'").run(new Date(Date.now() + 30 * 24 * HOUR).toISOString());
    // stranger (free) and fan (Pro) follow the league; only fan's plan shows the affected ticket
    for (const u of ["stranger", "fan"]) db.prepare("INSERT INTO follows (userId, kind, sportKey, key, label, createdAt) VALUES (?,?,?,?,?,?)").run(u, "league", "soccer-bra", "soccer-bra", "", new Date().toISOString());
    const suggestion = { id: "s-1", kind: "single", bandKey: "value", title: "Téo finaliza", background: "", legs: [{ selection: "Téo 2+ finalizações", market: "player_prop", odds: "2.10", oddsDecimal: 2.1, book: "", explanation: "", evidence: "", fairProbability: 0.45 }],
      combinedDecimal: 2.1, combinedAmerican: "+110", impliedProbability: 0.47, modelledProbability: 0.45, edgePct: 0, riskNote: "", confidence: "medium", evidenceScore: 60, evidenceNotes: [] };
    db.prepare("INSERT INTO predictions (id, scope, sportKey, gameId, dateKey, lang, matchup, startsAt, payload, generatedAt, costUsd) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
      .run("p-501", "game", "soccer-bra", "501", "20260917", "pt", "Ipê EC @ Tupi FC", kickoff, JSON.stringify({ suggestions: [suggestion], dataNote: "" }), new Date().toISOString(), 0);
    const ledgerDir = path.join(DIR, "ledger");
    fs.mkdirSync(ledgerDir, { recursive: true });
    const entry = { id: "501:value:Téo 2+ finalizações", gameId: "501", sportKey: "soccer-bra", matchup: "Ipê EC @ Tupi FC", createdAt: new Date().toISOString(), startsAt: kickoff, bandKey: "value", kind: "single", title: "Téo finaliza", combinedDecimal: 2.1, modelledProbability: 0.45, suggestionId: "s-1", outcome: "pending",
      legs: [{ selection: "Téo 2+ finalizações", market: "player_prop", sourceBasis: "x", settlement: prop("Téo Lins"), predictedProbability: 0.45, oddsDecimal: 2.1, outcome: "pending" }] };
    const later = { ...entry, id: "502:value:x", gameId: "502", startsAt: new Date(Date.now() + 5 * HOUR).toISOString() };
    // another ticket on the same game whose legs are untouched: its saver hears nothing
    const untouched = { ...entry, id: "501:safe:Rafa", suggestionId: "s-2", legs: [{ ...entry.legs[0], selection: "Rafa 1+ finalização", settlement: prop("Rafa Moura") }] };
    fs.writeFileSync(path.join(ledgerDir, "predictions.jsonl"), `${JSON.stringify(entry)}\n${JSON.stringify(later)}\n${JSON.stringify(untouched)}\n`);
    db.prepare("INSERT INTO bankroll_entries (id,userId,source,ledgerId,title,combinedDecimal,stake,createdAt) VALUES (?,?,?,?,?,?,?,?)").run("be-other", "othersaver", "ticket", untouched.id, "t", 1.5, 10, new Date().toISOString());
    for (const u of ["saver", "paused"]) db.prepare("INSERT INTO bankroll_entries (id,userId,source,ledgerId,title,combinedDecimal,stake,createdAt) VALUES (?,?,?,?,?,?,?,?)").run(`be-${u}`, u, "ticket", entry.id, "t", 2.1, 10, new Date().toISOString());
    db.prepare("INSERT INTO user_settings (userId, pausedUntil, pausedAt, updatedAt) VALUES (?,?,?,?)").run("paused", new Date(Date.now() + 7 * 24 * HOUR).toISOString(), new Date().toISOString(), new Date().toISOString());
  });

  it("alerts each saver once, skips paused users and games outside the window, and is idempotent", async () => {
    const first = await runLineupWatch();
    expect(first).toMatchObject({ games: 1, alerts: 1, notified: 3 });
    const db = getDb();
    expect(db.prepare("SELECT ledgerId, kind, suggestionId FROM leg_alerts").all()).toEqual([{ ledgerId: "501:value:Téo 2+ finalizações", kind: "bench", suggestionId: "s-1" }]);
    const logs = db.prepare("SELECT userId, kind, channel, body FROM alert_log ORDER BY userId").all() as { userId: string; body: string }[];
    expect(logs.map((l) => l.userId)).toEqual(["fan", "saver", "stranger"]);
    // the saver and the Pro follower read the leg; the free follower learns the lineup moved, no player, no pick
    expect(logs[0].body).toContain("Téo 2+ finalizações");
    expect(logs[1].body).toContain("Téo 2+ finalizações");
    expect(logs[2].body).toContain("mudou");
    expect(logs[2].body).not.toMatch(/Téo|finaliza/);
    const again = await runLineupWatch();
    expect(again).toMatchObject({ alerts: 0, notified: 0 });
    expect((db.prepare("SELECT COUNT(*) n FROM alert_log").get() as { n: number }).n).toBe(3);
    const { listBankroll } = await import("@/lib/server/bankroll");
    expect(listBankroll("saver").entries[0].alerts).toEqual([{ kind: "bench", player: "Téo Lins" }]);
  });
});
