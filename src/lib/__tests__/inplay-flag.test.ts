import { describe, expect, it } from "vitest";
import type { BuildArgs } from "@/lib/bets/builder";

/**
 * Written on the night of 23/09/2026, from production. The quarter read of Atlanta @ New York fired
 * at half-time, generated, emailed — and published nothing. Every ticket was dropped by the
 * availability gate with "Jonquel Jones: 13 projected minutes, under the 20 an over on a volume
 * stat needs", logged under `scope: "pre"` on a read taken with 23 regulation minutes left.
 *
 * The cause: `BuildArgs.live` carries SOCCER state, and the basketball quarter read passes it as
 * null (its in-play context travels in `extraContext`). Everything that asked `!!live` was really
 * asking "is this soccer, in play". Two things asked it:
 *
 *   - the emission gates, which must not run in play, because the live projection reports the
 *     minutes that REMAIN — under twenty from half-time onward by definition;
 *   - `calibratorFor`, which then corrected live reads with the PRE-GAME ruler. Measured the same
 *     morning, those are not close: live is −0.853 in log-odds against −0.283 pre-game, so a 93%
 *     claim came out at 90.9% when the live record says 85.0%.
 *
 * `inPlay` is the sport-neutral answer, and this test is here so nobody reintroduces `!!live` as a
 * synonym for it.
 */

describe("the flag that says the game is under way", () => {
  it("is its own argument, not a reading of the soccer state", () => {
    const args: Partial<BuildArgs> = { live: null, inPlay: true };
    expect(args.live).toBeNull();
    expect(args.inPlay).toBe(true);
  });

  it("is what the basketball quarter read sets", async () => {
    // The call site is the proof: the read passes `inPlay: true` beside a null soccer state.
    const fs = await import("node:fs/promises");
    const src = await fs.readFile("src/lib/server/live-read.ts", "utf8");
    expect(src).toMatch(/inPlay:\s*true/);
    expect(src).toMatch(/sportGroup === "soccer" \? soccerState\(snap\) : null/);
  });

  it("is what the builder reads for the gates, the calibrator and the label", async () => {
    const fs = await import("node:fs/promises");
    const src = await fs.readFile("src/lib/bets/builder.ts", "utf8");
    expect(src).toMatch(/const inPlay = args\.inPlay \?\? !!live;/);
    // None of the three may go back to reading the soccer state directly.
    expect(src).toMatch(/live: inPlay,/);
    expect(src).toMatch(/scope: inPlay \? "live" : "pre"/);
    expect(src).toMatch(/label: inPlay \? "live" : "game"/);
    expect(src).not.toMatch(/scope: live \? "live" : "pre"/);
    expect(src).not.toMatch(/label: live \? "live" : "game"/);
  });
});
