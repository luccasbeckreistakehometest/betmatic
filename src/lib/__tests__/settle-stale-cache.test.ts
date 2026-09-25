import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import type { GameDetail, LedgerEntry, PlayerGame, PlayerHistory } from "@/lib/types";

/**
 * The night of 24/09/2026: 84 of 133 tickets written off as unmeasurable while ESPN had the data.
 *
 * The gamelog cache lives six hours (sources/espn.ts TTL.gamelog) and the settlement grace is also
 * six hours from tip-off (BOXSCORE_GRACE_MS). For a ticket built the day before, the cache had long
 * expired by the final whistle and nothing was wrong. For one built close to tip-off — which is what
 * the pre-match refresh does — the cached log is from BEFORE the game, can never contain it, and the
 * grace runs out first. Two games voided whole, every live read voided, `awaitingBoxscore` stuck at
 * 121 for hours with nothing settled, and not one error logged.
 *
 * So the settler may not take a cache miss as a verdict. It asks again past the cache before writing
 * anything off, which is what these tests hold it to.
 */

const DIR = path.join(process.cwd(), "data", "unit-settle-stale");
process.env.DATA_DIR = DIR;
process.env.CACHE_DIR = path.join(DIR, "cache");
fs.rmSync(DIR, { recursive: true, force: true });

const GAME_ID = "401857215";
const PREVIOUS_GAME_ID = "401857199";
const hoursAgo = (h: number) => new Date(Date.now() - h * 60 * 60 * 1000).toISOString();
const player = { name: "Leila Lacan", id: "5105561" };

let kickoff = hoursAgo(1);
/** What a cached read returns: the log as it was when the ticket was built, before the game. */
let cachedLog: PlayerHistory | null = null;
/** What a forced read returns: the log ESPN actually serves now. */
let freshLog: PlayerHistory | null = null;
let forcedCalls = 0;

const detail = (): GameDetail => ({
  game: {
    id: GAME_ID, sportKey: "wnba", startsAt: kickoff, status: "final", statusDetail: "Final",
    home: { id: "18", abbreviation: "CONN", name: "Sun", displayName: "Connecticut Sun", score: 81 },
    away: { id: "19", abbreviation: "TOR", name: "Tempo", displayName: "Toronto Tempo", score: 74 },
  },
  injuries: [], teamStats: { home: [], away: [] }, books: [], ats: [], leaders: [], lastMeetings: [],
  rosters: [{ teamAbbreviation: "TOR", players: [player.name], athletes: [player] }],
});

const game = (eventId: string, stats: Record<string, number>): PlayerGame => ({
  eventId, date: "2026-09-24", opponent: "CONN", homeAway: "@", result: "L 74-81", stats,
});
const log = (games: PlayerGame[]): PlayerHistory => ({
  athleteId: player.id, player: player.name, team: "TOR", games, availableStats: ["MIN", "PTS", "REB", "AST"],
});

const WITHOUT = [game(PREVIOUS_GAME_ID, { MIN: 24, PTS: 8, REB: 3, AST: 2 })];
/** She scored 12: an `over 9.5 points` leg is a WIN, and voiding it is a loss of a win.  */
const WITH = [game(GAME_ID, { MIN: 27, PTS: 12, REB: 4, AST: 3 }), ...WITHOUT];

vi.mock("@/lib/sources/espn", async (orig) => ({
  ...(await orig<typeof import("@/lib/sources/espn")>()),
  getGameDetail: async (): Promise<GameDetail> => detail(),
  getPlayerHistory: async (_sport: string, _id: string, force = false): Promise<PlayerHistory | null> => {
    if (force) { forcedCalls += 1; return freshLog; }
    return cachedLog;
  },
}));

const { settlePending } = await import("@/lib/ledger/settle");
const { readLedger } = await import("@/lib/ledger/store");

function seed(): void {
  const entry: LedgerEntry = {
    id: `${GAME_ID}:seguro:teste`,
    gameId: GAME_ID, sportKey: "wnba", matchup: "Toronto Tempo @ Connecticut Sun",
    createdAt: hoursAgo(7), startsAt: kickoff, bandKey: "seguro", kind: "single",
    title: "Leila Lacan pontos", combinedDecimal: 1.9, modelledProbability: 0.55,
    evidenceScore: 100, confidence: "medium", suggestionId: "s1", outcome: "pending",
    legs: [{
      selection: "Leila Lacan over 9.5 points", market: "player prop", sourceBasis: "measured history",
      settlement: { type: "player_prop", player: player.name, stat: "points", line: 9.5, side: "over", sourceBasis: "measured history" },
      predictedProbability: 0.55, oddsDecimal: 1.9, outcome: "pending",
    }],
  } as unknown as LedgerEntry;
  fs.mkdirSync(path.join(DIR, "ledger"), { recursive: true });
  fs.writeFileSync(path.join(DIR, "ledger", "predictions.jsonl"), `${JSON.stringify(entry)}\n`);
}

const stored = () => readLedger()[0];

describe("a stale cached gamelog is not a verdict", () => {
  it("grades the leg from a forced read when the cached log predates the game", async () => {
    // The exact shape of 24/09: the grace is over, so the old code wrote the ticket off — while the
    // gamelog ESPN was serving already had the game in it.
    kickoff = hoursAgo(7);
    cachedLog = log(WITHOUT);
    freshLog = log(WITH);
    forcedCalls = 0;
    seed();

    await settlePending();

    expect(forcedCalls).toBeGreaterThan(0);
    expect(stored().outcome).toBe("won");
    expect(stored().legs[0].actual).toContain("12");
  });

  it("still holds the ticket while the grace is open and neither log has the game", async () => {
    kickoff = hoursAgo(1);
    cachedLog = log(WITHOUT);
    freshLog = log(WITHOUT);
    seed();

    await settlePending();

    // A held ticket is left exactly as it was — the settler writes nothing until it can decide,
    // which is why a re-run can still grade it (settle-retry.test.ts holds the same contract).
    expect(stored().outcome).toBe("pending");
    expect(stored().settledAt).toBeUndefined();
    expect(stored().legs[0].outcome).toBe("pending");
    expect(stored().legs[0].actual).toBeUndefined();
  });

  it("writes it off once the grace is over and ESPN genuinely does not have the game", async () => {
    // The forced read is the last word: when even that lacks the game, the ticket is unmeasurable
    // and saying so is correct. The fix must not turn a real write-off into a permanent pending.
    kickoff = hoursAgo(7);
    cachedLog = log(WITHOUT);
    freshLog = log(WITHOUT);
    seed();

    await settlePending();

    expect(stored().outcome).toBe("void");
    expect(stored().legs[0].actual).toBe("não é possível medir");
  });

  it("does not spend a forced read when the cached log already has the game", async () => {
    // The retry only fires where the leg would otherwise be lost, so a normal night costs nothing.
    kickoff = hoursAgo(7);
    cachedLog = log(WITH);
    freshLog = log(WITH);
    forcedCalls = 0;
    seed();

    await settlePending();

    expect(forcedCalls).toBe(0);
    expect(stored().outcome).toBe("won");
  });
});
