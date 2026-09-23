import { marketsFor } from "@/lib/sports";
import { resolveStatLabels } from "@/lib/props/history";

/**
 * One name per market, so a slice of the ledger is a slice and not an accident of spelling.
 *
 * Today `points` / `Pontos`, and `PRA` / `PR` / `points_rebounds_assists` /
 * `Pontos + Rebotes + Assistências` are the same market written six ways — and `SettledLeg.market`
 * is `settlement.type`, so 1,098 of the ledger's 1,099 legs fall into a single bucket called
 * `player_prop`. Until that is fixed `byMarket` and `specialisation()` print one line and the
 * product believes it returned a table.
 *
 * The vocabulary is the sport's own market catalogue (src/lib/sports.ts), reached through
 * `resolveStatLabels`, so this file adds a naming rule and no second source of truth. A label the
 * catalogue does not know returns `null`: it lands in an `unmapped` bucket the admin can see, and
 * cut 9 of the selection keeps it out of the wallet.
 */
export function canonicalStat(stat: string | undefined | null, sportKey: string): string | null {
  const clean = (stat ?? "").trim();
  if (!clean) return null;
  const labels = resolveStatLabels(clean, sportKey);
  if (!labels?.length) return null;
  const fingerprint = JSON.stringify(labels);
  const market = marketsFor(sportKey).find((m) => JSON.stringify(m.statLabels) === fingerprint);
  // The market key when the sport names one; otherwise the stat labels themselves, lower-cased.
  return market?.key ?? labels.join("+").toLowerCase();
}

/** The bucket a leg belongs to. Team markets keep their own names; player props get the stat. */
export function canonicalMarket(
  leg: { market?: string; settlement?: { type?: string; stat?: string } },
  sportKey: string,
): string | null {
  const type = leg.settlement?.type ?? leg.market ?? "";
  if (type === "player_prop") return canonicalStat(leg.settlement?.stat, sportKey);
  if (type === "moneyline" || type === "spread" || type === "total") return type;
  // A leg logged before settlement descriptors existed carries only prose: try it as a stat name.
  return canonicalStat(leg.settlement?.stat ?? leg.market, sportKey);
}

/** Canonical key or the visible `unmapped` bucket — never a silent drop. */
export const marketKeyOf = (leg: Parameters<typeof canonicalMarket>[0], sportKey: string): string =>
  canonicalMarket(leg, sportKey) ?? "unmapped";
