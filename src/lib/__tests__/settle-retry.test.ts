import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import type { GameDetail, LedgerEntry, PlayerGame, PlayerHistory } from "@/lib/types";

/**
 * Written after the night of 21/09/2026. Settling ran minutes after the final whistle of Dallas @
 * Phoenix, ESPN had not yet published the game into the players' gamelogs, and all 29 legs came
 * back ungradable — nine tickets were stamped void with a `settledAt`, so they were never looked at
 * again. The real record was 4 won / 5 lost. A gamelog that is merely late has to hold the ticket;
 * only a gamelog that is late for hours, or a market nothing can measure, may write it off.
 */

const DIR = path.join(process.cwd(), "data", "unit-settle");
process.env.DATA_DIR = DIR;
process.env.CACHE_DIR = path.join(DIR, "cache");
fs.rmSync(DIR, { recursive: true, force: true });

const GAME_ID = "401857207";
const PREVIOUS_GAME_ID = "401857199";
const hoursAgo = (h: number) => new Date(Date.now() - h * 60 * 60 * 1000).toISOString();

const player = { name: "Satou Sabally", id: "4066533" };

// Both stubs are rewritten per test: how long ago the ball went up, and what ESPN has published.
let kickoff = hoursAgo(1);
let gamelog: PlayerHistory | null = null;

const detail = (): GameDetail => ({
  game: {
    id: GAME_ID,
    sportKey: "wnba",
    startsAt: kickoff,
    status: "final",
    statusDetail: "Final",
    home: { id: "9", abbreviation: "PHX", name: "Mercury", displayName: "Phoenix Mercury", score: 86 },
    away: { id: "3", abbreviation: "DAL", name: "Wings", displayName: "Dallas Wings", score: 79 },
  },
  injuries: [],
  teamStats: { home: [], away: [] },
  books: [],
  ats: [],
  leaders: [],
  lastMeetings: [],
  rosters: [{ teamAbbreviation: "DAL", players: [player.name], athletes: [player] }],
});

const game = (eventId: string, stats: Record<string, number>): PlayerGame => ({
  eventId,
  date: "2026-09-21",
  opponent: "PHX",
  homeAway: "@",
  result: "L 79-86",
  stats,
});

const log = (games: PlayerGame[]): PlayerHistory => ({
  athleteId: player.id,
  player: player.name,
  team: "DAL",
  games,
  availableStats: ["MIN", "PTS", "REB", "AST", "BLK"],
});

/** The season up to last night, which is all ESPN had published when settling ran. */
const WITHOUT_LAST_NIGHT = [game(PREVIOUS_GAME_ID, { MIN: 33, PTS: 12, REB: 4, AST: 5, BLK: 1 })];
/** The same log once the game lands in it: 21 points, 7 rebounds, 3 assists. */
const WITH_LAST_NIGHT = [game(GAME_ID, { MIN: 34, PTS: 21, REB: 7, AST: 3 }), ...WITHOUT_LAST_NIGHT];

vi.mock("@/lib/sources/espn", async (orig) => ({
  ...(await orig<typeof import("@/lib/sources/espn")>()),
  getGameDetail: async (): Promise<GameDetail> => detail(),
  getPlayerHistory: async (): Promise<PlayerHistory | null> => gamelog,
}));

const { settlePending, BOXSCORE_GRACE_MS, boxscoreGraceOver } = await import("@/lib/ledger/settle");
const { readLedger } = await import("@/lib/ledger/store");

type Leg = { stat: string; line: number; side: "over" | "under" };

/** One pending ticket in the ledger, as the generator would have logged it before tip-off. */
function seed(legs: Leg[]): void {
  const entry: LedgerEntry = {
    id: `${GAME_ID}:seguro:teste`,
    gameId: GAME_ID,
    sportKey: "wnba",
    matchup: "Dallas Wings @ Phoenix Mercury",
    createdAt: hoursAgo(9),
    startsAt: kickoff,
    bandKey: "seguro",
    kind: legs.length > 1 ? "parlay" : "single",
    title: "Sabally na dobradinha",
    combinedDecimal: 1.85,
    modelledProbability: 0.58,
    outcome: "pending",
    legs: legs.map((l) => ({
      selection: `Satou Sabally ${l.side === "over" ? "mais de" : "menos de"} ${l.line} ${l.stat}`,
      market: "player_prop",
      sourceBasis: "gamelog",
      settlement: { type: "player_prop" as const, player: player.name, stat: l.stat, line: l.line, side: l.side, sourceBasis: "gamelog" },
      predictedProbability: 0.58,
      oddsDecimal: 1.85,
      outcome: "pending" as const,
    })),
  };
  fs.mkdirSync(path.join(DIR, "ledger"), { recursive: true });
  fs.writeFileSync(path.join(DIR, "ledger", "predictions.jsonl"), `${JSON.stringify(entry)}\n`, "utf8");
}

const stored = (): LedgerEntry => readLedger()[0];

describe("a gamelog that has not caught up yet", () => {
  it("leaves the ticket alone while the grace window is open", async () => {
    kickoff = hoursAgo(1);
    gamelog = log(WITHOUT_LAST_NIGHT);
    seed([{ stat: "points", line: 18.5, side: "over" }]);

    const run = await settlePending();

    expect(run).toEqual({ settled: 0, stillPending: 1, awaitingBoxscore: 1 });
    expect(stored().outcome).toBe("pending");
    expect(stored().settledAt).toBeUndefined();
    expect(stored().legs[0].outcome).toBe("pending");
    expect(stored().legs[0].actual).toBeUndefined();
  });

  it("grades the held ticket for real on the next pass, once the game is published", async () => {
    kickoff = hoursAgo(1);
    gamelog = log(WITHOUT_LAST_NIGHT);
    seed([{ stat: "points", line: 18.5, side: "over" }]);
    await settlePending();
    expect(stored().settledAt).toBeUndefined();

    gamelog = log(WITH_LAST_NIGHT);
    const run = await settlePending();

    expect(run).toEqual({ settled: 1, stillPending: 0, awaitingBoxscore: 0 });
    expect(stored().outcome).toBe("won");
    expect(stored().legs[0].actual).toBe("PTS 21 vs 18.5");
    expect(stored().settledAt).toBeTruthy();
  });

  it("voids the ticket once the grace window has closed, saying it could not be measured", async () => {
    kickoff = hoursAgo(7);
    gamelog = log(WITHOUT_LAST_NIGHT);
    seed([{ stat: "points", line: 18.5, side: "over" }]);

    const run = await settlePending();

    expect(run).toEqual({ settled: 1, stillPending: 0, awaitingBoxscore: 0 });
    expect(stored().outcome).toBe("void");
    expect(stored().legs[0].actual).toBe("não é possível medir");
    expect(stored().settledAt).toBeTruthy();
  });

  it("holds a ticket ESPN answers with nothing at all, then writes it off", async () => {
    kickoff = hoursAgo(1);
    gamelog = null;
    seed([{ stat: "points", line: 18.5, side: "over" }]);
    expect(await settlePending()).toEqual({ settled: 0, stillPending: 1, awaitingBoxscore: 1 });
    expect(stored().settledAt).toBeUndefined();

    kickoff = hoursAgo(7);
    seed([{ stat: "points", line: 18.5, side: "over" }]);
    expect(await settlePending()).toEqual({ settled: 1, stillPending: 0, awaitingBoxscore: 0 });
    expect(stored().outcome).toBe("void");
  });

  it("measures the window from kickoff, and never waits on a game with no kickoff", () => {
    expect(BOXSCORE_GRACE_MS).toBe(6 * 60 * 60 * 1000);
    expect(boxscoreGraceOver(hoursAgo(5.9))).toBe(false);
    expect(boxscoreGraceOver(hoursAgo(6.1))).toBe(true);
    expect(boxscoreGraceOver(undefined)).toBe(true);
    expect(boxscoreGraceOver("not a date")).toBe(true);
  });
});

describe("a leg no gamelog could ever answer", () => {
  it("voids an unmapped market at once, without sitting out the window", async () => {
    kickoff = hoursAgo(1);
    gamelog = log(WITH_LAST_NIGHT);
    seed([{ stat: "double_double", line: 0.5, side: "over" }]);

    const run = await settlePending();

    expect(run).toEqual({ settled: 1, stillPending: 0, awaitingBoxscore: 0 });
    expect(stored().outcome).toBe("void");
    expect(stored().legs[0].actual).toBe("não é possível medir");
    expect(stored().settledAt).toBeTruthy();
  });
});

describe("a published gamelog grades the leg as it always did", () => {
  const cases: { stat: string; line: number; side: "over" | "under"; outcome: string; actual: string }[] = [
    { stat: "points", line: 18.5, side: "over", outcome: "won", actual: "PTS 21 vs 18.5" },
    { stat: "points", line: 24.5, side: "over", outcome: "lost", actual: "PTS 21 vs 24.5" },
    { stat: "points", line: 24.5, side: "under", outcome: "won", actual: "PTS 21 vs 24.5" },
    { stat: "rebounds", line: 7.5, side: "under", outcome: "won", actual: "REB 7 vs 7.5" },
    { stat: "assists", line: 3, side: "over", outcome: "push", actual: "AST 3 vs 3" },
    { stat: "pra", line: 30.5, side: "over", outcome: "won", actual: "PTS+REB+AST 31 vs 30.5" },
  ];

  for (const c of cases) {
    it(`${c.side} ${c.line} ${c.stat} is ${c.outcome}`, async () => {
      kickoff = hoursAgo(1);
      gamelog = log(WITH_LAST_NIGHT);
      seed([{ stat: c.stat, line: c.line, side: c.side }]);

      await settlePending();

      expect(stored().outcome).toBe(c.outcome);
      expect(stored().legs[0].actual).toBe(c.actual);
      expect(stored().settledAt).toBeTruthy();
    });
  }

  it("a lost leg settles the parlay even while another leg waits on the boxscore", async () => {
    kickoff = hoursAgo(1);
    gamelog = log(WITH_LAST_NIGHT);
    // The published row carries no BLK column, so the second leg has nothing to read yet.
    seed([
      { stat: "points", line: 24.5, side: "over" },
      { stat: "blocks", line: 0.5, side: "over" },
    ]);

    const run = await settlePending();

    expect(run).toEqual({ settled: 1, stillPending: 0, awaitingBoxscore: 0 });
    expect(stored().outcome).toBe("lost");
    expect(stored().legs.map((l) => l.outcome)).toEqual(["lost", "pending"]);
    expect(stored().legs[1].actual).toBe("aguardando boxscore");
    expect(stored().settledAt).toBeTruthy();
  });
});
