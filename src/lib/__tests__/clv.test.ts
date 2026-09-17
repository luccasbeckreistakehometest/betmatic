import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

const DIR = path.join(process.cwd(), "data", "unit-clv");
process.env.DATA_DIR = DIR;
process.env.AUTH_SECRET = "test-secret-that-is-long-enough";
fs.rmSync(DIR, { recursive: true, force: true });

const HOUR = 3_600_000;
const snap = (over: number, under: number, total: number) => ({ homeMl: 1.67, awayMl: 2.3, draw: null, total, over, under, spread: null, homeSpread: null, awaySpread: null });
vi.mock("@/lib/sources/espn-props", async (orig) => ({
  ...(await orig<typeof import("@/lib/sources/espn-props")>()),
  getGameLines: async () => [{ provider: "DraftKings", open: snap(1.95, 1.87, 160.5), current: snap(1.909, 1.909, 160.5), close: null }],
  getPropPrices: async () => ({ status: "ok", props: [{ athleteId: "7101", marketKey: "points", side: "over", line: 18.5, decimal: 1.9, noVigFair: 0.5, openDecimal: null, openLine: null, otherDecimal: 1.9, kind: "total", book: "DK", updatedAt: null }] }),
}));

const { clvOf, clvSummary, lineMove, noVigShare } = await import("@/lib/ledger/clv");
const { closeOf, priceKeyOf, recordLegPrices, runCloseJob, clvByLedger } = await import("@/lib/server/leg-prices");
const { getDb } = await import("@/lib/server/db");

describe("CLV maths", () => {
  it("taken 2.05 against a -110/-110 close: +2.5% no-vig, +7.4% raw", () => {
    const close = 1 + 100 / 110;
    const fair = noVigShare([close, close], 0)!;
    expect(fair).toBeCloseTo(0.5, 6);
    expect(clvOf(2.05, close, fair)).toEqual({ pct: expect.closeTo(0.025, 6), basis: "novig" });
    const raw = clvOf(2.05, close, null)!;
    expect(raw.basis).toBe("raw");
    expect(Number((raw.pct * 100).toFixed(1))).toBe(7.4);
  });

  it("removes the margin across three outcomes for football moneylines", () => {
    const home = closeOf({ kind: "ml", marketKey: "moneyline", athleteId: null, side: "home", line: null, takenDecimal: 2.2 }, { ...snap(1.9, 1.9, 2.5), homeMl: 2.0, draw: 3.4, awayMl: 3.8 }, [], true);
    const inv = 1 / 2.0 + 1 / 3.4 + 1 / 3.8;
    expect(home.status).toBe("closed");
    expect(home.clv).toBeCloseTo(2.2 * (0.5 / inv) - 1, 6);
  });

  it("reports a moved line with its direction and no number", () => {
    expect(lineMove("over", 2.5, 3.5)).toBe("favor");
    expect(lineMove("under", 2.5, 3.5)).toBe("against");
    const moved = closeOf({ kind: "total", marketKey: "total", athleteId: null, side: "over", line: 160.5, takenDecimal: 1.91 }, snap(1.9, 1.9, 162.5), [], false);
    expect(moved).toMatchObject({ status: "line_moved", clv: null, closeLine: 162.5, direction: "favor" });
    const prop = closeOf({ kind: "prop", marketKey: "points", athleteId: "7101", side: "over", line: 17.5, takenDecimal: 1.87 }, null, [{ athleteId: "7101", marketKey: "points", side: "over", line: 18.5, decimal: 1.9, noVigFair: 0.5 }], false);
    expect(prop).toMatchObject({ status: "line_moved", direction: "favor", clv: null });
  });

  it("hides the summary number under 30 legs", () => {
    const rows = Array.from({ length: 29 }, (_, i) => ({ market: i % 2 ? "total" : "points", clvPct: 0.02, status: "closed", basis: "novig" as const }));
    expect(clvSummary(rows).publishable).toBe(false);
    const full = clvSummary([...rows, { market: "total", clvPct: -0.01, status: "closed", basis: "raw" }, { market: "total", clvPct: null, status: "line_moved", basis: null, direction: "favor" }]);
    expect(full).toMatchObject({ publishable: true, n: 30, moved: 1, movedFavor: 1 });
    expect(full.beat).toBeCloseTo(29 / 30, 6);
  });
});

describe("close job", () => {
  it("records taken prices once, closes the legs of a game about to start, and does nothing on a rerun", async () => {
    const startsAt = new Date(Date.now() + 10 * 60_000).toISOString();
    const leg = (settlement: object, oddsDecimal: number, athleteId?: string) => ({ oddsDecimal, athleteId, settlement: { sourceBasis: "", ...settlement } as never });
    const input = [
      { ledgerId: "T1", legIndex: 0, gameId: "777", sportKey: "wnba", startsAt, homeAbbr: "AUR", leg: leg({ type: "total", line: 160.5, side: "over" }, 2.05) },
      { ledgerId: "T1", legIndex: 1, gameId: "777", sportKey: "wnba", startsAt, homeAbbr: "AUR", leg: leg({ type: "moneyline", teamAbbreviation: "AUR" }, 1.72) },
      { ledgerId: "T1", legIndex: 2, gameId: "777", sportKey: "wnba", startsAt, homeAbbr: "AUR", leg: leg({ type: "player_prop", stat: "points", line: 18.5, side: "over", player: "Ana" }, 1.95, "7101") },
      { ledgerId: "T2", legIndex: 0, gameId: "778", sportKey: "wnba", startsAt: new Date(Date.now() + 5 * HOUR).toISOString(), homeAbbr: "X", leg: leg({ type: "total", line: 150.5, side: "under" }, 1.9) },
      { ledgerId: "T3", legIndex: 0, gameId: "slate:1+2", sportKey: "wnba", startsAt, homeAbbr: null, leg: leg({ type: "total", line: 1, side: "under" }, 1.9) },
    ];
    expect(priceKeyOf(input[1].leg, "AUR")).toMatchObject({ kind: "ml", side: "home" });
    expect(recordLegPrices(input)).toBe(4);
    expect(recordLegPrices(input)).toBe(0);
    const first = await runCloseJob();
    expect(first).toMatchObject({ games: 1, closed: 3, moved: 0 });
    const rows = getDb().prepare("SELECT legIndex, status, basis, round(clvPct, 4) clv FROM leg_prices WHERE ledgerId='T1' ORDER BY legIndex").all();
    expect(rows).toEqual([
      { legIndex: 0, status: "closed", basis: "novig", clv: 0.025 },
      { legIndex: 1, status: "closed", basis: "novig", clv: expect.any(Number) },
      { legIndex: 2, status: "closed", basis: "novig", clv: -0.025 },
    ]);
    expect(await runCloseJob()).toMatchObject({ closed: 0, moved: 0, noClose: 0 });
    expect(clvByLedger(["T1", "T2"]).get("T1")?.n).toBe(3);
    expect(clvByLedger(["T2"]).has("T2")).toBe(false);
  });
});
