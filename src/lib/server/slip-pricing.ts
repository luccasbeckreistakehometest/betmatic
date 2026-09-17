import { ACTION_COST } from "@/lib/plans";
import type { PublicUser } from "@/lib/server/users";

/** Max includes the deep analysis at the normal price; the other plans pay the deep price. */
export function slipPrice(user: Pick<PublicUser, "role" | "plan">, deep: boolean): number {
  if (user.role === "admin") return 0;
  if (!deep) return ACTION_COST.analyse_slip;
  return user.plan.id === "max" ? ACTION_COST.analyse_slip : ACTION_COST.deep_slip;
}
