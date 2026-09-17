import { matchAthlete, resolveStatLabels } from "@/lib/props/history";
import { getSport } from "@/lib/sports";
import type { ProviderLines } from "@/lib/sources/espn-props";
import type { BetLeg, Game, PropRow } from "@/lib/types";

/**
 * Deterministic work on the model's legs. The model names a selection; the price, the opening price
 * and the measured record are attached here from the feeds, so a mistyped odd can never reach a
 * payout and the numbers a reader sees always come from data.
 */
export interface LegKey {
  settlementType: string;
  settlementPlayer: string | null;
  settlementStat: string | null;
  settlementLine: number | null;
  settlementSide: string | null;
  settlementTeam: string | null;
}

export interface EnrichContext { props: PropRow[]; sportKey: string; game?: Game; lines?: ProviderLines[] }

const sameLabels = (a: string[] | null, b: string[] | null) => !!a && !!b && a.length === b.length && a.every((x, i) => x === b[i]);

/** The posted player prop a leg refers to, if the feed carried it. */
export function matchCandidate(leg: LegKey, ctx: EnrichContext): PropRow | null {
  if (leg.settlementType !== "player_prop" || !leg.settlementPlayer || leg.settlementLine === null) return null;
  const priced = ctx.props.filter((p) => p.priced && p.athleteId);
  const people = [...new Map(priced.map((p) => [p.athleteId!, { name: p.player, id: p.athleteId! }])).values()];
  const who = matchAthlete(leg.settlementPlayer, people);
  if (!who) return null;
  const wanted = resolveStatLabels(leg.settlementStat ?? "", ctx.sportKey);
  const side = leg.settlementSide === "under" ? "under" : "over";
  const markets = getSport(ctx.sportKey).markets;
  return priced.find((p) =>
    p.athleteId === who.id &&
    p.side === side &&
    Math.abs((p.line ?? NaN) - leg.settlementLine!) < 0.01 &&
    sameLabels(markets.find((m) => m.key === p.marketKey)?.statLabels ?? null, wanted),
  ) ?? null;
}

/** DraftKings' open and current price for a game-line leg, when the line itself has not moved. */
export function matchGameLine(leg: LegKey, ctx: EnrichContext): { current: number; open: number | null } | null {
  const game = ctx.game;
  const dk = ctx.lines?.find((l) => /draftkings/i.test(l.provider));
  if (!game || !dk?.current) return null;
  const { open, current } = dk;
  const isHome = leg.settlementTeam === game.home.abbreviation;
  const isAway = leg.settlementTeam === game.away.abbreviation;
  if (leg.settlementType === "moneyline" && (isHome || isAway)) {
    const now = isHome ? current.homeMl : current.awayMl;
    const was = isHome ? open?.homeMl : open?.awayMl;
    return now ? { current: now, open: was ?? null } : null;
  }
  if (leg.settlementType === "total" && leg.settlementLine !== null && current.total === leg.settlementLine) {
    const over = leg.settlementSide !== "under";
    const now = over ? current.over : current.under;
    const was = open && open.total === current.total ? (over ? open.over : open.under) : null;
    return now ? { current: now, open: was ?? null } : null;
  }
  if (leg.settlementType === "spread" && (isHome || isAway) && current.spread !== null && leg.settlementLine !== null) {
    const line = isHome ? current.spread : -current.spread;
    if (Math.abs(line - leg.settlementLine) > 0.01) return null;
    const now = isHome ? current.homeSpread : current.awaySpread;
    const was = open && open.spread === current.spread ? (isHome ? open.homeSpread : open.awaySpread) : null;
    return now ? { current: now, open: was ?? null } : null;
  }
  return null;
}

/** The authoritative price for a raw leg: the posted one when the feed has it, else the model's text. */
export function anchoredOdds(leg: LegKey & { odds: string }, ctx: EnrichContext): string {
  const prop = matchCandidate(leg, ctx);
  if (prop?.decimal) return prop.decimal.toFixed(2);
  const line = matchGameLine(leg, ctx);
  if (line) return line.current.toFixed(2);
  return leg.odds;
}

const frac = (h: { hits: number; of: number }) => `${h.hits}/${h.of}`;

/** Adds athlete id, opening price and the measured record to a priced leg. */
export function enrichLeg(leg: BetLeg, key: LegKey, ctx: EnrichContext): BetLeg {
  const prop = matchCandidate(key, ctx);
  if (prop) {
    const m = prop.measured;
    return {
      ...leg,
      athleteId: prop.athleteId,
      openOdds: prop.openDecimal ?? undefined,
      measured: m ? { last5: frac(m.last5), last10: frac(m.last10), season: frac(m.season), rate: m.impliedFair } : undefined,
    };
  }
  const line = matchGameLine(key, ctx);
  return line?.open ? { ...leg, openOdds: line.open } : leg;
}
