import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import type { GameDetail, PlayerHistory, PropRow } from "@/lib/types";
import type { PostedProp } from "@/lib/sources/espn-props";

/**
 * The candidate pipeline's computed side, on the real 2026 logs of the 21/09 players. Two things
 * the reviewer of this branch caught: the ladder used to print the raw distribution beside a
 * COMPUTED that was blended with the hit rate, so five per cent of lines showed a harder rung as
 * likelier than the posted one; and an absentee's log was fetched one at a time, both seasons.
 */
const LOGS = JSON.parse(fs.readFileSync(path.join(process.cwd(), "src/lib/__tests__/fixtures/wnba-gamelogs-20260921.json"), "utf8")) as Record<string, PlayerHistory>;
const historyCalls: unknown[][] = [];

vi.mock("@/lib/server/live-snapshot", () => ({ getLiveSnapshot: vi.fn() }));
vi.mock("@/lib/sources/espn", async (orig) => ({
  ...(await orig<typeof import("@/lib/sources/espn")>()),
  getPlayerHistory: async (...args: unknown[]): Promise<PlayerHistory | null> => { historyCalls.push(args); return LOGS[String(args[1])] ?? null; },
  getSeasonRole: async () => null,
}));

const { buildPropCandidates, blendedLadder } = await import("@/lib/props/candidates");

const ID = { kuier: "4790266", thomas: "2529140", ogunbowale: "3904577", brochant: "5345524", copper: "2998938", smith: "3913881", bueckers: "4433730" };
const athlete = (id: string, name: string) => ({ id, name });
const detail: GameDetail = {
  game: {
    id: "401857207", sportKey: "wnba", startsAt: "2026-09-22T02:00Z", status: "scheduled", statusDetail: "",
    home: { id: "11", abbreviation: "PHX", name: "Mercury", displayName: "Phoenix Mercury" },
    away: { id: "3", abbreviation: "DAL", name: "Wings", displayName: "Dallas Wings" },
  },
  injuries: [
    { teamAbbreviation: "PHX", player: "Kahleah Copper", status: "Out", detail: "Groin" },
    { teamAbbreviation: "DAL", player: "Alanna Smith", status: "Out", detail: "Lower Leg" },
    { teamAbbreviation: "DAL", player: "Azzi Fudd", status: "Out" },
  ],
  teamStats: { home: [], away: [] }, books: [{ provider: "DraftKings", details: "DAL -5.5", spread: 5.5, overUnder: 173.5 }], ats: [], leaders: [], lastMeetings: [],
  rosters: [
    { teamAbbreviation: "DAL", players: [], athletes: [athlete(ID.kuier, "Awak Kuier"), athlete(ID.ogunbowale, "Arike Ogunbowale"), athlete(ID.smith, "Alanna Smith"), athlete(ID.bueckers, "Paige Bueckers")] },
    { teamAbbreviation: "PHX", players: [], athletes: [athlete(ID.thomas, "Alyssa Thomas"), athlete(ID.brochant, "Noemie Brochant"), athlete(ID.copper, "Kahleah Copper")] },
  ],
};
const posted = (athleteId: string, marketKey: string, line: number, side: "over" | "under"): PostedProp => ({
  athleteId, marketKey, line, side, decimal: 1.9, openDecimal: null, openLine: null, otherDecimal: null, noVigFair: 0.5, kind: "total", book: "DraftKings", updatedAt: null,
});
const feed = {
  status: "ok" as const,
  // Two rungs per player and market: the ranking keeps two, and each row's ladder reaches two rungs either side.
  props: [
    posted(ID.kuier, "pra", 6.5, "over"), posted(ID.kuier, "pra", 7.5, "over"),
    posted(ID.thomas, "points", 15.5, "over"), posted(ID.thomas, "points", 16.5, "over"),
    posted(ID.brochant, "pra", 12.5, "under"), posted(ID.brochant, "pra", 13.5, "under"),
    posted(ID.ogunbowale, "pa", 19.5, "over"), posted(ID.copper, "points", 14.5, "over"),
  ],
};

const side = (r: PropRow) => (r.side === "under" ? "under" : "over");
const p = (r: { pOver: number; pUnder: number }, s: "over" | "under") => (s === "over" ? r.pOver : r.pUnder);

describe("the ladder and COMPUTED are one scale", () => {
  it("blends every rung with the hit rate at that rung and keeps the ladder monotone, with COMPUTED between its neighbours", async () => {
    const set = await buildPropCandidates(detail, { feed, box: null, maxPlayers: 12, limit: 80 });
    const rows = set.props.filter((r) => r.model);
    expect(rows.length).toBe(8);
    for (const r of rows) {
      const m = r.model!;
      const s = side(r);
      const ladder = [...m.ladder].sort((a, b) => a.line - b.line);
      // Over falls with the line, under rises; the posted rung carries COMPUTED itself.
      for (let i = 1; i < ladder.length; i += 1) {
        if (s === "over") expect(ladder[i].pOver).toBeLessThanOrEqual(ladder[i - 1].pOver + 1e-9);
        else expect(ladder[i].pUnder).toBeGreaterThanOrEqual(ladder[i - 1].pUnder - 1e-9);
        expect(ladder[i].pOver + ladder[i].pUnder).toBeCloseTo(1, 6);
      }
      const at = ladder.find((x) => Math.abs(x.line - r.line!) < 1e-9)!;
      expect(p(at, s)).toBeCloseTo(m.computed, 3);
      const easier = ladder.find((x) => Math.abs(x.line - (s === "over" ? r.line! - 1 : r.line! + 1)) < 1e-9);
      const harder = ladder.find((x) => Math.abs(x.line - (s === "over" ? r.line! + 1 : r.line! - 1)) < 1e-9);
      if (easier) expect(m.computed).toBeLessThanOrEqual(p(easier, s) + 1e-9);
      if (harder) expect(m.computed).toBeGreaterThanOrEqual(p(harder, s) - 1e-9);
    }
    // The reviewer's two examples, by name: the harder rung never prints higher than the posted line.
    const kuier = rows.find((r) => r.player === "Awak Kuier" && r.line === 6.5)!.model!;
    expect(kuier.ladder.find((x) => x.line === 7.5)!.pOver).toBeLessThanOrEqual(kuier.computed);
    const thomas = rows.find((r) => r.player === "Alyssa Thomas" && r.line === 15.5)!.model!;
    expect(thomas.ladder.find((x) => x.line === 14.5)!.pOver).toBeGreaterThanOrEqual(thomas.computed);
    // The blend is real: COMPUTED sits between the raw distribution and the hit rate for the posted line.
    const ogun = rows.find((r) => r.player === "Arike Ogunbowale")!;
    const hit = ogun.measured!.impliedFair;
    expect(ogun.model!.computed).toBeGreaterThan(Math.min(ogun.model!.distribution, hit) - 1e-9);
    expect(ogun.model!.computed).toBeLessThan(Math.max(ogun.model!.distribution, hit) + 1e-9);
  });

  it("pulls a rung down only when a harder rung outranks it, and leaves an unblended ladder alone", () => {
    const rungs = [{ line: 18.5, pOver: 0.6, pUnder: 0.4 }, { line: 19.5, pOver: 0.5, pUnder: 0.5 }, { line: 20.5, pOver: 0.4, pUnder: 0.6 }];
    // A hit rate that jumps at 19.5 (a push-heavy whole line beside it) would put 19.5 above 18.5 after the blend.
    const hitRate = (line: number) => ({ hits: line === 19.5 ? 40 : 10, of: 40 });
    const blended = blendedLadder(rungs, hitRate, true);
    expect(blended[1].pOver).toBeLessThanOrEqual(blended[0].pOver);
    expect(blended[2].pOver).toBeLessThanOrEqual(blended[1].pOver);
    expect(blended.every((r) => Math.abs(r.pOver + r.pUnder - 1) < 1e-9)).toBe(true);
    expect(blendedLadder(rungs, hitRate, false)).toEqual(rungs);
  });

  it("flags a LISTED OUT player on every row and prices her from her pre-injury minutes", async () => {
    const set = await buildPropCandidates(detail, { feed, box: null, maxPlayers: 12, limit: 80 });
    const copper = set.props.find((r) => r.player === "Kahleah Copper")!;
    expect(copper.model!.minutes.availability).toBe("listed_out");
    expect(copper.minutesProjection!.availability).toBe("listed_out");
    expect(set.minutes.find((m) => m.player === "Kahleah Copper")!.adjustments.some((a) => a.kind === "listing")).toBe(true);
  });
});

describe("absentee logs", () => {
  it("are fetched once each, current season only, and not for players the roster does not name", async () => {
    historyCalls.length = 0;
    await buildPropCandidates(detail, { feed, box: null, maxPlayers: 12, limit: 80 });
    const forSmith = historyCalls.filter((c) => c[1] === ID.smith);
    expect(forSmith).toHaveLength(1);
    expect(forSmith[0].length).toBeLessThanOrEqual(2); // no `force`, no `season`: this season's log answers which games she missed
    // Copper is both priced and listed out: her log is read for her own rows, and once more as an absentee for her teammates.
    expect(historyCalls.filter((c) => c[1] === ID.copper).every((c) => c.length <= 2)).toBe(true);
    // Azzi Fudd is on the report but not on the roster: nothing to fetch.
    expect(historyCalls.every((c) => Object.values(ID).includes(String(c[1])))).toBe(true);
  });
});
