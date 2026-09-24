import { beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import type { LedgerEntry, SettledLeg } from "@/lib/types";

const DIR = path.join(process.cwd(), "data", "unit-learning-loop");
process.env.DATA_DIR = DIR;
process.env.AUTH_SECRET = "test-secret-that-is-long-enough";
// The model is injected in every test below; AI_MOCK is what makes `aiConfigured()` true without a
// key, so the job does not skip for the one reason it would skip on a developer machine.
process.env.AI_MOCK = "1";
fs.rmSync(DIR, { recursive: true, force: true });

const { getDb, nowIso } = await import("@/lib/server/db");
const { runGameLearning, runGameLearningJob, gamesReadyToLearn } = await import("@/lib/ledger/game-learn");
const { approveProposal, rejectProposal, listProposals, openProposals, recentRejections, LEARN_MIN_DECIDED } = await import("@/lib/ledger/proposals");
const { runRevertCheck, measureApplied } = await import("@/lib/ledger/revert");
const { getPrompt, getPromptVersion, listPromptVersions } = await import("@/lib/server/prompts");
const { listHypotheses } = await import("@/lib/ledger/hypotheses");
const { DEFAULT_PROMPTS } = await import("@/lib/bets/prompt-defaults");

/**
 * The loop end to end, with the model replaced by fixtures: a finished game is read once, what it
 * found lands in a queue, and NOTHING reaches the live prompt without a click. Every brake the owner
 * asked for has a test here, because each of them is the difference between a loop that is safe to
 * leave running and one that rewrites itself at night.
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
    id: `t${n}`, gameId: "g1", sportKey: "wnba", matchup: "Dallas @ Phoenix",
    createdAt: "2026-09-20T12:00:00.000Z", settledAt: "2026-09-20T23:00:00.000Z",
    bandKey: "safe", kind: "single", title: `bilhete ${n}`, combinedDecimal: 1.6, modelledProbability: 0.7,
    legs: [leg("lost")], outcome: "lost", ...over,
  };
}

/** The ledger is a JSONL file on disk, so the fixture is that file — an EMPTY one is not a missing one. */
function seedLedger(entries: LedgerEntry[]): void {
  fs.mkdirSync(path.join(DIR, "ledger"), { recursive: true });
  fs.writeFileSync(path.join(DIR, "ledger", "predictions.jsonl"), entries.map((e) => JSON.stringify(e)).join("\n") + "\n", "utf8");
}

/** A measured factor the post-mortem can cite. `legs` is what the sample gate reads. */
function seedFactor(id: string, over: { dim?: string; value?: string; legs?: number } = {}): void {
  getDb().prepare(
    `INSERT INTO factor_stats (runId,id,scope,dim,value,legs,won,games,days,hitRate,predicted,gap,ciLow,ciHigh,pValue,qValue,flagged,computedAt,codeVersion)
     VALUES ('run1',?,'pregame-main',?,?,?,10,4,3,0.30,0.70,0.40,0.18,0.46,0.001,0.01,1,?,'factors-1')`,
  ).run(id, over.dim ?? "stat", over.value ?? "PRA", over.legs ?? 40, nowIso());
}

const GAME = { gameId: "g1", matchup: "Dallas @ Phoenix", sportKey: "wnba", settled: 4, decided: 4, pending: 0, lastSettledAt: "2026-09-20T23:00:00.000Z" };

const postMortem = (feedback: string, factorStatId: string, lessons: { factorStatId: string; text: string }[] = []) => async () => ({
  summary: "quatro bilhetes, quatro derrotas na mesma linha", wentRight: [], wentWrong: ["a mesma linha em todos"],
  lessons, promptFeedback: feedback, promptFeedbackFactorStatId: factorStatId, confidence: "medium" as const,
});

/** The rewriter is deterministic here: the proposal's text is appended, so the diff is one line. */
const rewrite = async ({ current, feedback }: { current: { pt: string; en: string }; feedback: string }) => ({
  pt: `${current.pt}\n\nREGRA NOVA: ${feedback}`,
  en: `${current.en}\n\nNEW RULE: ${feedback}`,
  rationale: "Acrescentei uma regra ao fim do prompt, sem tocar no resto.",
});

beforeEach(() => {
  seedLedger([]);
  for (const table of ["job_runs", "rule_hypotheses", "factor_stats", "prompt_versions", "learning_runs", "learning_proposals", "leg_attribution", "ai_usage"]) {
    getDb().prepare(`DELETE FROM ${table}`).run();
  }
});

describe("the per-game trigger", () => {
  it("waits for the game to finish settling: one pending ticket and the night is not over", () => {
    seedLedger([ticket(), ticket(), ticket(), ticket({ outcome: "pending", settledAt: undefined })]);
    expect(gamesReadyToLearn(JSON.parse("[]"))).toEqual([]);
    const ready = gamesReadyToLearn([ticket(), ticket(), ticket()], { now: new Date("2026-09-21T02:00:00.000Z") });
    expect(ready.map((g) => g.gameId)).toEqual(["g1"]);
    const held = gamesReadyToLearn([ticket(), ticket(), ticket(), ticket({ outcome: "pending", settledAt: undefined })], { now: new Date("2026-09-21T02:00:00.000Z") });
    expect(held).toEqual([]);
  });

  it("does not spend a model call on a game with one or two tickets", () => {
    const ready = gamesReadyToLearn([ticket(), ticket()], { now: new Date("2026-09-21T02:00:00.000Z") });
    expect(ready).toEqual([]);
  });

  it("leaves a game older than the lookback alone: that night is gone", () => {
    const ready = gamesReadyToLearn([ticket(), ticket(), ticket()], { now: new Date("2026-10-30T02:00:00.000Z") });
    expect(ready).toEqual([]);
  });

  it("reads each game exactly once, however many times the scheduler calls", async () => {
    seedLedger([ticket(), ticket(), ticket()]);
    seedFactor("f1");
    let calls = 0;
    const deps = { postMortem: (async () => { calls += 1; return (await postMortem("mude isso", "f1")()); }) as never, rewrite: rewrite as never };
    const opts = { now: new Date("2026-09-21T02:00:00.000Z") };
    await runGameLearningJob(opts, deps);
    await runGameLearningJob(opts, deps);
    await runGameLearningJob(opts, deps);
    expect(calls).toBe(1);
  });

  it("the environment switch stops it dead, without a deploy", async () => {
    process.env.LEARN_PER_GAME = "0";
    const out = await runGameLearningJob({ now: new Date("2026-09-21T02:00:00.000Z") }, { postMortem: (async () => { throw new Error("must not be called"); }) as never });
    delete process.env.LEARN_PER_GAME;
    expect(out.status).toBe("off");
  });
});

describe("what a proposal has to prove before it is even offered", () => {
  beforeEach(() => seedLedger([ticket(), ticket(), ticket(), ticket()]));

  it("offers a proposal backed by 20 decided lines or more, with the exact text it would apply", async () => {
    seedFactor("f1", { legs: 40 });
    const before = getPrompt("game", "pt");
    const out = await runGameLearning(GAME, { postMortem: postMortem("Ancore o total nas taxas dos próprios times.", "f1") as never, rewrite: rewrite as never });

    expect(out.run.status).toBe("ok");
    const [proposal] = out.proposals;
    expect(proposal.status).toBe("pending");
    expect(proposal.channel).toBe("prompt");
    expect(proposal.decided).toBe(40);
    expect(proposal.gameId).toBe("g1");
    expect(proposal.contentPt).toContain("Ancore o total nas taxas dos próprios times.");
    // and the prompt has not moved: a proposal is not a change
    expect(getPrompt("game", "pt")).toBe(before);
    expect(listPromptVersions("game")).toEqual([]);
  });

  it("records a proposal below the sample gate instead of offering it, and spends nothing rewriting it", async () => {
    seedFactor("f1", { legs: LEARN_MIN_DECIDED - 1 });
    const out = await runGameLearning(GAME, {
      postMortem: postMortem("uma regra tirada de pouca coisa", "f1") as never,
      rewrite: (async () => { throw new Error("must not be called"); }) as never,
    });
    const [proposal] = out.proposals;
    expect(proposal.status).toBe("under_gate");
    expect(proposal.contentPt).toBe("");
    expect(proposal.reason).toContain(`${LEARN_MIN_DECIDED}`);
    expect(openProposals().filter((p) => p.status === "pending")).toEqual([]);
  });

  it("a rule the code can check never becomes prompt text, whatever its sample", async () => {
    seedFactor("f1", { legs: 400, dim: "athleteId", value: "4433728" });
    const out = await runGameLearning(GAME, {
      postMortem: postMortem("Nunca ponha a mesma jogadora em mais de 3 bilhetes.", "f1") as never,
      rewrite: (async () => { throw new Error("must not be called"); }) as never,
    });
    const [proposal] = out.proposals;
    expect(proposal.channel).toBe("code_gate");
    expect(proposal.gate).toBe("player_concentration");
    expect(proposal.status).toBe("code_gate");
    // and there is no click that turns it into one
    expect(approveProposal(proposal.id, "admin@betmatic.app").ok).toBe(false);
    expect(approveProposal(proposal.id, "admin@betmatic.app").error).toMatch(/portão de código/);
  });

  it("drops a proposal that cites no measured factor, when there are factors to cite", async () => {
    seedFactor("f1", { legs: 40 });
    const out = await runGameLearning(GAME, { postMortem: postMortem("uma opinião sem número", "") as never, rewrite: rewrite as never });
    expect(out.proposals).toEqual([]);
    expect(out.run.note).toContain("não citou um fator medido");
  });
});

describe("the operator's click", () => {
  const admin = "admin@betmatic.app";

  async function offer(feedback = "Ancore o total nas taxas dos próprios times.") {
    seedFactor("f1", { legs: 40 });
    const out = await runGameLearning(GAME, { postMortem: postMortem(feedback, "f1") as never, rewrite: rewrite as never });
    return out.proposals[0];
  }

  beforeEach(() => seedLedger([ticket(), ticket(), ticket(), ticket()]));

  it("approving applies exactly the text that was shown, in both languages", async () => {
    const proposal = await offer();
    const out = approveProposal(proposal.id, admin);
    expect(out.ok).toBe(true);
    expect(getPrompt("game", "pt")).toBe(proposal.contentPt);
    expect(getPrompt("game", "en")).toContain("NEW RULE:");
    expect(listPromptVersions("game").map((v) => v.lang).sort()).toEqual(["en", "pt"]);
    expect(listProposals().find((p) => p.id === proposal.id)?.status).toBe("applied");
  });

  it("caps the change at one version a day, and the cap has no override", async () => {
    const first = await offer();
    expect(approveProposal(first.id, admin).ok).toBe(true);

    // a second game, that same day, with its own measured slice
    seedLedger([ticket(), ticket(), ticket(), ...Array.from({ length: 4 }, () => ticket({ gameId: "g2" }))]);
    seedFactor("f2", { legs: 40, value: "PTS" });
    const second = (await runGameLearning({ ...GAME, gameId: "g2", matchup: "Indiana @ Seattle" }, { postMortem: postMortem("outra regra, sobre outra coisa", "f2") as never, rewrite: rewrite as never })).proposals[0];
    const blocked = approveProposal(second.id, admin, { override: true });
    expect(blocked.ok).toBe(false);
    expect(blocked.error).toMatch(/uma por dia/);
  });

  it("refuses to apply a text the prompt has moved out from under", async () => {
    const proposal = await offer();
    // someone else edits the prompt in between
    const { savePrompt } = await import("@/lib/server/prompts");
    savePrompt({ kind: "game", lang: "pt", content: `${DEFAULT_PROMPTS.game.pt}\n\nalgo à mão`, source: "manual", createdBy: "outro admin" });

    const out = approveProposal(proposal.id, admin);
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/mudou/);
    expect(listProposals().find((p) => p.id === proposal.id)?.status).toBe("stale");
  });

  it("refusing needs a reason, keeps it, and feeds it to the next post-mortem", async () => {
    const proposal = await offer();
    expect(rejectProposal(proposal.id, admin, "  ").ok).toBe(false);

    expect(rejectProposal(proposal.id, admin, "cartão não é o nosso mercado principal").ok).toBe(true);
    expect(listProposals().find((p) => p.id === proposal.id)?.status).toBe("rejected");
    expect(recentRejections()[0].reason).toBe("cartão não é o nosso mercado principal");
    expect(getPromptVersion("game", "pt").id).toBeNull();

    let seen: { feedback: string; reason: string }[] | undefined;
    seedLedger(Array.from({ length: 4 }, () => ticket({ gameId: "g3" })));
    seedFactor("f9", { legs: 40, value: "AST" });
    await runGameLearning({ ...GAME, gameId: "g3" }, {
      postMortem: (async (args: { rejections?: { feedback: string; reason: string }[] }) => {
        seen = args.rejections;
        return { summary: "s", wentRight: [], wentWrong: [], lessons: [], promptFeedback: "", promptFeedbackFactorStatId: "", confidence: "low" as const };
      }) as never,
    });
    expect(seen?.[0].reason).toBe("cartão não é o nosso mercado principal");
  });

  it("reads the sample again at the click, not the number it was proposed with", async () => {
    const proposal = await offer();
    expect(proposal.decided).toBe(40);
    // a later round of the factor report measures the same slice at far less
    getDb().prepare(
      `INSERT INTO factor_stats (runId,id,scope,dim,value,legs,won,games,days,hitRate,predicted,gap,ciLow,ciHigh,pValue,qValue,flagged,computedAt,codeVersion)
       VALUES ('run2','f1','pregame-main','stat','PRA',5,1,4,3,0.20,0.70,0.50,0.05,0.60,0.01,0.05,1,?,'factors-1')`,
    ).run(new Date(Date.now() + 60_000).toISOString());

    const out = approveProposal(proposal.id, admin);
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/5 linha/);
    expect(getPromptVersion("game", "pt").id).toBeNull();
  });

  it("marks the hypothesis applied, so the same idea is not proposed again tomorrow", async () => {
    const proposal = await offer();
    approveProposal(proposal.id, admin);
    expect(listHypotheses().some((h) => h.status === "applied")).toBe(true);
  });
});

describe("the safety net", () => {
  const admin = "admin@betmatic.app";

  /** `decided` tickets under `version`, half of them won, so the arm has a real Brier. */
  const armTickets = (version: string | undefined, count: number, wins: number, modelled: number) =>
    Array.from({ length: count }, (_, i) => ticket({
      id: `${version ?? "v0"}-${i}`, gameId: "gX", modelledProbability: modelled,
      outcome: i < wins ? "won" : "lost", legs: [leg(i < wins ? "won" : "lost")],
      ...(version ? { promptVersion: version } : {}),
    }));

  async function applyOne() {
    seedLedger([ticket(), ticket(), ticket(), ticket()]);
    seedFactor("f1", { legs: 40 });
    const proposal = (await runGameLearning(GAME, { postMortem: postMortem("uma regra qualquer", "f1") as never, rewrite: rewrite as never })).proposals[0];
    expect(approveProposal(proposal.id, admin).ok).toBe(true);
    return { proposal, versionId: getPromptVersion("game", "pt").id! };
  }

  it("says nothing at all while the sample cannot carry a verdict", async () => {
    const { versionId } = await applyOne();
    seedLedger([...armTickets(undefined, 10, 8, 0.7), ...armTickets(versionId, 10, 1, 0.7)]);
    const out = runRevertCheck();
    expect(out.reverted).toBe(0);
    expect(out.rows[0].verdict).toBe("insufficient");
    expect(out.rows[0].note).toMatch(/amostra insuficiente/);
  });

  it("rolls a version back on its own once both arms are above the gate", async () => {
    const { proposal, versionId } = await applyOne();
    const applied = getPrompt("game", "pt");
    // the previous arm was well calibrated; the applied one promised 70% and delivered 10%
    seedLedger([...armTickets(undefined, 25, 18, 0.7), ...armTickets(versionId, 25, 2, 0.7)]);

    const out = runRevertCheck();
    expect(out.reverted).toBe(1);
    expect(out.rows[0].verdict).toBe("reverted");
    expect(out.rows[0].note).toMatch(/abaixo da anterior/);
    // the prompt is back to what stood before, as a NEW version — nothing was deleted
    expect(getPrompt("game", "pt")).toBe(DEFAULT_PROMPTS.game.pt);
    expect(listPromptVersions("game").some((v) => v.content === applied)).toBe(true);
    expect(listPromptVersions("game").filter((v) => v.source === "revert")).toHaveLength(2);
    const row = listProposals().find((p) => p.id === proposal.id)!;
    expect(row.status).toBe("reverted");
    expect(row.reason).toMatch(/Revertida automaticamente/);
    expect(listHypotheses()[0].verdict).toBe("worse");
  });

  it("leaves a version that is ahead exactly where it is", async () => {
    const { versionId } = await applyOne();
    const applied = getPrompt("game", "pt");
    seedLedger([...armTickets(undefined, 25, 2, 0.7), ...armTickets(versionId, 25, 18, 0.7)]);
    const out = runRevertCheck();
    expect(out.reverted).toBe(0);
    expect(out.rows[0].verdict).toBe("ahead");
    expect(getPrompt("game", "pt")).toBe(applied);
  });

  it("reading the measurement never changes anything", async () => {
    const { versionId } = await applyOne();
    seedLedger([...armTickets(undefined, 25, 18, 0.7), ...armTickets(versionId, 25, 2, 0.7)]);
    const read = measureApplied();
    expect(read[0].verdict).toBe("worse");
    expect(listProposals().find((p) => p.status === "applied")).toBeTruthy();
  });
});
