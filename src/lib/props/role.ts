import { measureProp } from "@/lib/props/history";
import type { PlayerHistory } from "@/lib/types";

/**
 * A favourable matchup does nothing for a player who does not play. The literature on defence-vs-
 * position is blunt about this: minutes and role gate everything, so volume is checked before any
 * matchup edge is allowed to matter.
 */
export type RoleTier = "starter" | "rotation" | "fringe" | "unknown";

export interface RoleProfile {
  player: string;
  minutesPerGame: number;
  /** Minutes over the most recent games, which catches a role that just changed. */
  recentMinutes: number;
  /** Positive means the player is trending into a bigger role. */
  minutesTrend: number;
  tier: RoleTier;
  /** Share of logged games where the player exceeded a meaningful workload. */
  reliability: number;
  /** Same measure over the recent window, which is what matters when a role has just changed. */
  recentReliability: number;
  games: number;
  note: string;
}

const MINUTES_MARKET: Record<string, string> = {
  basketball: "Minutes",
  soccer: "Minutes",
};

/** Thresholds are per-sport because 25 minutes means something different in each. */
const TIERS: Record<string, { starter: number; rotation: number; workload: number }> = {
  basketball: { starter: 28, rotation: 18, workload: 20 },
  soccer: { starter: 70, rotation: 35, workload: 60 },
};

function minutesOf(game: { stats: Record<string, number | string> }): number {
  const raw = game.stats.MIN ?? game.stats.minutesPlayed ?? game.stats.Minutes;
  if (raw === undefined) return NaN;
  const value = typeof raw === "number" ? raw : Number(String(raw).replace(/[^\d.]/g, ""));
  return Number.isFinite(value) ? value : NaN;
}

export function buildRoleProfile(
  history: PlayerHistory | null,
  playerName: string,
  sportGroup: string,
): RoleProfile | null {
  if (!history?.games.length) return null;
  const thresholds = TIERS[sportGroup];
  if (!thresholds) return null;

  const minutes = history.games.map(minutesOf).filter((m) => Number.isFinite(m));
  if (minutes.length < 3) return null;

  const mean = minutes.reduce((a, b) => a + b, 0) / minutes.length;
  const recentSlice = minutes.slice(0, Math.min(5, minutes.length));
  const recent = recentSlice.reduce((a, b) => a + b, 0) / recentSlice.length;
  const reliability = minutes.filter((m) => m >= thresholds.workload).length / minutes.length;
  const recentReliability = recentSlice.filter((m) => m >= thresholds.workload).length / recentSlice.length;

  const tier: RoleTier =
    recent >= thresholds.starter ? "starter" : recent >= thresholds.rotation ? "rotation" : "fringe";

  const trend = Number((recent - mean).toFixed(1));

  return {
    player: playerName,
    minutesPerGame: Number(mean.toFixed(1)),
    recentMinutes: Number(recent.toFixed(1)),
    minutesTrend: trend,
    tier,
    reliability: Number(reliability.toFixed(2)),
    recentReliability: Number(recentReliability.toFixed(2)),
    games: minutes.length,
    note: [
      `${recent.toFixed(0)} min nos últimos ${recentSlice.length}`,
      `média ${mean.toFixed(0)} em ${minutes.length} jogos`,
      Math.abs(trend) >= 4 ? `tendência ${trend > 0 ? "+" : ""}${trend} min` : "",
      recentReliability >= 0.8 && reliability < 0.5 ? "papel novo — promovido recentemente" : "",
      recentReliability < 0.6 ? "papel instável" : "",
    ]
      .filter(Boolean)
      .join(" · "),
  };
}

/**
 * Whether a prop on this player is worth pricing at all. Returning false is the point: it stops a
 * soft matchup from producing a leg on someone who will not see the floor long enough to reach the line.
 */
export function volumeSupports(role: RoleProfile | null, sportGroup: string): boolean {
  if (!role) return false;
  const thresholds = TIERS[sportGroup];
  if (!thresholds) return true;
  // A fringe player can still clear a low line, but not reliably enough to build on.
  if (role.tier === "fringe") return false;
  // Season-long reliability punishes a player whose role just changed — which is exactly the
  // situation that creates value, since the market is still pricing the old role. Recent workload
  // overrides the season figure when the promotion is clear.
  const promoted = role.recentReliability >= 0.8 && role.minutesTrend > 0;
  return promoted || role.reliability >= 0.4;
}

export function rolePrompt(roles: RoleProfile[]): string {
  if (!roles.length) return "ROLE AND MINUTES: not computed.";
  return [
    "ROLE AND MINUTES — volume gate. A matchup edge is void if the player does not play enough to reach the line:",
    ...roles
      .slice(0, 12)
      .map(
        (r) =>
          `- ${r.player}: ${r.tier}, ${r.recentMinutes} min recent / ${r.minutesPerGame} avg, reliability ${r.recentReliability} recent / ${r.reliability} season (${r.note})`,
      ),
    "Do not build a leg on a fringe player, and treat a negative minutes trend as a reason to pass even when the matchup looks soft.",
    "A player flagged as recently promoted is the one case where the market may still be pricing an old, smaller role — say so explicitly when you use one.",
  ].join("\n");
}

export { MINUTES_MARKET, measureProp };

/**
 * Role profile for a sport whose game log carries no minutes.
 *
 * Football is the case this exists for: buildRoleProfile needs MIN, ESPN never publishes it for
 * football, so every football prop was priced with the volume gate silently disabled. A bookmaker's
 * player ladder assumes a start; a player who has begun one of four matches is a different bet
 * entirely, however good the matchup looks.
 */
export function buildRoleFromStarts(
  playerName: string,
  role: { starts: number; subIns: number; appearances: number; startShare: number } | null,
): RoleProfile | null {
  if (!role || !role.appearances) return null;
  const tier: RoleTier = role.startShare >= 0.7 ? "starter" : role.startShare >= 0.4 ? "rotation" : "fringe";
  return {
    player: playerName,
    // Minutes are unknown, not zero — reporting a number here would invent one.
    minutesPerGame: NaN,
    recentMinutes: NaN,
    minutesTrend: 0,
    tier,
    reliability: role.startShare,
    recentReliability: role.startShare,
    games: role.appearances,
    note: `${role.starts} de ${role.appearances} como titular${role.subIns ? `, ${role.subIns} entrando do banco` : ""}`,
  };
}

/**
 * Whether a player has started enough to price a ladder built for a starter. Kept separate from
 * volumeSupports because that function reasons about minutes, which football never supplies.
 */
export function startsSupport(role: RoleProfile | null): boolean {
  return !!role && role.tier === "starter";
}
