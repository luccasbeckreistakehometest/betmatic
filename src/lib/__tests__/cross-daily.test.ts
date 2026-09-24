import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

const DIR = path.join(process.cwd(), "data", "unit-cross-daily");
process.env.DATA_DIR = DIR;
process.env.AUTH_SECRET = "test-secret-that-is-long-enough";
process.env.CRON_LANGS = "pt";
process.env.CRON_SPORTS = "wnba";
process.env.AI_PROVIDER = "anthropic";
process.env.ANTHROPIC_API_KEY = "unit-key";
process.env.AI_MOCK = "1";
fs.rmSync(DIR, { recursive: true, force: true });

const HOUR = 3_600_000;
const game = (id: string, hours: number, status = "scheduled") => ({
  id, startsAt: new Date(Date.now() + hours * HOUR).toISOString(), status, sportKey: "wnba",
  home: { id: `h${id}`, displayName: `Home ${id}`, abbreviation: "HOM" },
  away: { id: `a${id}`, displayName: `Away ${id}`, abbreviation: "AWY" },
});
/** The night the section was empty on: two games, which the long bands could never fill. */
let slate = [game("g1", 5), game("g2", 6)];

vi.mock("@/lib/sources/espn", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/sources/espn")>()),
  getSlateOrNearest: async () => ({ dateKey: "20260923", games: slate }),
  getGameDetail: async (id: string) => {
    const g = slate.find((x) => x.id === id);
    return g ? { game: g, books: [], injuries: [], rosters: [], leaders: [] } : null;
  },
}));

const build = vi.fn();
vi.mock("@/lib/bets/builder", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/bets/builder")>()),
  buildSlateBets: (...args: unknown[]) => build(...args),
}));

const { runCrossDaily } = await import("@/lib/server/cross-daily");
const { findPrediction } = await import("@/lib/server/predictions");
const { getDb } = await import("@/lib/server/db");

const slateRows = () => (getDb().prepare("SELECT COUNT(*) n FROM generation_requests WHERE scope='slate'").get() as { n: number }).n;
const clear = () => {
  getDb().prepare("DELETE FROM predictions").run();
  getDb().prepare("DELETE FROM generation_requests").run();
};

beforeEach(() => {
  clear();
  slate = [game("g1", 5), game("g2", 6)];
  delete process.env.CROSS_DAILY;
  build.mockReset();
  build.mockImplementation(async () => ({ suggestions: [], dataNote: "AI_MOCK" }));
});

describe("the day's múltiplas entre jogos", () => {
  it("builds on a two-game grid — the night the old ask could never fill", async () => {
    const out = await runCrossDaily();
    expect(out).toMatchObject({ status: "ok", generated: 1 });
    expect(out.sports).toEqual([{ sportKey: "wnba", verdict: "generate", dateKey: "20260923", games: 2, tickets: 0, costUsd: 0 }]);
    expect(build).toHaveBeenCalledTimes(1);
    // The short window, asked for by name, and never the long bands.
    expect(build.mock.calls[0][0]).toMatchObject({ crossShape: true });
    expect(build.mock.calls[0][0].bands).toBeUndefined();
    expect(findPrediction({ scope: "slate", sportKey: "wnba", gameId: null, dateKey: "20260923", lang: "pt" })).not.toBeNull();
  });

  it("says so and spends nothing when one game is all there is", async () => {
    slate = [game("g1", 5)];
    const out = await runCrossDaily();
    expect(out.sports[0]).toMatchObject({ verdict: "too_few_games", games: 1 });
    expect(build).not.toHaveBeenCalled();
    expect(slateRows()).toBe(0);
  });

  it("counts only the games still to start", async () => {
    slate = [game("g1", -1, "in"), game("g2", 6)];
    const out = await runCrossDaily();
    expect(out.sports[0]).toMatchObject({ verdict: "too_few_games", games: 1 });
    expect(build).not.toHaveBeenCalled();
  });

  it("files nothing a second time on the same day", async () => {
    await runCrossDaily();
    const again = await runCrossDaily();
    expect(again.sports[0].verdict).toBe("exists");
    expect(build).toHaveBeenCalledTimes(1);
    expect(slateRows()).toBe(1);
  });

  it("keeps an empty answer rather than inventing a ticket, and says why on the page", async () => {
    build.mockImplementation(async () => ({ suggestions: [], dataNote: "Nenhuma combinação entre jogos ficou dentro da faixa hoje." }));
    const out = await runCrossDaily();
    expect(out).toMatchObject({ status: "ok", generated: 1, tickets: 0 });
    const row = findPrediction({ scope: "slate", sportKey: "wnba", gameId: null, dateKey: "20260923", lang: "pt" })!;
    expect(JSON.parse(row.payload)).toMatchObject({ suggestions: [], dataNote: expect.stringContaining("faixa") });
  });

  it("is switched off by CROSS_DAILY=0, without a deploy", async () => {
    process.env.CROSS_DAILY = "0";
    const out = await runCrossDaily();
    expect(out).toMatchObject({ status: "skipped", generated: 0, note: "CROSS_DAILY=0" });
    expect(build).not.toHaveBeenCalled();
  });

  it("does not spend the readers' shared allowance", async () => {
    const { slateCaps } = await import("@/lib/server/on-demand-policy");
    await runCrossDaily();
    expect(slateRows()).toBe(1);
    // The row it wrote belongs to the platform, so the on-demand global counter still reads zero.
    const global = (getDb().prepare("SELECT COUNT(*) n FROM generation_requests WHERE scope='slate' AND userId <> 'system'").get() as { n: number }).n;
    expect(global).toBe(0);
    expect(slateCaps(process.env).globalDailyCap).toBeGreaterThan(0);
  });

  it("removes its generation row when the build throws, so tomorrow can retry", async () => {
    build.mockImplementation(async () => { throw new Error("model said no"); });
    const out = await runCrossDaily();
    expect(out.status).toBe("error");
    expect(slateRows()).toBe(0);
    expect(findPrediction({ scope: "slate", sportKey: "wnba", gameId: null, dateKey: "20260923", lang: "pt" })).toBeNull();
  });
});
