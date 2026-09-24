import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import type { LedgerEntry } from "@/lib/types";

const DIR = path.join(process.cwd(), "data", "unit-learn");
process.env.DATA_DIR = DIR; process.env.AUTH_SECRET = "test-secret-that-is-long-enough";
fs.rmSync(DIR, { recursive: true, force: true });
const { settledInWindow, summariseWindow, runLearning, listLearningRuns } = await import("@/lib/ledger/learn");
const { getPrompt, listPromptVersions } = await import("@/lib/server/prompts");
const { listProposals } = await import("@/lib/ledger/proposals");

const entry = (id: string, outcome: LedgerEntry["outcome"], settledAt: string, legs: [string, string, "won" | "lost"][]): LedgerEntry => ({
  id, gameId: "g1", sportKey: "soccer-bra", matchup: "A @ B", createdAt: settledAt, settledAt, bandKey: "value", kind: "parlay", title: id,
  combinedDecimal: 3, modelledProbability: 0.4, outcome,
  legs: legs.map(([selection, source, o]) => ({ selection, market: "total", sourceBasis: source, predictedProbability: 0.68, oddsDecimal: 1.6, outcome: o })),
});
const now = "2026-09-16T12:00:00.000Z";
const ledger = [
  entry("t1", "lost", "2026-09-16T02:00:00.000Z", [["over 4.5 cards", "referee", "lost"], ["home win", "book line", "won"]]),
  entry("t2", "lost", "2026-09-16T02:10:00.000Z", [["over 4.5 cards", "referee", "lost"]]),
  entry("t3", "won", "2026-09-16T03:00:00.000Z", [["home win", "book line", "won"]]),
  entry("old", "lost", "2026-09-10T03:00:00.000Z", [["x", "referee", "lost"]]),
  entry("pending", "pending", "", [["y", "referee", "won"]]),
];
fs.mkdirSync(path.join(DIR, "ledger"), { recursive: true });
fs.writeFileSync(path.join(DIR, "ledger", "predictions.jsonl"), ledger.map((e) => JSON.stringify(e)).join("\n") + "\n");

describe("learning window", () => {
  it("keeps only tickets settled inside the window", () => {
    const w = settledInWindow(ledger, "2026-09-15T12:00:00.000Z", now);
    expect(w.map((e) => e.id)).toEqual(["t1", "t2", "t3"]);
  });
  it("summarises by market and source and lists the lost legs", () => {
    const s = summariseWindow(settledInWindow(ledger, "2026-09-15T12:00:00.000Z", now));
    expect([s.tickets, s.won, s.lost]).toEqual([3, 1, 2]);
    expect(s.bySource.referee).toEqual({ won: 0, lost: 2 });
    expect(s.bySource["book line"]).toEqual({ won: 2, lost: 0 });
    expect(s.lostLegs.map((l) => l.selection)).toEqual(["over 4.5 cards", "over 4.5 cards"]);
  });
});

describe("runLearning", () => {
  it("skips when the sample is too small, spending nothing", async () => {
    const r = await runLearning({ now: new Date(now), minTickets: 10 }, async () => { throw new Error("must not be called"); });
    expect(r.status).toBe("skipped");
  });
  it("files the post-mortem in the operator's queue and changes nothing by itself", async () => {
    const before = getPrompt("game", "pt");
    const r = await runLearning({ now: new Date(now) }, async ({ summary }) => ({
      summary: `${summary.lost} perdidos por cartão`, wentRight: ["book line 2/2"], wentWrong: ["cartões pelo árbitro 0/2"],
      lessons: [{ factorStatId: "", text: "ancorar cartões nas taxas dos times" }], promptFeedback: "Não use média do árbitro sozinha para cartões.",
      promptFeedbackFactorStatId: "", confidence: "medium",
    }), async () => { throw new Error("must not be called"); });

    expect(r.status).toBe("ok"); expect(r.applied).toBe(0);
    expect(listLearningRuns().some((x) => x.id === r.id)).toBe(true);
    // no factor has a sample on this ledger, so the proposal is filed under the gate rather than
    // offered — and the rewrite is never called, because a proposal nobody can approve costs nothing
    const filed = listProposals().find((p) => p.runId === r.id)!;
    expect(filed.status).toBe("under_gate");
    expect(filed.matchup).toBe("janela de 24h");
    expect(getPrompt("game", "pt")).toBe(before);
    expect(listPromptVersions("game")).toEqual([]);
  });
  it("proposes nothing when the post-mortem found nothing to change", async () => {
    const r = await runLearning({ now: new Date(now) }, async () => ({ summary: "s", wentRight: [], wentWrong: [], lessons: [], promptFeedback: "", promptFeedbackFactorStatId: "", confidence: "low" }));
    expect(r.applied).toBe(0); expect(r.promptFeedback).toBe("");
    expect(listProposals().filter((p) => p.runId === r.id)).toEqual([]);
  });
});
