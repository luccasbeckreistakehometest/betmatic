import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

const DIR = path.join(process.cwd(), "data", "unit-on-demand");
process.env.DATA_DIR = DIR;
process.env.AUTH_SECRET = "test-secret-that-is-long-enough";
process.env.CRON_LANGS = "pt";
fs.rmSync(DIR, { recursive: true, force: true });

const details = new Map<string, unknown>();
const generate = vi.fn();
vi.mock("@/lib/sources/espn", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/sources/espn")>()),
  getGameDetail: async (id: string) => details.get(id) ?? null,
}));
vi.mock("@/lib/server/generate-game", () => ({ generateGame: (...args: unknown[]) => generate(...args) }));

const { ensureGameGenerated } = await import("@/lib/server/on-demand");
const { createUser, toPublic } = await import("@/lib/server/users");
const { releaseUnlock, unlockGame, unlockedGames } = await import("@/lib/server/unlocks");
const { savePrediction } = await import("@/lib/server/predictions");
const { espnDateKey } = await import("@/lib/sources/espn");

const HOUR = 3_600_000;
const game = (id: string, startsInHours: number, status = "scheduled") => {
  const startsAt = new Date(Date.now() + startsInHours * HOUR).toISOString();
  details.set(id, { game: { id, sportKey: "soccer-bra", startsAt, status, home: { displayName: "Home" }, away: { displayName: "Away" } }, books: [], injuries: [] });
  return startsAt;
};
const stored = (id: string, startsAt: string) =>
  savePrediction({ scope: "game", sportKey: "soccer-bra", gameId: id, dateKey: espnDateKey(new Date(startsAt)), lang: "pt", matchup: "Away @ Home", startsAt, slate: { suggestions: [], dataNote: "" } as never });

let n = 0;
async function freeUser() {
  const row = await createUser({ email: `free${++n}@x.com`, name: "Free", password: "password123" });
  const user = toPublic(row);
  const open = (gameId: string) => ensureGameGenerated({
    sportKey: "soccer-bra", gameId, user,
    pick: { claim: () => unlockGame({ userId: user.id, plan: user.plan, gameId, sportKey: "soccer-bra" }), release: () => releaseUnlock({ userId: user.id, gameId }) },
  });
  return { user, open, picks: () => unlockedGames(user.id).map((g) => g.gameId) };
}

beforeEach(() => {
  generate.mockReset();
  delete process.env.ANTHROPIC_API_KEY;
});

describe("a free user's daily pick", () => {
  it("is handed back when AI is off or the generation fails", async () => {
    const u = await freeUser();
    game("g-off", 5);
    expect((await u.open("g-off")).status).toBe("ai_off");
    expect(u.picks()).toEqual([]);

    process.env.ANTHROPIC_API_KEY = "sk-ant-test-key-long-enough-to-count";
    generate.mockRejectedValueOnce(new Error("model down"));
    expect((await u.open("g-off")).status).toBe("error");
    expect(u.picks()).toEqual([]);
  });

  it("is kept once the tickets are generated, and a second game is refused", async () => {
    const u = await freeUser();
    game("g-ok", 5);
    game("g-other", 6);
    process.env.ANTHROPIC_API_KEY = "sk-ant-test-key-long-enough-to-count";
    generate.mockResolvedValueOnce({ costUsd: 0, notes: [] });
    expect((await u.open("g-ok")).status).toBe("generated");
    expect(u.picks()).toEqual(["g-ok"]);
    const second = await u.open("g-other");
    expect(second).toMatchObject({ status: "cap_user", unlocked: [{ gameId: "g-ok" }] });
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it("is never spent on a game that has started or finished", async () => {
    const u = await freeUser();
    game("g-final", -30, "final");
    expect((await u.open("g-final")).status).toBe("started");
    const kicked = game("g-live", -1, "in");
    stored("g-live", kicked);
    expect((await u.open("g-live")).status).toBe("exists"); // its tickets are public now
    expect(u.picks()).toEqual([]);
    expect(generate).not.toHaveBeenCalled();
  });

  it("is spent on an upcoming game whose tickets already exist, even one ESPN stopped listing", async () => {
    const u = await freeUser();
    const startsAt = new Date(Date.now() + 4 * HOUR).toISOString();
    stored("g-stored", startsAt);
    expect((await u.open("g-stored")).status).toBe("exists");
    expect(u.picks()).toEqual(["g-stored"]);
    expect((await u.open("g-unknown")).status).toBe("not_found");
    expect(u.picks()).toEqual(["g-stored"]);
  });
});
