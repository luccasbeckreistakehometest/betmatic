import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const DIR = path.join(process.cwd(), "data", "unit-player");
process.env.DATA_DIR = DIR;
process.env.AUTH_SECRET = "test-secret-that-is-long-enough";
process.env.AI_MOCK = "1";
fs.rmSync(DIR, { recursive: true, force: true });

const { claimPlayer, canSeePlayer, releasePlayer } = await import("@/lib/server/player-access");
const { storedRead, writePlayerRead, readPrompt } = await import("@/lib/server/player-read");
const { defaultLineFor, lineRange } = await import("@/lib/props/player-view");
const { getPlan } = await import("@/lib/plans");
const { getDb } = await import("@/lib/server/db");

const user = (id: string, planId: string) => ({ id, role: "user" as const, plan: getPlan(planId) });
const seedUser = (id: string) => getDb().prepare("INSERT OR IGNORE INTO users (id,email,name,passwordHash,role,planId,planPeriod,coins,lang,createdAt) VALUES (?,?,?,?,?,?,?,?,?,?)").run(id, `${id}@example.com`, id, "x", "user", "free", "monthly", 0, "pt", new Date().toISOString());

const game = (pts: number, min = 30) => ({ eventId: String(pts), date: "", opponent: "X", homeAway: "vs" as const, result: "", stats: { PTS: pts, MIN: min } });

describe("player deep dive access", () => {
  it("free: one player a day, the same player again is free, a failed build gives the slot back", () => {
    seedUser("u1");
    const u = user("u1", "free");
    expect(claimPlayer(u, "wnba", "7101").ok).toBe(true);
    expect(claimPlayer(u, "wnba", "7101").ok).toBe(true);
    expect(claimPlayer(u, "wnba", "7102").ok).toBe(false);
    expect(canSeePlayer(u, "wnba", "7101")).toBe(true);
    expect(canSeePlayer(u, "wnba", "7102")).toBe(false);
    releasePlayer(u, "wnba", "7101");
    expect(claimPlayer(u, "wnba", "7102").ok).toBe(true);
  });

  it("paid plans that cover the sport are unlimited; Starter on soccer falls back to the daily player", () => {
    seedUser("u2");
    const pro = user("u2", "pro");
    for (const id of ["1", "2", "3"]) expect(claimPlayer(pro, "soccer-bra", id)).toMatchObject({ ok: true, limit: null });
    const starter = user("u2", "starter");
    expect(claimPlayer(starter, "wnba", "9").limit).toBeNull();
    expect(claimPlayer(starter, "soccer-bra", "10").ok).toBe(true);
    expect(claimPlayer(starter, "soccer-bra", "11").ok).toBe(false);
  });
});

describe("analyst read", () => {
  const profile = {
    athleteId: "7101", sportKey: "wnba", sportGroup: "basketball" as const, name: "Ana Lima", teamAbbr: "AUR", position: "G",
    game: null, games: [game(20), game(15), game(22)], role: null, dvp: null, teammates: [], usesMinutes: true, generatedAt: "",
    markets: [{ key: "points", label: { pt: "Pontos", en: "Points" }, statLabels: ["PTS"], binary: false, defaultLine: 17.5, posted: [{ marketKey: "points", line: 17.5, side: "over" as const, decimal: 1.87, openDecimal: 1.95, noVigFair: 0.51, kind: "total" as const }] }],
  };

  it("grounds the prompt in the page's numbers only", () => {
    const p = readPrompt(profile);
    expect(p).toContain("Points over 17.5: L5 2/3 (67%)");
    expect(p).toContain("book 1.87, no-vig 51%");
  });

  it("is stored once per athlete, day and language", async () => {
    expect(storedRead("wnba", "7101", "pt")).toBeNull();
    const first = await writePlayerRead(profile, "pt", "u1");
    const second = await writePlayerRead(profile, "pt", "u2");
    expect(second.read).toEqual(first.read);
    expect(storedRead("wnba", "7101", "pt")?.text).toContain("Ana Lima");
    expect(storedRead("wnba", "7101", "en")).toBeNull();
    const rows = getDb().prepare("SELECT paidBy FROM player_reads").all() as { paidBy: string }[];
    expect(rows).toEqual([{ paidBy: "u1" }]);
  });
});

describe("default line and slider range", () => {
  it("sits on the half point under the median, 0.5 for yes/no markets", () => {
    const games = [game(20), game(15), game(22), game(18)];
    expect(defaultLineFor(games, { statLabels: ["PTS"] })).toBe(18.5);
    expect(defaultLineFor(games, { statLabels: ["PTS"], binary: true })).toBe(0.5);
    expect(lineRange(games, ["PTS"])).toEqual({ min: 0.5, max: 22.5 });
  });
});
