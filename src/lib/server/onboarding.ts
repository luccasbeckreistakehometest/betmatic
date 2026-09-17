import { getDb, nowIso } from "@/lib/server/db";

export interface OnboardingRow { id: string; tourCompleted: number; tourStep: number; firstSeenAt: string; completedAt: string | null; events: string }

/** Read-only: an owner with no row yet reads as a fresh, unfinished tour (GET must not write). */
export function peekOnboarding(ownerId: string): Pick<OnboardingRow, "tourCompleted" | "tourStep"> {
  const row = getDb().prepare("SELECT tourCompleted, tourStep FROM onboarding WHERE id = ?").get(ownerId) as Pick<OnboardingRow, "tourCompleted" | "tourStep"> | undefined;
  return row ?? { tourCompleted: 0, tourStep: 0 };
}

/** Creates the row on first use; only POST paths call this. */
export function getOnboarding(ownerId: string): OnboardingRow {
  const db = getDb();
  let row = db.prepare("SELECT * FROM onboarding WHERE id = ?").get(ownerId) as OnboardingRow | undefined;
  if (!row) {
    db.prepare("INSERT INTO onboarding (id, firstSeenAt) VALUES (?, ?)").run(ownerId, nowIso());
    row = db.prepare("SELECT * FROM onboarding WHERE id = ?").get(ownerId) as OnboardingRow;
  }
  return row;
}

/** The first session as a timeline, so the admin can see what a newcomer actually did. */
export function recordEvent(ownerId: string, type: string, meta?: Record<string, unknown>): void {
  const row = getOnboarding(ownerId);
  const events = JSON.parse(row.events) as { at: string; type: string; meta?: unknown }[];
  if (events.length >= 200) return;
  events.push({ at: nowIso(), type, meta });
  const json = JSON.stringify(events);
  // A hard ceiling per owner whatever the caller sends: the funnel log must never grow the database.
  if (json.length > 64_000) return;
  getDb().prepare("UPDATE onboarding SET events = ? WHERE id = ?").run(json, ownerId);
}

export function setTourStep(ownerId: string, step: number, completed: boolean): OnboardingRow {
  getOnboarding(ownerId);
  getDb().prepare("UPDATE onboarding SET tourStep = ?, tourCompleted = ?, completedAt = COALESCE(completedAt, ?) WHERE id = ?")
    .run(step, completed ? 1 : 0, completed ? nowIso() : null, ownerId);
  return getOnboarding(ownerId);
}

export function onboardingStats() {
  const db = getDb();
  const one = (sql: string) => (db.prepare(sql).get() as { c: number }).c;
  return { started: one("SELECT COUNT(*) c FROM onboarding"), completed: one("SELECT COUNT(*) c FROM onboarding WHERE tourCompleted = 1") };
}
