import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

const DIR = path.join(process.cwd(), "data", "unit-featured");
process.env.DATA_DIR = DIR;
process.env.AUTH_SECRET = "test-secret-that-is-long-enough";
process.env.CRON_LANGS = "pt";
process.env.FEATURED_SPORTS = "soccer-bra";
fs.rmSync(DIR, { recursive: true, force: true });

const HOUR = 3_600_000;
const slate = [
  { id: "f1", startsAt: new Date(Date.now() + 5 * HOUR).toISOString(), status: "scheduled", home: { id: "h1", displayName: "Home 1" }, away: { id: "a1", displayName: "Away 1" }, odds: {} },
  { id: "f2", startsAt: new Date(Date.now() + 6 * HOUR).toISOString(), status: "scheduled", home: { id: "h2", displayName: "Home 2" }, away: { id: "a2", displayName: "Away 2" }, odds: {} },
  { id: "f3", startsAt: new Date(Date.now() + 7 * HOUR).toISOString(), status: "scheduled", home: { id: "h3", displayName: "Home 3" }, away: { id: "a3", displayName: "Away 3" } },
];
vi.mock("@/lib/sources/espn", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/sources/espn")>()),
  getSlate: async (day: string) => (day === (await importOriginal<typeof import("@/lib/sources/espn")>()).todayKey() ? slate : []),
  getGameDetail: async (id: string) => {
    const game = slate.find((g) => g.id === id);
    return game ? { game: { ...game, sportKey: "soccer-bra" }, books: [], injuries: [], rosters: [], leaders: [] } : null;
  },
}));
const generate = vi.fn();
vi.mock("@/lib/server/generate-game", () => ({ generateGame: (...args: unknown[]) => generate(...args) }));

const { runFeatured, featuredToday } = await import("@/lib/server/featured");
const { savePrediction } = await import("@/lib/server/predictions");
const { todayCounts } = await import("@/lib/server/on-demand");
const { getDb } = await import("@/lib/server/db");

beforeEach(() => {
  generate.mockReset();
  generate.mockImplementation(async ({ sportKey, dateKey, detail, langs }) => {
    for (const lang of langs) savePrediction({ scope: "game", sportKey, gameId: detail.game.id, dateKey, lang, slate: { suggestions: [], dataNote: "" } });
    return { costUsd: 0.25, notes: [], info: [] };
  });
});

describe("featured games job", () => {
  it("records an error, not an ok, when AI is off", async () => {
    delete process.env.AI_MOCK;
    process.env.ANTHROPIC_API_KEY = "";
    const out = await runFeatured();
    expect(out.status).toBe("error");
    expect(out.predictions).toBe(0);
    const row = getDb().prepare("SELECT status FROM job_runs WHERE id=?").get(out.runId) as { status: string };
    expect(row.status).toBe("error");
    expect(generate).not.toHaveBeenCalled();
  });

  it("generates exactly FEATURED_PER_DAY games once, outside the users' allowance", async () => {
    process.env.AI_MOCK = "1";
    process.env.FEATURED_PER_DAY = "2";
    const out = await runFeatured();
    expect(out).toMatchObject({ status: "ok", generated: 2, predictions: 2 });
    expect(featuredToday().map((r) => r.gameId)).toEqual(["f1", "f2"]);
    expect(todayCounts("system").global).toBe(0);
    const again = await runFeatured();
    expect(again).toMatchObject({ generated: 0, predictions: 0 });
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it("registers an already generated game without spending a generation", async () => {
    process.env.FEATURED_PER_DAY = "3";
    const out = await runFeatured();
    expect(out.generated).toBe(1);
    expect(featuredToday()).toHaveLength(3);
  });
});
