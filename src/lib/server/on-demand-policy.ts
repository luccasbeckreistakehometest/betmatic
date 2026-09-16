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
