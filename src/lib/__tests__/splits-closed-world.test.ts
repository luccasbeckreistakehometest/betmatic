import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { writeEspnFixtures } from "../../../tests/e2e/espn-fixtures";

/**
 * The e2e world is closed: a URL with no fixture falls through to the real ESPN (sources/
 * espn-http.ts), which is how a new feed silently starts calling the internet from a test run. So
 * this runs both new signals against the generated world with `fetch` REPLACED BY A THROW — any
 * URL the fixtures do not cover fails here instead of quietly going online during the Playwright
 * suite.
 */
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "espn-fixtures-"));
const cache = fs.mkdtempSync(path.join(os.tmpdir(), "espn-cache-"));
const NOW = Date.UTC(2026, 8, 24, 18, 0, 0);

let splitsForGame: typeof import("@/lib/signals/splits").splitsForGame;
let splitsPrompt: typeof import("@/lib/signals/splits").splitsPrompt;
let teamSeasonForGame: typeof import("@/lib/signals/team-season").teamSeasonForGame;
let teamSeasonPrompt: typeof import("@/lib/signals/team-season").teamSeasonPrompt;

beforeAll(async () => {
  writeEspnFixtures(dir, NOW);
  process.env.ESPN_FIXTURES = dir;
  process.env.CACHE_DIR = cache;
  vi.stubGlobal("fetch", () => { throw new Error("the closed world reached the internet"); });
  ({ splitsForGame, splitsPrompt } = await import("@/lib/signals/splits"));
  ({ teamSeasonForGame, teamSeasonPrompt } = await import("@/lib/signals/team-season"));
});
afterAll(() => {
  vi.unstubAllGlobals();
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(cache, { recursive: true, force: true });
});

const GAME = { sportKey: "wnba", homeAbbreviation: "AUR", awayAbbreviation: "BOR", startsAt: new Date(NOW + 5 * 3_600_000).toISOString() };

describe("the new ESPN reads inside the closed test world", () => {
  it("reads every player's splits off disk and prints the venue cut", async () => {
    const rows = await splitsForGame({
      ...GAME,
      targets: [
        { athleteId: "7101", player: "Ana Lima", team: "AUR" },
        { athleteId: "7201", player: "Duda Alves", team: "BOR" },
      ],
    });
    expect(rows).toHaveLength(2);
    const ana = rows.find((r) => r.player === "Ana Lima")!;
    expect(ana.venue).toBe("home");
    expect(ana.venueLine?.games).toBe(16);
    expect(ana.otherVenueLine?.games).toBe(16);
    // The home row is the lifted one, so the gap has to point at tonight's venue.
    expect(ana.venueLine!.points!).toBeGreaterThan(ana.otherVenueLine!.points!);

    const prompt = splitsPrompt(rows);
    expect(prompt).toContain("Ana Lima (AUR, at home tonight)");
    expect(prompt).toContain("Duda Alves (BOR, on the road tonight)");
    expect(prompt).toContain("venue gap +");
  });

  it("prints the head-to-head only when it reaches the gate, and names the rest insufficient", async () => {
    // Ana plays Boreal tonight: that cut is pinned at the gate, so it is a fact.
    const [ana] = await splitsForGame({ ...GAME, targets: [{ athleteId: "7101", player: "Ana Lima", team: "AUR" }] });
    expect(ana.opponent?.games).toBe(5);
    expect(splitsPrompt([ana])).toContain("vs this opponent");

    // Duda's opponent tonight is Aurora, whose cut is two games — below the gate.
    const [duda] = await splitsForGame({ ...GAME, targets: [{ athleteId: "7201", player: "Duda Alves", team: "BOR" }] });
    expect(duda.opponent).toBeNull();
    expect(duda.thin).toContainEqual({ label: "vs AUR", games: 2 });
    expect(splitsPrompt([duda])).toContain("insufficient sample, not used: vs AUR (2 g)");
  });

  it("reads both teams' season rates off disk, with their ranks", async () => {
    const matchup = await teamSeasonForGame({
      sportKey: "wnba", home: { id: "9901", abbreviation: "AUR" }, away: { id: "9902", abbreviation: "BOR" }, startsAt: GAME.startsAt,
    });
    expect(matchup?.home?.games).toBe(30);
    expect(matchup?.away?.possessions?.rank).toBe(3);
    const prompt = teamSeasonPrompt(matchup);
    expect(prompt).toContain("AUR (30 games)");
    expect(prompt).toContain("conceded");
    expect(prompt).toContain("possessions: that is the volume");
  });

  it("asks for nothing at all outside basketball", async () => {
    expect(await splitsForGame({ ...GAME, sportKey: "soccer-bra", targets: [{ athleteId: "88001", player: "Rafa Moura", team: "TUP" }] })).toEqual([]);
    expect(await teamSeasonForGame({ sportKey: "soccer-bra", home: { id: "9921", abbreviation: "TUP" }, away: { id: "9922", abbreviation: "IPE" }, startsAt: GAME.startsAt })).toBeNull();
  });
});
