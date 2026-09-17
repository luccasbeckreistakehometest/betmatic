import { claimUse, hasUsedToday, releaseUse } from "@/lib/server/feature-uses";
import type { PublicUser } from "@/lib/server/users";

/**
 * Who can open the player deep dive. Paid plans that cover the sport open any player; everyone else
 * gets one player a day (reopening the same player that day is free).
 */
export const PLAYER_FREE_PER_DAY = 1;

const key = (sportKey: string, athleteId: string) => `${sportKey}:${athleteId}`;

export function unlimitedPlayers(user: Pick<PublicUser, "role" | "plan">, sportKey: string): boolean {
  if (user.role === "admin") return true;
  return user.plan.id !== "free" && (!user.plan.sports.length || user.plan.sports.includes(sportKey));
}

export function claimPlayer(user: Pick<PublicUser, "id" | "role" | "plan">, sportKey: string, athleteId: string): { ok: boolean; used: number; limit: number | null } {
  if (unlimitedPlayers(user, sportKey)) return { ok: true, used: 0, limit: null };
  const r = claimUse({ userId: user.id, feature: "player", key: key(sportKey, athleteId), limit: PLAYER_FREE_PER_DAY });
  return { ok: r.ok, used: r.used, limit: PLAYER_FREE_PER_DAY };
}

/** Gives the slot back when the profile could not be built (ESPN down): a failure is not a use. */
export function releasePlayer(user: Pick<PublicUser, "id" | "role" | "plan">, sportKey: string, athleteId: string): void {
  if (!unlimitedPlayers(user, sportKey)) releaseUse(user.id, "player", key(sportKey, athleteId));
}

export function canSeePlayer(user: Pick<PublicUser, "id" | "role" | "plan">, sportKey: string, athleteId: string): boolean {
  return unlimitedPlayers(user, sportKey) || hasUsedToday(user.id, "player", key(sportKey, athleteId));
}
