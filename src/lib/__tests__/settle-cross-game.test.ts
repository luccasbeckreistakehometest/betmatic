import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import type { GameDetail, LedgerEntry, PlayerGame, PlayerHistory } from "@/lib/types";

/**
 * Written on 23/09/2026. A cross-game ticket is stored under a composite id
 * (`slate:401857208+401857209`), which ESPN cannot resolve: `getGameDetail` returned nothing, the
 * ticket was counted as "still pending" and the next pass did exactly the same. Every cross-game
 * ticket ever written was stuck that way — never graded, never voided, and silently missing from
 * the public record. Settling has to open the id and send each leg to the game that owns it.
 */

const DIR = path.join(process.cwd(), "data", "unit-cross-game");
process.env.DATA_DIR = DIR;
process.env.CACHE_DIR = path.join(DIR, "cache");
fs.rmSync(DIR, { recursive: true, force: true });

const GAME_A = "401857208";
const GAME_B = "401857209";
const hoursAgo = (h: number) => new Date(Date.now() - h * 60 * 60 * 1000).toISOString();
const kickoff = hoursAgo(9);

const austin = { name: "Shakira Austin", id: "4398911" };
const williams = { name: "Courtney Williams", id: "2529140" };

const DETAILS: Record<string, GameDetail> = {
  [GAME_A]: {
    game: {
      id: GAME_A, sportKey: "wnba", startsAt: kickoff, status: "final", statusDetail: "Final",
      home: { id: "16", abbreviation: "WAS", name: "Mystics", displayName: "Washington Mystics", score: 74 },
      away: { id: "18", abbreviation: "CONN", name: "Sun", displayName: "Connecticut Sun", score: 81 },
    },
    injuries: [], teamStats: { home: [], away: [] }, books: [], ats: [], leaders: [], lastMeetings: [],
    rosters: [{ teamAbbreviation: "WAS", players: [austin.name], athletes: [austin] }],
  },
  [GAME_B]: {
    game: {
      id: GAME_B, sportKey: "wnba", startsAt: kickoff, status: "final", statusDetail: "Final",
      home: { id: "5", abbreviation: "IND", name: "Fever", displayName: "Indiana Fever", score: 88 },
      away: { id: "8", abbreviation: "MIN", name: "Lynx", displayName: "Minnesota Lynx", score: 79 },
    },
    injuries: [], teamStats: { home: [], away: [] }, books: [], ats: [], leaders: [], lastMeetings: [],
    rosters: [{ teamAbbreviation: "MIN", players: [williams.name], athletes: [williams] }],
  },
};

const game = (eventId: string, stats: Record<string, number>): PlayerGame => ({
  eventId, date: "2026-09-22", opponent: "XXX", homeAway: "@", result: "W", stats,
});

/** Austin scored 18 (under 20.5 lands); Williams scored 16 (under 13.5 fails). */
const LOGS: Record<string, PlayerHistory> = {
  [austin.id]: { athleteId: austin.id, player: austin.name, team: "WAS", availableStats: ["MIN", "PTS", "AST"], games: [game(GAME_A, { MIN: 30, PTS: 14, AST: 4 })] },
  [williams.id]: { athleteId: williams.id, player: williams.name, team: "MIN", availableStats: ["MIN", "PTS", "AST"], games: [game(GAME_B, { MIN: 33, PTS: 16, AST: 5 })] },
};

vi.mock("@/lib/sources/espn", async (orig) => ({
  ...(await orig<typeof import("@/lib/sources/espn")>()),
  getGameDetail: async (id: string): Promise<GameDetail | null> => DETAILS[id] ?? null,
  getPlayerHistory: async (_sport: string, athleteId: string): Promise<PlayerHistory | null> => LOGS[athleteId] ?? null,
}));

const { settlePending, gameIdsOf } = await import("@/lib/ledger/settle");
const { readLedger } = await import("@/lib/ledger/store");

type Leg = { player: string; stat: string; line: number; side: "over" | "under" };

function seed(gameId: string, legs: Leg[]): void {
  const entry: LedgerEntry = {
    id: `${gameId}:long:teste`,
    gameId,
    sportKey: "wnba",
    matchup: "cross-game @ 2 wnba games",
    createdAt: hoursAgo(11),
    startsAt: kickoff,
    bandKey: "long",
    kind: "parlay",
    title: "Mesma tese, linhas mais sólidas",
    combinedDecimal: 22,
    modelledProbability: 0.12,
    outcome: "pending",
    legs: legs.map((l) => ({
      selection: `${l.player} ${l.side === "under" ? "menos de" : "mais de"} ${l.line} ${l.stat}`,
      market: "player_prop",
      sourceBasis: "gamelog",
      settlement: { type: "player_prop" as const, player: l.player, stat: l.stat, line: l.line, side: l.side, sourceBasis: "gamelog" },
      predictedProbability: 0.6,
      oddsDecimal: 1.9,
      outcome: "pending" as const,
    })),
  };
  fs.mkdirSync(path.join(DIR, "ledger"), { recursive: true });
  fs.writeFileSync(path.join(DIR, "ledger", "predictions.jsonl"), `${JSON.stringify(entry)}\n`, "utf8");
}

const stored = (): LedgerEntry => readLedger()[0];

describe("the id of a ticket played across games", () => {
  it("opens into the real events, and a plain id is left alone", () => {
    expect(gameIdsOf(`slate:${GAME_A}+${GAME_B}`)).toEqual([GAME_A, GAME_B]);
    expect(gameIdsOf(GAME_A)).toEqual([GAME_A]);
    expect(gameIdsOf("slate:")).toEqual([]);
  });
});

describe("a ticket played across two games", () => {
  it("grades every leg against the game that owns it, instead of hanging pending for ever", async () => {
    seed(`slate:${GAME_A}+${GAME_B}`, [
      { player: austin.name, stat: "points", line: 20.5, side: "under" },
      { player: williams.name, stat: "points", line: 13.5, side: "under" },
    ]);

    const run = await settlePending();

    expect(run).toEqual({ settled: 1, stillPending: 0, awaitingBoxscore: 0 });
    // Austin's 14 clears the 20.5 under; Williams's 16 does not clear 13.5, so the ticket is dead.
    expect(stored().legs[0].actual).toBe("PTS 14 vs 20.5");
    expect(stored().legs[1].actual).toBe("PTS 16 vs 13.5");
    expect(stored().outcome).toBe("lost");
    expect(stored().settledAt).toBeTruthy();
  });

  it("wins only when both games agree", async () => {
    seed(`slate:${GAME_A}+${GAME_B}`, [
      { player: austin.name, stat: "points", line: 20.5, side: "under" },
      { player: williams.name, stat: "points", line: 20.5, side: "under" },
    ]);

    await settlePending();

    expect(stored().outcome).toBe("won");
  });

  it("writes off a leg no game on the ticket claims, rather than grading it against a stranger", async () => {
    seed(`slate:${GAME_A}+${GAME_B}`, [
      { player: austin.name, stat: "points", line: 20.5, side: "under" },
      { player: "Alguém De Outro Jogo", stat: "points", line: 9.5, side: "under" },
    ]);

    await settlePending();

    expect(stored().legs[1].outcome).toBe("void");
    expect(stored().legs[1].actual).toBe("leg names no game on this ticket");
    expect(stored().outcome).toBe("void");
  });

  it("holds the whole ticket while any of its games is still being played", async () => {
    const running = { ...DETAILS[GAME_B], game: { ...DETAILS[GAME_B].game, status: "in" as const, statusDetail: "Q3" } };
    const saved = DETAILS[GAME_B];
    DETAILS[GAME_B] = running;
    seed(`slate:${GAME_A}+${GAME_B}`, [{ player: austin.name, stat: "points", line: 20.5, side: "under" }]);

    const run = await settlePending();

    expect(run.settled).toBe(0);
    expect(stored().outcome).toBe("pending");
    expect(stored().settledAt).toBeUndefined();
    DETAILS[GAME_B] = saved;
  });
});
