import { getDb, newId, nowIso } from "@/lib/server/db";
import { readLedger } from "@/lib/ledger/store";
import { calibrationPrompt } from "@/lib/ledger/calibrate";
import { latestFactorStats } from "@/lib/server/factors-job";
import { budgetState } from "@/lib/server/ai-budget";
import { aiConfigured, describeAiError } from "@/lib/ai/client";
import { lastUsage } from "@/lib/ai/extract";
import { aiRewrite, type RewriteFn } from "@/lib/server/prompts";
import { keysAlreadyRun, oncePerKey } from "@/lib/server/job-guard";
import { logEvent, reportError } from "@/lib/server/ops-log";
import { filePromptProposal, fileCodeGates } from "@/lib/ledger/file-proposal";
import { recentRejections, type ProposalRow } from "@/lib/ledger/proposals";
import { aiPostMortem, citedLessons, summariseWindow, type LearningRunRow, type Lesson, type PostMortemFn } from "@/lib/ledger/learn";
import { proposeFromLesson } from "@/lib/ledger/hypotheses";
import { envValue } from "@/lib/env";
import type { LedgerEntry } from "@/lib/types";

/**
 * Learning at the end of each game, instead of once a day over a window.
 *
 * The owner's sentence was "ele deve aprender a cada fim de jogo, a cada bilhete liquidado". Per
 * BILLET it cannot be: one ticket is noise, and a judgement call costs real money — a night of five
 * games would be forty calls instead of five, to read forty samples of one. Per GAME is the unit
 * that has a story in it: the same player across several tickets, the same market across several
 * bands, one set of conditions.
 *
 * The trigger is the same shape as `onceADay`, with the key moved from the day to the game
 * (job-guard.ts `oncePerKey`): the answer to "has this game been read?" lives in `job_runs`, so it
 * survives a restart. A game is read once its tickets have all settled — while one is still pending
 * the night is not over and the post-mortem would be reading half a result.
 */

export const GAME_LEARN_JOB = "learn-game";

/** The environment switch. Anything but "0" leaves it on, so it is turned off without a deploy. */
export const gameLearnEnabled = (env: Record<string, string | undefined> = process.env): boolean =>
  envValue("LEARN_PER_GAME", env) !== "0";

const numberFrom = (raw: string, fallback: number): number => {
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

/**
 * Games read per tick. The scheduler ticks every 15 minutes, so two per tick clears a normal
 * ten-game night inside an hour and a half while keeping one tick's worth of spend bounded — and the
 * daily ceiling (AI_DAILY_BUDGET_USD) is checked before every one of them regardless.
 */
export const gameLearnMaxPerTick = (env: Record<string, string | undefined> = process.env): number =>
  numberFrom(envValue("LEARN_GAME_MAX_PER_TICK", env), 2);

/** How far back a finished game is still worth a post-mortem. Older than this and the night is gone. */
export const gameLearnLookbackHours = (env: Record<string, string | undefined> = process.env): number =>
  numberFrom(envValue("LEARN_GAME_LOOKBACK_HOURS", env), 36);

/** Settled tickets a game needs before it is worth a model call. One ticket is a coin flip. */
export const GAME_MIN_TICKETS = 3;

export interface GameCandidate {
  gameId: string;
  matchup: string;
  sportKey: string;
  settled: number;
  decided: number;
  pending: number;
  lastSettledAt: string;
}

/**
 * The games whose tickets have finished settling, newest-settled last so nothing starves.
 *
 * A game with anything still pending is left alone: `settlePending` holds a leg whose boxscore has
 * not published yet, and a post-mortem written over the half of the ticket that did settle would
 * read a loss into a game that has not finished being graded.
 */
export function gamesReadyToLearn(
  entries: LedgerEntry[],
  opts: { now?: Date; lookbackHours?: number; minTickets?: number } = {},
): GameCandidate[] {
  const now = opts.now ?? new Date();
  const floor = new Date(now.getTime() - (opts.lookbackHours ?? gameLearnLookbackHours()) * 3_600_000).toISOString();
  const minTickets = opts.minTickets ?? GAME_MIN_TICKETS;

  const byGame = new Map<string, GameCandidate>();
  for (const entry of entries) {
    const row = byGame.get(entry.gameId) ?? {
      gameId: entry.gameId, matchup: entry.matchup, sportKey: entry.sportKey,
      settled: 0, decided: 0, pending: 0, lastSettledAt: "",
    };
    if (entry.outcome === "pending") row.pending += 1;
    else {
      row.settled += 1;
      if (entry.outcome === "won" || entry.outcome === "lost") row.decided += 1;
      if (entry.settledAt && entry.settledAt > row.lastSettledAt) row.lastSettledAt = entry.settledAt;
    }
    byGame.set(entry.gameId, row);
  }

  return [...byGame.values()]
    .filter((g) => !g.pending && g.settled >= minTickets && g.lastSettledAt > floor)
    .sort((a, b) => a.lastSettledAt.localeCompare(b.lastSettledAt));
}

export interface GameLearnDeps {
  postMortem?: PostMortemFn;
  rewrite?: RewriteFn;
}

/** What one game's post-mortem produced, beyond the stored run row. */
export interface GameLearnResult {
  run: LearningRunRow;
  proposals: ProposalRow[];
  costUsd: number;
}

const cost = () => lastUsage?.costUsd ?? 0;

/** A gate already in the queue for the same measured slice is not filed twice every night. */
function gateAlreadyFiled(gate: string, factorStatId: string): boolean {
  return !!getDb().prepare(
    "SELECT 1 FROM learning_proposals WHERE channel='code_gate' AND gate=? AND factorStatId=? AND status IN ('code_gate','rejected') LIMIT 1",
  ).get(gate, factorStatId);
}

/**
 * Reads one finished game and files what it found. Nothing here changes the prompt: every outcome is
 * a row waiting for a person, which is the whole point of the redesign.
 */
export async function runGameLearning(game: GameCandidate, deps: GameLearnDeps = {}): Promise<GameLearnResult> {
  const postMortem = deps.postMortem ?? aiPostMortem;
  const rewrite = deps.rewrite ?? aiRewrite;
  const db = getDb();
  const id = newId("lr");
  const entries = readLedger().filter((e) => e.gameId === game.gameId && e.outcome !== "pending");
  const summary = summariseWindow(entries);
  const windowStart = entries.reduce((a, e) => (e.createdAt < a ? e.createdAt : a), entries[0]?.createdAt ?? nowIso());
  const windowEnd = game.lastSettledAt || nowIso();

  const insertSkipped = (status: "skipped" | "error", note: string): LearningRunRow => {
    db.prepare("INSERT INTO learning_runs (id,status,windowStart,windowEnd,tickets,won,lost,note,gameId,matchup,createdAt) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
      .run(id, status, windowStart, windowEnd, summary.tickets, summary.won, summary.lost, note.slice(0, 500), game.gameId, game.matchup, nowIso());
    return db.prepare("SELECT * FROM learning_runs WHERE id=?").get(id) as LearningRunRow;
  };

  if (summary.tickets < GAME_MIN_TICKETS) {
    return { run: insertSkipped("skipped", `${summary.tickets} bilhete(s) liquidado(s) neste jogo — mínimo ${GAME_MIN_TICKETS}.`), proposals: [], costUsd: 0 };
  }
  const budget = budgetState();
  if (budget.exhausted) {
    return { run: insertSkipped("skipped", `Orçamento de IA do dia esgotado ($${budget.spent.toFixed(2)} de $${budget.budget.toFixed(2)}); o jogo fica na fila.`), proposals: [], costUsd: 0 };
  }
  if (!aiConfigured()) {
    return { run: insertSkipped("skipped", "IA não configurada; nada foi gasto."), proposals: [], costUsd: 0 };
  }

  try {
    const factors = latestFactorStats(200);
    const byId = new Map(factors.map((f) => [f.id, f]));
    const pm = await postMortem({
      summary, entries, calibration: calibrationPrompt(), factors,
      rejections: recentRejections(8),
      scope: `um único jogo — ${game.matchup} (${game.sportKey}), ${summary.tickets} bilhete(s) liquidado(s). Não generalize para além do que estes bilhetes e os FATORES ACESOS sustentam.`,
    });
    let spent = cost();

    const cited = citedLessons(pm.lessons, byId);
    const proposals: ProposalRow[] = [];

    // The prompt proposal is read FIRST, so that when it and one of the lessons are the same thought
    // about the same slice — which is the normal case, since the feedback is usually one lesson made
    // actionable — the one that owns the hypothesis is the one that can be applied. Reversed, the
    // lesson would take the fingerprint and the proposal would come back a duplicate of itself.
    const origin = { gameId: game.gameId, matchup: game.matchup, sportKey: game.sportKey };
    const prompt = await filePromptProposal({ pm, factors: byId, runId: id, origin, tickets: summary.tickets, rewrite });
    spent += prompt.costUsd;
    if (prompt.proposal) proposals.push(prompt.proposal);

    const hypotheses = byId.size ? cited.map((l: Lesson) => proposeFromLesson(l, byId.get(l.factorStatId)!, id)) : [];

    // A lesson the code can check is not advice, it is an unbuilt gate: it goes to the queue as work
    // for a person, never as a sentence added to a prompt that already says it and is ignored.
    proposals.push(...fileCodeGates({
      lessons: cited, factors: byId, runId: id, origin, tickets: summary.tickets,
      hypothesisIdFor: (factorStatId) => hypotheses.find((h) => h.factorStatId === factorStatId)?.id ?? null,
      alreadyFiled: gateAlreadyFiled,
    }));

    const report = {
      ...pm,
      lessons: cited.map((l: Lesson) => l.text),
      factors: cited.map((l: Lesson) => byId.get(l.factorStatId)!),
      proposals: hypotheses,
      queued: proposals.map((p) => ({ id: p.id, channel: p.channel, gate: p.gate, status: p.status, decided: p.decided })),
      dropped: (pm.lessons ?? []).length - cited.length,
      byMarket: summary.byMarket,
      bySource: summary.bySource,
    };
    const note = [
      prompt.note,
      byId.size ? "" : "Nenhum fator tinha amostra suficiente nesta rodada, então a citação não foi exigida.",
      proposals.length ? `${proposals.length} item(ns) na fila do operador.` : "Nada foi para a fila.",
    ].filter(Boolean).join(" ");

    db.prepare("INSERT INTO learning_runs (id,status,windowStart,windowEnd,tickets,won,lost,summary,report,promptFeedback,applied,appliedBatch,costUsd,note,gameId,matchup,createdAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .run(id, "ok", windowStart, windowEnd, summary.tickets, summary.won, summary.lost, pm.summary, JSON.stringify(report),
        prompt.proposal?.channel === "prompt" ? prompt.proposal.feedback : "", 0, "", spent, note, game.gameId, game.matchup, nowIso());

    return { run: db.prepare("SELECT * FROM learning_runs WHERE id=?").get(id) as LearningRunRow, proposals, costUsd: spent };
  } catch (error) {
    // The run is filed with what broke, so the panel shows it — and then it is re-thrown, because
    // `oncePerKey` must NOT record the game as read. A post-mortem that died on a timeout is a game
    // nobody has learnt from yet, and swallowing the throw here would retire it in silence. The
    // retry is bounded by the lookback: once the game falls out of the window it stops being a
    // candidate, so a game that fails for ever costs a handful of attempts rather than an open tab.
    const run = insertSkipped("error", describeAiError(error) ?? (error instanceof Error ? error.message : "falhou"));
    throw Object.assign(error instanceof Error ? error : new Error(run.note), { learningRun: run });
  }
}

export interface GameLearnJobResult {
  status: "ok" | "off" | "budget" | "idle";
  games: number;
  ready: number;
  proposals: number;
  costUsd: number;
  note: string;
  rows: { gameId: string; matchup: string; status: string; proposals: number }[];
}

/**
 * The scheduler's entry point: read whichever finished games have not been read yet, up to the
 * per-tick cap, and stop as soon as the day's AI ceiling is reached. Called every tick; it decides
 * for itself what is left to do, from `job_runs`, the way the daily jobs do.
 */
export async function runGameLearningJob(opts: { now?: Date; max?: number; force?: string } = {}, deps: GameLearnDeps = {}): Promise<GameLearnJobResult> {
  const empty = { games: 0, proposals: 0, costUsd: 0, rows: [] as GameLearnJobResult["rows"] };
  if (!gameLearnEnabled()) return { status: "off", ready: 0, note: "LEARN_PER_GAME=0: o aprendizado por jogo está desligado.", ...empty };

  const candidates = gamesReadyToLearn(readLedger(), { now: opts.now });
  const done = keysAlreadyRun(GAME_LEARN_JOB);
  const queue = opts.force
    ? candidates.filter((g) => g.gameId === opts.force)
    : candidates.filter((g) => !done.has(g.gameId));
  if (!queue.length) {
    return { status: "idle", ready: candidates.length, note: `${candidates.length} jogo(s) já lido(s); nenhum novo.`, ...empty };
  }

  const max = opts.max ?? gameLearnMaxPerTick();
  const out: GameLearnJobResult = { status: "ok", games: 0, ready: candidates.length, proposals: 0, costUsd: 0, note: "", rows: [] };

  for (const game of queue.slice(0, max)) {
    if (budgetState().exhausted) {
      out.status = "budget";
      out.note = "Orçamento de IA do dia esgotado; os jogos restantes ficam na fila para o próximo tique.";
      break;
    }
    // One game's failure is that game's failure: the tick goes on to the next one, and the game it
    // failed on stays a candidate until the lookback closes.
    let once: Awaited<ReturnType<typeof oncePerKey<GameLearnResult>>>;
    try {
      once = await oncePerKey(GAME_LEARN_JOB, game.gameId, () => runGameLearning(game, deps), { force: !!opts.force });
    } catch (error) {
      reportError("job.learn-game", error, { gameId: game.gameId, matchup: game.matchup });
      out.rows.push({ gameId: game.gameId, matchup: game.matchup, status: "error", proposals: 0 });
      continue;
    }
    if (!once.ran || !once.result) continue;
    out.games += 1;
    out.proposals += once.result.proposals.length;
    out.costUsd += once.result.costUsd;
    out.rows.push({ gameId: game.gameId, matchup: game.matchup, status: once.result.run.status, proposals: once.result.proposals.length });
  }

  logEvent("job.learn-game", { games: out.games, ready: out.ready, proposals: out.proposals, costUsd: out.costUsd, status: out.status });
  return out;
}
