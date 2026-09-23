import { beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const DIR = path.join(process.cwd(), "data", "unit-ab");
process.env.DATA_DIR = DIR;
process.env.AUTH_SECRET = "test-secret-that-is-long-enough";
fs.rmSync(DIR, { recursive: true, force: true });

import type { LedgerEntry } from "@/lib/types";

const { AB_MIN_PER_ARM, armStats, beforeAfter, stakePolicyForDay, versionCompare } = await import("@/lib/ledger/ab");
const { promptFreeze, savePrompt, applyFeedback } = await import("@/lib/server/prompts");
const { getDb } = await import("@/lib/server/db");

/**
 * Before and after, with the courage to say "not yet". Every assertion here is about refusing an
 * answer the sample cannot carry — the failure mode this module exists to prevent.
 */

let n = 0;
function ticket(over: Partial<LedgerEntry> = {}): LedgerEntry {
  n += 1;
  return {
    id: `t${n}`, gameId: `g${n}`, sportKey: "wnba", matchup: "A @ B",
    createdAt: "2026-09-22T12:00:00.000Z", settledAt: "2026-09-22T23:00:00.000Z",
    bandKey: "safe", kind: "single", title: "t", combinedDecimal: 2, modelledProbability: 0.6,
    legs: [], outcome: "won", ...over,
  };
}
const many = (count: number, over: Partial<LedgerEntry>) => Array.from({ length: count }, () => ticket(over));

// Every comparison below is handed its entries explicitly; the freeze reads the real ledger, which
// under a fresh DATA_DIR is empty — exactly the state a new install is in.
beforeEach(() => { getDb().prepare("DELETE FROM prompt_versions").run(); });

describe("arm statistics", () => {
  it("counts only decided tickets and scores the calibration, not the luck", () => {
    const arm = armStats("a", [...many(3, { outcome: "won" }), ...many(1, { outcome: "lost" }), ...many(5, { outcome: "pending" })]);
    expect(arm.decided).toBe(4);
    expect(arm.won).toBe(3);
    expect(arm.hitRate).toBeCloseTo(0.75, 6);
    // Brier over 3 wins and 1 loss at p = 0.6.
    expect(arm.brier).toBeCloseTo((3 * 0.4 ** 2 + 0.6 ** 2) / 4, 6);
  });

  it("is all NaN rather than zero when nothing decided — an empty arm is not a 0 % arm", () => {
    const arm = armStats("a", many(3, { outcome: "pending" }));
    expect(arm.decided).toBe(0);
    expect(Number.isNaN(arm.hitRate)).toBe(true);
    expect(Number.isNaN(arm.roi)).toBe(true);
  });
});

describe("versionCompare", () => {
  it("refuses a verdict under the minimum per arm and says both counts out loud", () => {
    const out = versionCompare([...many(4, { promptVersion: "v1" }), ...many(4, { promptVersion: "v2" })], "v1", "v2");
    expect(out.verdict).toBe("insufficient");
    expect(out.note).toContain("amostra insuficiente");
    expect(out.note).toContain(String(AB_MIN_PER_ARM));
  });

  it("never counts an alternative in either arm", () => {
    const entries = [
      ...many(AB_MIN_PER_ARM, { promptVersion: "v1", modelledProbability: 0.9 }),
      ...many(AB_MIN_PER_ARM, { promptVersion: "v2", modelledProbability: 0.6 }),
      ...many(50, { promptVersion: "v1", alternativeOf: "t1", outcome: "lost" }),
    ];
    const out = versionCompare(entries, "v1", "v2");
    expect(out.a.decided).toBe(AB_MIN_PER_ARM);
    expect(out.b.decided).toBe(AB_MIN_PER_ARM);
  });

  it("gives the verdict to the lower Brier once both arms are big enough", () => {
    // Both arms win everything; the one that predicted it more confidently is better calibrated.
    const out = versionCompare(
      [...many(AB_MIN_PER_ARM, { promptVersion: "v1", modelledProbability: 0.95 }),
       ...many(AB_MIN_PER_ARM, { promptVersion: "v2", modelledProbability: 0.55 })],
      "v1", "v2",
    );
    expect(out.verdict).toBe("a");
  });

  it("calls a difference smaller than the noise a tie, not a winner", () => {
    const out = versionCompare(
      [...many(AB_MIN_PER_ARM, { promptVersion: "v1", modelledProbability: 0.9 }),
       ...many(AB_MIN_PER_ARM, { promptVersion: "v2", modelledProbability: 0.901 })],
      "v1", "v2",
    );
    expect(out.verdict).toBe("tie");
  });
});

describe("beforeAfter", () => {
  it("ignores tickets written before the version, however tempting they are", () => {
    const version = savePrompt({ kind: "game", lang: "pt", content: "x".repeat(300), source: "manual", createdBy: "admin" });
    const entries = [
      ...many(3, { createdAt: "2020-01-01T00:00:00.000Z" }),
      ...many(2, { createdAt: "2099-01-01T00:00:00.000Z" }),
    ];
    const out = beforeAfter(version.id, entries, 1);
    expect(out.a.decided).toBe(3);
    expect(out.b.decided).toBe(2);
    expect(out.appliedAt).toBe(version.createdAt);
  });

  it("returns an insufficient comparison, never a throw, for a version that is not there", () => {
    const out = beforeAfter("nope", many(5, {}));
    expect(out.verdict).toBe("insufficient");
    expect(out.appliedAt).toBeNull();
  });
});

describe("the freeze on applying two rules in one window", () => {
  it("is open while there is no version to protect", () => {
    expect(promptFreeze("game").frozen).toBe(false);
  });

  it("closes right after a version is written, and names what it is waiting for", () => {
    savePrompt({ kind: "game", lang: "pt", content: "x".repeat(300), source: "feedback", createdBy: "admin" });
    const freeze = promptFreeze("game");
    expect(freeze.frozen).toBe(true);
    expect(freeze.note).toContain("ininterpretáveis");
  });

  it("opens again on the clock, so it cannot deadlock on a ledger that never fills", () => {
    savePrompt({ kind: "game", lang: "pt", content: "x".repeat(300), source: "feedback", createdBy: "admin" });
    const later = new Date(Date.now() + 8 * 86_400_000);
    expect(promptFreeze("game", later).frozen).toBe(false);
  });

  it("blocks the second application in the window and lets an override through, signed", async () => {
    const rewrite = async () => ({ pt: "p".repeat(300), en: "e".repeat(300), rationale: "r" });
    await applyFeedback({ kind: "game", feedback: "primeira", createdBy: "admin" }, rewrite);
    await expect(applyFeedback({ kind: "game", feedback: "segunda", createdBy: "admin" }, rewrite)).rejects.toThrow(/ininterpretáveis/);

    const forced = await applyFeedback({ kind: "game", feedback: "segunda", createdBy: "admin", override: true }, rewrite);
    expect(forced.freeze.frozen).toBe(true);
    expect(forced.versions.every((v) => v.createdBy.includes("override"))).toBe(true);
  });
});

describe("the stake A/B arm", () => {
  it("alternates by day and is deterministic", () => {
    expect(stakePolicyForDay("2026-09-22")).toBe("formula");
    expect(stakePolicyForDay("2026-09-23")).toBe("escada");
    expect(stakePolicyForDay("2026-09-22")).toBe("formula");
  });
});
