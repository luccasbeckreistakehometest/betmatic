import { beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const DIR = path.join(process.cwd(), "data", "unit-jobs");
process.env.DATA_DIR = DIR;
process.env.AUTH_SECRET = "test-secret-that-is-long-enough";
fs.rmSync(DIR, { recursive: true, force: true });

import type { LedgerEntry, SettledLeg } from "@/lib/types";

const { alreadyRanToday, onceADay } = await import("@/lib/server/job-guard");
const { runLearning } = await import("@/lib/ledger/learn");
const { runEvaluateJob } = await import("@/lib/server/evaluate-job");
const { runAttributeJob } = await import("@/lib/server/factors-job");
const { proposeHypothesis, markApplied, listHypotheses } = await import("@/lib/ledger/hypotheses");
const { savePrompt } = await import("@/lib/server/prompts");
const { getDb } = await import("@/lib/server/db");

/**
 * The scheduler's own failure modes. The expensive one was real: `learn` was fired on
 * `[ $((t % 96)) -eq 95 ]`, `t` restarted with every container, and the product ran zero post-mortems
 * in its life while the five runs that did fire filed notes that said nothing.
 */

let n = 0;
const leg = (outcome: "won" | "lost"): SettledLeg => ({
  selection: "Bueckers o24.5 PRA", market: "player_prop", sourceBasis: "measured history",
  predictedProbability: 0.7, oddsDecimal: 1.6, outcome,
  settlement: { type: "player_prop", player: "Paige Bueckers", stat: "PRA", line: 24.5, side: "over", sourceBasis: "measured history" },
});
function ticket(over: Partial<LedgerEntry> = {}): LedgerEntry {
  n += 1;
  return {
    id: `t${n}`, gameId: `g${n % 4}`, sportKey: "wnba", matchup: "A @ B",
    createdAt: "2026-09-20T12:00:00.000Z", settledAt: "2026-09-20T23:00:00.000Z",
    bandKey: "safe", kind: "single", title: "t", combinedDecimal: 1.6, modelledProbability: 0.7,
    legs: [leg("lost")], outcome: "lost", ...over,
  };
}

/** The ledger is a JSONL file, and these jobs read it from disk — so the fixture is that file. */
function seedLedger(entries: LedgerEntry[]): void {
  fs.mkdirSync(path.join(DIR, "ledger"), { recursive: true });
  fs.writeFileSync(path.join(DIR, "ledger", "predictions.jsonl"), entries.map((e) => JSON.stringify(e)).join("\n") + "\n", "utf8");
}

beforeEach(() => {
  // An empty ledger is an EMPTY FILE, not a missing one. Deleting it let `migrateLegacy()` in
  // store.ts copy the developer's own `./.ledger/predictions.jsonl` in — this checkout has 22
  // tickets in it — so "the ledger is empty" quietly became "the ledger holds whoever ran this
  // machine last", and the suite passed or failed depending on the checkout rather than the code.
  fs.rmSync(path.join(DIR, "ledger"), { recursive: true, force: true });
  fs.mkdirSync(path.join(DIR, "ledger"), { recursive: true });
  fs.writeFileSync(path.join(DIR, "ledger", "predictions.jsonl"), "", "utf8");
  for (const table of ["job_runs", "rule_hypotheses", "leg_attribution", "factor_stats", "prompt_versions"]) {
    getDb().prepare(`DELETE FROM ${table}`).run();
  }
});

describe("once a day, decided by the database", () => {
  it("runs the first call and refuses the rest of the day", async () => {
    let calls = 0;
    const first = await onceADay("learn", () => { calls += 1; return "ok"; });
    expect(first.ran).toBe(true);
    for (let i = 0; i < 9; i += 1) await onceADay("learn", () => { calls += 1; return "ok"; });
    expect(calls).toBe(1);
    expect(alreadyRanToday("learn")).toBe(true);
  });

  it("runs anyway when a person forces it from the panel", async () => {
    let calls = 0;
    await onceADay("learn", () => { calls += 1; });
    await onceADay("learn", () => { calls += 1; }, { force: true });
    expect(calls).toBe(2);
  });

  it("files a failed run as an error and lets the next call retry", async () => {
    await expect(onceADay("learn", () => { throw new Error("boom"); })).rejects.toThrow("boom");
    // An errored run is not "today is done": the day is still unanswered.
    expect(alreadyRanToday("learn")).toBe(false);
    const row = getDb().prepare("SELECT status, note FROM job_runs WHERE job='learn' ORDER BY startedAt DESC LIMIT 1").get() as { status: string; note: string };
    expect(row).toMatchObject({ status: "error", note: "boom" });
  });

  it("counts a different job separately", async () => {
    await onceADay("learn", () => {});
    expect(alreadyRanToday("evaluate")).toBe(false);
  });
});

describe("learn on an empty window", () => {
  it("says why it skipped AND when the last ticket settled — the regression of the five mute runs", async () => {
    seedLedger([ticket({ settledAt: "2026-09-20T23:00:00.000Z" }), ticket({ settledAt: "2026-09-21T02:15:00.000Z" })]);
    // A window that is pointed a month past everything the ledger holds.
    const run = await runLearning({ now: new Date("2026-10-30T12:00:00.000Z"), minTickets: 3 }, async () => { throw new Error("must not be called"); });
    expect(run.status).toBe("skipped");
    expect(run.note).toContain("2026-09-21T02:15:00.000Z");
    expect(run.note).toContain("2 liquidado(s)");
  });

  it("says the ledger itself is empty when it is, instead of the same sentence either way", async () => {
    const run = await runLearning({ now: new Date("2026-10-30T12:00:00.000Z"), minTickets: 3 }, async () => { throw new Error("must not be called"); });
    expect(run.note).toContain("não tem nenhum bilhete liquidado");
  });
});

describe("learn and the citation rule", () => {
  const post = (lessons: { factorStatId: string; text: string }[], feedback = "", feedbackId = "") => async () => ({
    summary: "s", wentRight: [], wentWrong: [], lessons, promptFeedback: feedback, promptFeedbackFactorStatId: feedbackId, confidence: "medium" as const,
  });

  it("keeps working when no factor has a sample yet — the rule binds on a table that exists", async () => {
    seedLedger([ticket(), ticket(), ticket(), ticket()]);
    const run = await runLearning({ now: new Date("2026-09-21T00:00:00.000Z"), minTickets: 3 }, post([{ factorStatId: "", text: "regra sem fator" }], "mudar isso"));
    expect(run.status).toBe("ok");
    expect(run.promptFeedback).toBe("mudar isso");
    expect(run.note).toContain("citação não foi exigida");
  });

  it("drops the lesson and the proposal that cite nothing once factors exist", async () => {
    seedLedger(Array.from({ length: 40 }, (_, i) => ticket({ outcome: i < 8 ? "won" : "lost", legs: [leg(i < 8 ? "won" : "lost")], gameId: `g${i % 5}`, settledAt: `2026-09-${20 + (i % 3)}T23:00:00.000Z` })));
    runAttributeJob();
    const factor = getDb().prepare("SELECT id FROM factor_stats LIMIT 1").get() as { id: string } | undefined;
    expect(factor, "the attribute job should have produced at least one factor row").toBeTruthy();

    const run = await runLearning(
      { now: new Date("2026-09-23T00:00:00.000Z"), sinceHours: 96, minTickets: 3 },
      post([{ factorStatId: factor!.id, text: "com fator" }, { factorStatId: "ghost", text: "sem fator" }], "proposta", "ghost"),
    );
    const report = JSON.parse(run.report) as { lessons: string[]; dropped: number };
    expect(report.lessons).toEqual(["com fator"]);
    expect(report.dropped).toBe(1);
    // The feedback cited a row that does not exist, so it is not stored as a proposal at all.
    expect(run.promptFeedback).toBe("");
    expect(run.note).toContain("não citou um fator medido");
    // The surviving lesson became a hypothesis with the direction the measurement points in.
    expect(listHypotheses()).toHaveLength(1);
  });
});

describe("attribute", () => {
  it("is idempotent: running it ten times leaves one row per leg", () => {
    seedLedger([ticket(), ticket()]);
    const first = runAttributeJob();
    for (let i = 0; i < 9; i += 1) runAttributeJob();
    const rows = getDb().prepare("SELECT COUNT(*) AS n FROM leg_attribution").get() as { n: number };
    expect(rows.n).toBe(first.legs);
    expect(rows.n).toBe(2);
  });
});

describe("evaluate", () => {
  it("never evaluates a hypothesis with no prompt version behind it", () => {
    const h = proposeHypothesis({ dim: "stat", value: "PRA", direction: "lower", bucket: "pregame-main", factorStatId: "f1", text: "x" }, new Set(["f1"]));
    markApplied(h.hypothesis!.id, null, "admin");
    expect(runEvaluateJob()).toMatchObject({ evaluated: 0, skipped: 1 });
  });

  it("files inconclusive, not a percentage, while the sample is short", () => {
    seedLedger([ticket(), ticket()]);
    const version = savePrompt({ kind: "game", lang: "pt", content: "x".repeat(300), source: "manual", createdBy: "admin" });
    const h = proposeHypothesis({ dim: "stat", value: "PRA", direction: "lower", bucket: "pregame-main", factorStatId: "f1", text: "x" }, new Set(["f1"]));
    markApplied(h.hypothesis!.id, version.id, "admin");

    const out = runEvaluateJob();
    expect(out).toMatchObject({ evaluated: 1, inconclusive: 1 });
    const row = listHypotheses().find((x) => x.id === h.hypothesis!.id)!;
    expect(row.verdict).toBe("inconclusive");
    expect(row.verdictNote).toContain("amostra insuficiente");
    expect(row.evaluatedAt).toBeTruthy();
  });

  it("leaves a proposed hypothesis alone — only what was applied gets checked", () => {
    proposeHypothesis({ dim: "stat", value: "PTS", direction: "lower", bucket: "pregame-main", factorStatId: "f1", text: "x" }, new Set(["f1"]));
    expect(runEvaluateJob()).toMatchObject({ evaluated: 0, skipped: 0 });
  });
});
