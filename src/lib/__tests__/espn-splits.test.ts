import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { opponentAbbreviation, parseSplits } from "@/lib/sources/espn-splits";
import type { Json } from "@/lib/sources/espn-http";
import { playerSplitsFrom, splitsPrompt, SPLIT_MIN_GAMES } from "@/lib/signals/splits";

const fixture = (name: string): Json =>
  JSON.parse(fs.readFileSync(path.join(process.cwd(), "src/lib/__tests__/fixtures", name), "utf8")) as Json;

/** Caitlin Clark, WNBA, read 24/09/2026: 200, byOpponent present, every row a copy of the season. */
const WNBA_SHELL = fixture("espn-splits-wnba-shell-20260924.json");
/** LeBron James, NBA 2024-25, read 24/09/2026: the same endpoint fully published. */
const NBA_REAL = fixture("espn-splits-nba-1966-2025.json");

describe("espn splits", () => {
  it("reads the real NBA payload: the season row, both venues and the named opponents", () => {
    const parsed = parseSplits(NBA_REAL, "1966", 2025);
    expect(parsed.overall?.games).toBe(70);
    expect(parsed.overall?.points).toBe(24.4);
    expect(parsed.home?.label).toBe("Home");
    expect(parsed.home?.games).toBe(34);
    expect(parsed.road?.games).toBe(36);
    // The venues are disjoint halves of the same season, which is what makes the gap readable.
    expect(parsed.home!.games + parsed.road!.games).toBe(parsed.overall!.games);
    expect(parsed.rested?.games).toBe(8);
    expect(Object.keys(parsed.byOpponent)).toHaveLength(28);
    expect(parsed.byOpponent.BOS?.label).toBe("Boston Celtics");
  });

  it("refuses the WNBA shell: 19 opponent rows that all repeat the season line are not splits", () => {
    // The payload really does carry them — this is the trap the parser exists to close.
    const raw = (WNBA_SHELL.splitCategories as Json[]).find((c) => c.name === "byOpponent");
    expect(raw!.splits).toHaveLength(19);
    expect(new Set((raw!.splits as Json[]).map((s) => s.displayName))).toEqual(new Set(["All Splits"]));

    const parsed = parseSplits(WNBA_SHELL, "4433403", 2026);
    expect(parsed.overall?.games).toBe(39);
    expect(parsed.byOpponent).toEqual({});
    expect(parsed.home).toBeNull();
    expect(parsed.road).toBeNull();
  });

  it("returns nothing at all for a player whose league only ships the shell", () => {
    const parsed = parseSplits(WNBA_SHELL, "4433403", 2026);
    expect(playerSplitsFrom({ player: "Caitlin Clark", team: "IND", venue: "home", opponentAbbreviation: "NYL", splits: parsed })).toBeNull();
  });

  it("names the opponent cut insufficient instead of printing it — which is every NBA opponent cut", () => {
    const parsed = parseSplits(NBA_REAL, "1966", 2025);
    const games = Object.values(parsed.byOpponent).map((l) => l.games);
    // Measured, not assumed: this is why the head-to-head almost never survives the gate.
    expect(Math.max(...games)).toBeLessThan(SPLIT_MIN_GAMES);

    const row = playerSplitsFrom({ player: "LeBron James", team: "LAL", venue: "home", opponentAbbreviation: "BOS", splits: parsed })!;
    expect(row.opponent).toBeNull();
    expect(row.thin).toContainEqual({ label: "vs BOS", games: parsed.byOpponent.BOS!.games });
    expect(row.venueLine?.games).toBe(34);
    expect(row.otherVenueLine?.games).toBe(36);

    const prompt = splitsPrompt([row]);
    expect(prompt).toContain("insufficient sample, not used: vs BOS");
    expect(prompt).toContain("venue gap");
    // The number behind the refused cut must never reach the prompt as a fact.
    expect(prompt).not.toContain(`vs this opponent`);
  });

  it("prints nothing rather than an empty heading when no player has a usable cut", () => {
    expect(splitsPrompt([])).toBe("PLAYER SPLITS: not published for this league.");
  });

  it("reads the team out of ESPN's cut abbreviation", () => {
    expect(opponentAbbreviation("vs BOS")).toBe("BOS");
    expect(opponentAbbreviation("@ GSW")).toBe("GSW");
    expect(opponentAbbreviation("Home")).toBe("HOME");
  });
});
