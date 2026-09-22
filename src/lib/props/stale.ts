import { normaliseName } from "@/lib/resolve/names";

/**
 * The stale line guard. ESPN's prop feed carries PRE-GAME prices and does not move once the ball is
 * up: at half time it still offered "Bonner over 7.5 points at 1.86" while she had 10. A leg like
 * that is not a bet — it is a settled result, and offering it would either be a win nobody could
 * have taken or a loss nobody could have avoided. Either way it poisons the public track record.
 *
 * So: given the posted lines and the box score as it stands, every prop is decided, alive with what
 * it still needs, or unknown. Pure — no fetching, no clock, no I/O. The box-score reader
 * (props/box-score.ts) supplies the totals; the guard only judges them.
 */
export type StaleState = "decided" | "alive" | "unknown";

/** One player's current totals, by market key ("points", "rebounds", "pra", "shots"…). */
export type PlayerTotals = Record<string, number>;

/**
 * The box score as the guard consumes it: totals by athlete id, and by normalised name for the
 * sources that publish a name and no id.
 */
export interface LiveTotals {
  byId: Record<string, PlayerTotals>;
  byName: Record<string, PlayerTotals>;
}

export const emptyTotals = (): LiveTotals => ({ byId: {}, byName: {} });

/** Anything with a player, a market and a line: a PostedProp, a PropRow, a leg of a stored ticket. */
export interface GuardableProp {
  athleteId?: string;
  player?: string;
  marketKey?: string;
  line?: number;
  side?: string;
}

export interface StaleVerdict {
  state: StaleState;
  /** The player's total in this market right now; null when the box score has no value for it. */
  current: number | null;
  /**
   * Over: how much more the player needs for the line to clear (always >= 1 while alive).
   * Under: how much more the player can still afford before it busts (0 means "nothing more").
   * null when the verdict is unknown or already decided.
   */
  remaining: number | null;
  reason: { pt: string; en: string } | null;
}

const fmt = (x: number) => (Number.isInteger(x) ? String(x) : x.toFixed(1));

/**
 * What the line still needs, in whole units, for a count that can only go up.
 *
 * Over: the smallest total that beats the line is floor(line) + 1 — 8 for a 7.5 line, 9 for a whole
 * 8 (which pushes at 8). Reaching it decides the leg.
 * Under: the largest total that still wins is ceil(line) - 1 — 7 for both 7.5 and a whole 8, since
 * exactly 8 pushes. Once the player is past that, the under can no longer win.
 */
export function needed(line: number, side: "over" | "under", current: number): number {
  return side === "over" ? Math.floor(line) + 1 - current : Math.ceil(line) - 1 - current;
}

/**
 * The rule, in one place. A counting stat never goes down, so:
 * - an over is decided the moment the player is past the line (it cannot lose any more);
 * - an under is decided the moment the player can no longer win it (past the line, or level with a
 *   whole line, where the best case left is a push).
 * Everything else is alive with a remaining requirement, and a player the box score says nothing
 * about is unknown — never dropped, because missing data must never masquerade as a result.
 */
export function judgeProp(prop: GuardableProp, current: number | null | undefined): StaleVerdict {
  const side = prop.side === "under" ? "under" : "over";
  if (typeof prop.line !== "number" || !Number.isFinite(prop.line) || current === null || current === undefined || !Number.isFinite(current)) {
    return { state: "unknown", current: null, remaining: null, reason: null };
  }
  const left = needed(prop.line, side, current);
  const decided = side === "over" ? left <= 0 : left < 0;
  if (decided) {
    return {
      state: "decided", current, remaining: null,
      reason: side === "over"
        ? { pt: `já bateu: ${fmt(current)} contra ${fmt(prop.line)}`, en: `already cleared: ${fmt(current)} vs ${fmt(prop.line)}` }
        : { pt: `já caiu: ${fmt(current)} contra ${fmt(prop.line)}`, en: `already busted: ${fmt(current)} vs ${fmt(prop.line)}` },
    };
  }
  return {
    state: "alive", current, remaining: left,
    reason: side === "over"
      ? { pt: `${fmt(current)} até agora, faltam ${left}`, en: `${fmt(current)} so far, ${left} to go` }
      : { pt: `${fmt(current)} até agora, pode fazer mais ${left}`, en: `${fmt(current)} so far, room for ${left} more` },
  };
}

/** The totals for one player: by athlete id first, by name when the feed carries no id. */
export function totalsFor(totals: LiveTotals | null, prop: GuardableProp): PlayerTotals | null {
  if (!totals) return null;
  if (prop.athleteId && totals.byId[prop.athleteId]) return totals.byId[prop.athleteId];
  if (prop.player) {
    const byName = totals.byName[normaliseName(prop.player)];
    if (byName) return byName;
  }
  return null;
}

/** The player's current total in this prop's market, or null when there is no live value for it. */
export function currentFor(totals: LiveTotals | null, prop: GuardableProp): number | null {
  const player = totalsFor(totals, prop);
  if (!player || !prop.marketKey) return null;
  const value = player[prop.marketKey];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export interface Guarded<T> { prop: T; verdict: StaleVerdict }

/**
 * Splits posted props into the ones still worth pricing and the ones the box score has already
 * settled. With no totals at all (game not started, feed down) everything is unknown and kept:
 * this guard only ever removes legs it can prove are decided.
 */
export function guardProps<T extends GuardableProp>(props: T[], totals: LiveTotals | null): { kept: Guarded<T>[]; dropped: Guarded<T>[] } {
  const kept: Guarded<T>[] = [];
  const dropped: Guarded<T>[] = [];
  for (const prop of props) {
    const verdict = judgeProp(prop, currentFor(totals, prop));
    (verdict.state === "decided" ? dropped : kept).push({ prop, verdict });
  }
  return { kept, dropped };
}

/** One short line per dropped leg, for the ops note: "Bonner points over 7.5 — already cleared: 10 vs 7.5". */
export function describeDropped<T extends GuardableProp>(dropped: Guarded<T>[], lang: "pt" | "en" = "en"): string[] {
  return dropped.map(({ prop, verdict }) =>
    `${prop.player ?? prop.athleteId ?? "?"} ${prop.marketKey ?? "?"} ${prop.side ?? "over"} ${prop.line ?? "?"} — ${verdict.reason?.[lang] ?? "decided"}`);
}
