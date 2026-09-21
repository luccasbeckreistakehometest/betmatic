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
  /** Generations per admin per day. An admin login can be handed to someone else, so it is capped too. */
  adminDailyCap: number;
  alreadyGenerated: boolean;
  started: boolean;
  /** Max plans may go up to 50% past the global cap ("prioridade"); the budget ceiling still applies. */
  priority?: boolean;
}
export type OnDemandVerdict = "exists" | "started" | "cap_user" | "cap_global" | "cap_admin" | "generate";

export function onDemandVerdict(i: OnDemandInput): OnDemandVerdict {
  if (i.alreadyGenerated) return "exists";
  if (i.started) return "started";
  // An admin still skips the plan and the platform cap — but not a cap of their own, and never the
  // daily spend ceiling, which is checked again at the model call.
  if (i.role === "admin") return i.userCountToday >= i.adminDailyCap ? "cap_admin" : "generate";
  // The global cap is the circuit breaker: no plan, however generous, can push the bill past it.
  const globalCap = i.priority ? Math.floor(i.globalDailyCap * 1.5) : i.globalDailyCap;
  if (i.globalCountToday >= globalCap) return "cap_global";
  const userCap = i.planGamesPerDay ?? i.userDailyCap;
  if (i.userCountToday >= userCap) return "cap_user";
  return "generate";
}

/**
 * A cap written as `0` means zero, not "unset" — that is the switch that stops a shared login dead.
 * `sem-limite` / `unlimited` / `-1` removes the cap entirely; the daily spend ceiling still applies.
 */
export const NO_CAP = Number.POSITIVE_INFINITY;

export function capValue(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === "" || raw.trim().startsWith("#")) return fallback;
  const word = raw.trim().toLowerCase();
  if (word === "unlimited" || word === "sem-limite" || word === "sem limite" || word === "off") return NO_CAP;
  if (!Number.isFinite(Number(raw))) return fallback;
  const n = Math.floor(Number(raw));
  return n < 0 ? NO_CAP : n;
}

export function onDemandCaps(env: Record<string, string | undefined>): { globalDailyCap: number; userDailyCap: number; adminDailyCap: number } {
  return {
    globalDailyCap: Math.max(0, Number(env.ON_DEMAND_DAILY_CAP) || 60),
    userDailyCap: Math.max(0, Number(env.ON_DEMAND_USER_DAILY_CAP) || 20),
    adminDailyCap: capValue(env.ADMIN_GAMES_PER_DAY, 15),
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
export type SlateVerdict = "not_allowed" | "exists" | "too_few_games" | "cap_global" | "cap_user" | "cap_admin" | "generate";
export interface SlateCaps { globalDailyCap: number; userDailyCap: number; adminDailyCap: number; maxGames: number }

export function slateVerdict(i: SlateInput): SlateVerdict {
  if (i.role !== "admin" && !i.crossGame) return "not_allowed";
  if (i.exists) return "exists";
  if (i.upcomingGames < 2) return "too_few_games";
  // The same ADMIN_GAMES_PER_DAY allowance, against the slate's own counter.
  if (i.role === "admin") return i.userCountToday >= i.caps.adminDailyCap ? "cap_admin" : "generate";
  if (i.globalCountToday >= i.caps.globalDailyCap) return "cap_global";
  if (i.userCountToday >= i.caps.userDailyCap) return "cap_user";
  return "generate";
}

export function slateCaps(env: Record<string, string | undefined>): SlateCaps {
  return {
    globalDailyCap: capValue(env.SLATE_DAILY_CAP, 5),
    userDailyCap: capValue(env.SLATE_USER_DAILY_CAP, 2),
    adminDailyCap: capValue(env.ADMIN_GAMES_PER_DAY, 15),
    maxGames: Math.max(2, Math.min(10, capValue(env.SLATE_MAX_GAMES, 6))),
  };
}

/**
 * Max's "atualizar os bilhetes": allowed only when an input changed since the tickets were built
 * (a lineup alert, or six hours and a moved line), and within a per-user and a global daily cap.
 */
export interface RefreshInput {
  isMax: boolean;
  exists: boolean;
  started: boolean;
  lineupAlert: boolean;
  hoursSinceGeneration: number;
  linesMoved: boolean;
  userCountToday: number;
  globalCountToday: number;
  caps: RefreshCaps;
}
export interface RefreshCaps { perUser: number; global: number }
export type RefreshVerdict = "not_max" | "no_tickets" | "started" | "unchanged" | "cap_user" | "cap_global" | "available";

export function refreshVerdict(i: RefreshInput): RefreshVerdict {
  if (!i.isMax) return "not_max";
  if (!i.exists) return "no_tickets";
  if (i.started) return "started";
  const changed = i.lineupAlert || (i.hoursSinceGeneration >= 6 && i.linesMoved);
  if (!changed) return "unchanged";
  if (i.userCountToday >= i.caps.perUser) return "cap_user";
  if (i.globalCountToday >= i.caps.global) return "cap_global";
  return "available";
}

export function refreshCaps(env: Record<string, string | undefined>): RefreshCaps {
  return { perUser: capValue(env.MAX_REFRESH_PER_DAY, 3), global: capValue(env.REFRESH_DAILY_CAP, 10) };
}
