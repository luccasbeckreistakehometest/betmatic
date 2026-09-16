/**
 * When a game's tickets are (re)generated. The old job regenerated every game, every language, every
 * run — six times a day for the same match. A game now costs one generation per day, plus at most one
 * pre-match refresh when explicitly enabled, so odds and line-ups close to kickoff can be picked up.
 */
export interface RegenerateInput {
  /** ISO time of the existing prediction for this game and language, if any. */
  existingGeneratedAt: string | null;
  /** ISO kickoff. */
  startsAt: string | null;
  now: number;
  /** 0 disables the pre-match refresh. */
  prematchHours: number;
}

export function shouldGenerate(i: RegenerateInput): { generate: boolean; reason: "missing" | "prematch" | "fresh" | "started" } {
  const kickoff = i.startsAt ? Date.parse(i.startsAt) : NaN;
  if (Number.isFinite(kickoff) && kickoff <= i.now) return { generate: false, reason: "started" };
  if (!i.existingGeneratedAt) return { generate: true, reason: "missing" };
  if (i.prematchHours > 0 && Number.isFinite(kickoff)) {
    const window = i.prematchHours * 3_600_000;
    const generated = Date.parse(i.existingGeneratedAt);
    // Inside the window, and the existing one was made before the window opened: refresh once.
    if (kickoff - i.now <= window && generated < kickoff - window) return { generate: true, reason: "prematch" };
  }
  return { generate: false, reason: "fresh" };
}

export interface RefreshConfig { sports: string[]; maxGames: number; langs: string[]; prematchHours: number }

/** Env-driven so the cost ceiling is a deploy setting, not a code change. */
export function refreshConfig(env: Record<string, string | undefined>, allSports: string[]): RefreshConfig {
  const list = (v: string | undefined) => (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const sports = list(env.CRON_SPORTS);
  // Tennis slates run to dozens of matches a day with thin prop coverage: off unless asked for.
  const defaults = allSports.filter((s) => !s.startsWith("tennis"));
  return {
    sports: sports.length ? sports.filter((s) => allSports.includes(s)) : defaults,
    maxGames: Math.max(1, Number(env.CRON_MAX_GAMES) || 6),
    langs: list(env.CRON_LANGS).length ? list(env.CRON_LANGS) : ["pt", "en"],
    prematchHours: Math.max(0, Number(env.CRON_PREMATCH_REFRESH_HOURS) || 0),
  };
}
