/**
 * Who may trigger a generation by opening a game, and when. Generation costs real money, so the
 * decision is pure and tested: the route just feeds it counts.
 */
export interface OnDemandInput {
  role: "user" | "admin";
  /** null = the plan sets no per-day limit. */
  planGamesPerDay: number | null;
  userCountToday: number;
  globalCountToday: number;
  globalDailyCap: number;
  userDailyCap: number;
  alreadyGenerated: boolean;
  started: boolean;
}
export type OnDemandVerdict = "exists" | "started" | "cap_user" | "cap_global" | "generate";

export function onDemandVerdict(i: OnDemandInput): OnDemandVerdict {
  if (i.alreadyGenerated) return "exists";
  if (i.started) return "started";
  if (i.role === "admin") return "generate";
  // The global cap is the circuit breaker: no plan, however generous, can push the bill past it.
  if (i.globalCountToday >= i.globalDailyCap) return "cap_global";
  const userCap = i.planGamesPerDay ?? i.userDailyCap;
  if (i.userCountToday >= userCap) return "cap_user";
  return "generate";
}

export function onDemandCaps(env: Record<string, string | undefined>): { globalDailyCap: number; userDailyCap: number } {
  return {
    globalDailyCap: Math.max(0, Number(env.ON_DEMAND_DAILY_CAP) || 60),
    userDailyCap: Math.max(0, Number(env.ON_DEMAND_USER_DAILY_CAP) || 20),
  };
}

/**
 * Cross-game parlays on demand. One shared slate per sport per day; the global cap bounds the bill,
 * the per-user cap stops one account from spending it.
 */
export interface SlateInput {
  role: "user" | "admin";
  crossGame: boolean;
  exists: boolean;
  /** Scheduled games still to start that carry at least one price. */
  upcomingGames: number;
  globalCountToday: number;
  userCountToday: number;
  caps: SlateCaps;
}
export type SlateVerdict = "not_allowed" | "exists" | "too_few_games" | "cap_global" | "cap_user" | "generate";
export interface SlateCaps { globalDailyCap: number; userDailyCap: number; maxGames: number }

export function slateVerdict(i: SlateInput): SlateVerdict {
  if (i.role !== "admin" && !i.crossGame) return "not_allowed";
  if (i.exists) return "exists";
  if (i.upcomingGames < 2) return "too_few_games";
  if (i.role === "admin") return "generate";
  if (i.globalCountToday >= i.caps.globalDailyCap) return "cap_global";
  if (i.userCountToday >= i.caps.userDailyCap) return "cap_user";
  return "generate";
}

export function slateCaps(env: Record<string, string | undefined>): SlateCaps {
  const n = (v: string | undefined, fallback: number) => (v !== undefined && v.trim() !== "" && Number.isFinite(Number(v)) ? Math.max(0, Math.floor(Number(v))) : fallback);
  return { globalDailyCap: n(env.SLATE_DAILY_CAP, 5), userDailyCap: n(env.SLATE_USER_DAILY_CAP, 2), maxGames: Math.max(2, Math.min(10, n(env.SLATE_MAX_GAMES, 6))) };
}
