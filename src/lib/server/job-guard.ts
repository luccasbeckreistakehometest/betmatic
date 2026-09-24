import { getDb, newId, nowIso } from "@/lib/server/db";
import { brasiliaDay } from "@/lib/ledger/proof";

/**
 * "Once a day" that survives a restart.
 *
 * The bug this replaces was real and expensive: the scheduler ran the learning job on
 * `[ $((t % 96)) -eq 95 ]`, and `t` restarts at zero with the container. Every deploy pushed the
 * counter back before it ever reached 95, so the runs of 17, 22 and 23/09 — the deploy days — never
 * happened, and the five that did fire hit an empty window. Zero post-mortems in the life of the
 * product, from a counter held in a shell variable.
 *
 * The fix is to stop counting ticks and start asking the database, which is the only thing here that
 * outlives the process: the job is called every tick and decides for itself whether today is done.
 */

/** Brasília days, because that is the day the rest of the product means by "today". */
export function lastRunDay(job: string): string | null {
  const row = getDb().prepare("SELECT startedAt FROM job_runs WHERE job=? AND status<>'error' ORDER BY startedAt DESC LIMIT 1").get(job) as
    | { startedAt: string }
    | undefined;
  return row ? brasiliaDay(row.startedAt) : null;
}

export function alreadyRanToday(job: string, now = new Date()): boolean {
  return lastRunDay(job) === brasiliaDay(now.toISOString());
}

/** Opens a row before the work, so a crash mid-run is visible instead of silently retried forever. */
export function startJobRun(job: string): string {
  const id = newId("jr");
  getDb().prepare("INSERT INTO job_runs (id,job,status,startedAt) VALUES (?,?,?,?)").run(id, job, "running", nowIso());
  return id;
}

export function finishJobRun(id: string, status: "ok" | "error" | "skipped", note = "", counts: { gamesProcessed?: number; predictionsWritten?: number; costUsd?: number } = {}): void {
  getDb().prepare("UPDATE job_runs SET status=?, finishedAt=?, note=?, gamesProcessed=?, predictionsWritten=?, costUsd=? WHERE id=?")
    .run(status, nowIso(), note.slice(0, 500), counts.gamesProcessed ?? 0, counts.predictionsWritten ?? 0, counts.costUsd ?? 0, id);
}

/**
 * The same guard, keyed by something other than the day.
 *
 * The learning post-mortem stopped being a daily sweep and became one pass per GAME, so "has this
 * already run?" is no longer a question about today — it is a question about that game. The key is
 * folded into the job name (`learn-game:401857208`), which means one table, one guard and one place
 * a crash shows up, and it survives a restart for the same reason `onceADay` does: the answer lives
 * in the database and not in a counter inside the scheduler's shell.
 *
 * A run that ended in `error` does not count as done, so a game whose post-mortem failed on a
 * timeout is picked up again on the next tick instead of being written off in silence.
 */
export const jobKey = (job: string, key: string): string => `${job}:${key}`;

export function alreadyRanFor(job: string, key: string): boolean {
  return !!getDb().prepare("SELECT 1 FROM job_runs WHERE job=? AND status<>'error' LIMIT 1").get(jobKey(job, key));
}

/** Every key this job has already finished, for filtering a candidate list in one query. */
export function keysAlreadyRun(job: string): Set<string> {
  const prefix = `${job}:`;
  const rows = getDb().prepare("SELECT DISTINCT job FROM job_runs WHERE job LIKE ? AND status<>'error'").all(`${prefix}%`) as { job: string }[];
  return new Set(rows.map((r) => r.job.slice(prefix.length)));
}

export async function oncePerKey<T>(job: string, key: string, fn: () => Promise<T> | T, opts: { force?: boolean } = {}): Promise<{ ran: boolean; result: T | null; note: string }> {
  if (!opts.force && alreadyRanFor(job, key)) {
    return { ran: false, result: null, note: `job=${job} já rodou para ${key}` };
  }
  const id = startJobRun(jobKey(job, key));
  try {
    const result = await fn();
    finishJobRun(id, "ok");
    return { ran: true, result, note: "" };
  } catch (error) {
    finishJobRun(id, "error", error instanceof Error ? error.message : "falhou");
    throw error;
  }
}

/**
 * Runs `fn` at most once per Brasília day. `force` is the panel's button: an operator asking for it
 * now is not the scheduler asking for it again.
 */
export async function onceADay<T>(job: string, fn: () => Promise<T> | T, opts: { force?: boolean; now?: Date } = {}): Promise<{ ran: boolean; result: T | null; note: string }> {
  if (!opts.force && alreadyRanToday(job, opts.now)) {
    return { ran: false, result: null, note: `job=${job} já rodou hoje (${lastRunDay(job)})` };
  }
  const id = startJobRun(job);
  try {
    const result = await fn();
    finishJobRun(id, "ok");
    return { ran: true, result, note: "" };
  } catch (error) {
    finishJobRun(id, "error", error instanceof Error ? error.message : "falhou");
    throw error;
  }
}
