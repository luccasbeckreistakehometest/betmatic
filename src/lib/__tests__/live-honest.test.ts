import { beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const DIR = path.join(process.cwd(), "data", "unit-live-honest");
process.env.DATA_DIR = DIR;
process.env.AUTH_SECRET = "test-secret-that-is-long-enough";
process.env.PROOF_MIN_DECIDED = "1";
fs.rmSync(DIR, { recursive: true, force: true });

import type { BetLeg } from "@/lib/types";

const { recordLegPrices, publicClv } = await import("@/lib/server/leg-prices");
const { getDb } = await import("@/lib/server/db");

/**
 * The live scope's one promise: it never quotes a price nobody could have taken. ESPN's prop feed
 * does not move once the ball is up, so an in-play ticket carries the pre-game board — and the
 * row that records it says so, which is what keeps the ghost return out of every public number.
 */
const leg = (decimal: number): BetLeg => ({
  selection: "Paige Bueckers over 24.5 PRA", market: "player_prop", odds: String(decimal), oddsDecimal: decimal,
  explanation: "", evidence: "", fairProbability: 0.6, athleteId: "4433403",
  settlement: { type: "player_prop", player: "Paige Bueckers", stat: "PRA", line: 24.5, side: "over", sourceBasis: "measured history" },
});

const row = (ledgerId: string, decimal: number) => ({
  ledgerId, legIndex: 0, gameId: "401857207", sportKey: "wnba", startsAt: "2026-09-22T02:00:00.000Z", homeAbbr: "PHO", leg: leg(decimal),
});

beforeAll(() => { getDb(); });

describe("a live read's price is recorded as a reference", () => {
  it("writes basis 'live' and status 'no_live_price'", () => {
    expect(recordLegPrices([row("401857207:live28:mid:x", 11)], { basis: "live", status: "no_live_price" })).toBe(1);
    const stored = getDb().prepare("SELECT basis, status FROM leg_prices WHERE ledgerId=?").get("401857207:live28:mid:x") as { basis: string; status: string };
    expect(stored).toEqual({ basis: "live", status: "no_live_price" });
  });

  it("keeps the pre-game behaviour untouched when no options are passed", () => {
    expect(recordLegPrices([row("401857207:safe:y", 1.6)])).toBe(1);
    const stored = getDb().prepare("SELECT basis, status FROM leg_prices WHERE ledgerId=?").get("401857207:safe:y") as { basis: string | null; status: string };
    expect(stored).toEqual({ basis: null, status: "pending" });
  });

  it("is invisible to the close job, which only ever reads pending rows", () => {
    const pending = getDb().prepare("SELECT ledgerId FROM leg_prices WHERE status='pending'").all() as { ledgerId: string }[];
    expect(pending.map((r) => r.ledgerId)).toEqual(["401857207:safe:y"]);
  });

  it("never reaches the public CLV", () => {
    // Even marked closed by hand, a live ledger id is not a main pre-game ticket and is excluded.
    getDb().prepare("UPDATE leg_prices SET status='closed', clvPct=3.4, basis='novig' WHERE ledgerId=?").run("401857207:live28:mid:x");
    expect(publicClv(1).n).toBe(0);
  });
});
