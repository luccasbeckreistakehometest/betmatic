import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import type { BetSlate } from "@/lib/types";

const DIR = path.join(process.cwd(), "data", "unit-localise-backfill");
process.env.DATA_DIR = DIR; process.env.AUTH_SECRET = "test-secret-that-is-long-enough"; process.env.AI_MOCK = "1";
fs.rmSync(DIR, { recursive: true, force: true });

const { runLocaliseBackfill } = await import("@/lib/server/localise-backfill");
const { savePrediction, findPrediction } = await import("@/lib/server/predictions");

const slate: BetSlate = { suggestions: [], dataNote: "pt" };
const now = new Date("2026-09-22T15:00:00.000Z");

// The English copy of every game of 22/09/2026 failed on its output cap and nothing came back for it.
describe("the localisation backfill", () => {
  it("writes the derived language a generation left missing, once, and skips what already exists", async () => {
    savePrediction({ scope: "game", sportKey: "wnba", gameId: "g1", dateKey: "20260922", lang: "pt", matchup: "A @ B", startsAt: "2026-09-22T23:30:00.000Z", slate, costUsd: 1 });
    savePrediction({ scope: "game", sportKey: "wnba", gameId: "g2", dateKey: "20260922", lang: "pt", matchup: "C @ D", startsAt: "2026-09-23T00:00:00.000Z", slate, costUsd: 1 });
    savePrediction({ scope: "game", sportKey: "wnba", gameId: "g2", dateKey: "20260922", lang: "en", matchup: "C @ D", startsAt: "2026-09-23T00:00:00.000Z", slate: { ...slate, dataNote: "en" }, costUsd: 0 });
    // Last week's slate is not worth a call.
    savePrediction({ scope: "game", sportKey: "wnba", gameId: "old", dateKey: "20260915", lang: "pt", matchup: "E @ F", startsAt: "2026-09-15T23:00:00.000Z", slate, costUsd: 1 });
    const calls: string[] = [];
    const localise = async (s: BetSlate, from: string, to: string) => { calls.push(`${from}->${to}`); return { ...s, dataNote: `${to} copy` }; };
    const out = await runLocaliseBackfill({ now, localise });
    expect(out).toMatchObject({ status: "ok", missing: 1, written: 1 });
    expect(calls).toEqual(["pt->en"]);
    expect(JSON.parse(findPrediction({ scope: "game", sportKey: "wnba", gameId: "g1", dateKey: "20260922", lang: "en" })!.payload).dataNote).toBe("en copy");
    expect(await runLocaliseBackfill({ now, localise })).toMatchObject({ missing: 0, written: 0 });
    expect(calls).toHaveLength(1);
  });
});
