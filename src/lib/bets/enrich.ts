import { matchAthlete, resolveStatLabels } from "@/lib/props/history";
import { getSport } from "@/lib/sports";
import { liveQuoteFor, type LiveBoard } from "@/lib/props/live-prices";
import type { ProviderLines } from "@/lib/sources/espn-props";
import type { BetLeg, Game, PropRow, Settlement } from "@/lib/types";

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

export interface EnrichContext {
  props: PropRow[];
  sportKey: string;
  game?: Game;
  lines?: ProviderLines[];
  /**
   * The in-play board, present only on a read taken with the game under way and only while it is
   * fresh. When it prices a leg it WINS, over the prop feed and over the posted game line alike:
   * both of those stopped moving at the tip, and a number from before the tip is not this ticket's
   * price. Absent, everything below behaves exactly as it did before there was an in-play round.
   */
  liveBoard?: LiveBoard;
}

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

/** A leg's settlement rebuilt from the key the model's ticket was parsed into. */
const settlementOf = (leg: LegKey): Settlement => ({
  type: leg.settlementType as Settlement["type"],
  player: leg.settlementPlayer ?? undefined,
  stat: leg.settlementStat ?? undefined,
  line: leg.settlementLine ?? undefined,
  side: (leg.settlementSide ?? undefined) as Settlement["side"],
  teamAbbreviation: leg.settlementTeam ?? undefined,
  sourceBasis: "",
});

/** The live price on a leg, when the game is under way and a book posts that exact line right now. */
export function matchLivePrice(leg: LegKey, ctx: EnrichContext): { book: string; decimal: number; fetchedAt: string } | null {
  if (!ctx.liveBoard) return null;
  return liveQuoteFor(settlementOf(leg), ctx.game?.home.abbreviation ?? null, ctx.liveBoard);
}

/**
 * The authoritative price for a raw leg: the in-play price when a book is posting this line right
 * now, else the posted pre-game one when the feed has it, else the model's text. The order is the
 * point — pre-game feeds stop moving at the tip, so once a live board exists it is the only source
 * that can answer "what does this cost now".
 */
export function anchoredOdds(leg: LegKey & { odds: string }, ctx: EnrichContext): string {
  const live = matchLivePrice(leg, ctx);
  if (live) return live.decimal.toFixed(2);
  const prop = matchCandidate(leg, ctx);
  if (prop?.decimal) return prop.decimal.toFixed(2);
  const line = matchGameLine(leg, ctx);
  if (line) return line.current.toFixed(2);
  return leg.odds;
}

const frac = (h: { hits: number; of: number }) => `${h.hits}/${h.of}`;

/**
 * How far the model's fairProbability may sit from the computed probability of the same line. The
 * model still knows things the numbers do not (a report, a matchup) and may lean either way inside
 * this band; outside it the computed number wins, because a leg the arithmetic puts at 45% cannot
 * become a 70% leg by being described well.
 */
export const ANCHOR_BAND = 0.08;

/** The model's estimate pulled inside the band around the computed probability, when one exists. */
export function anchoredProbability(fair: number, computed: number | undefined | null): number {
  if (computed === undefined || computed === null || !Number.isFinite(computed)) return fair;
  return Math.min(Math.max(fair, computed - ANCHOR_BAND), computed + ANCHOR_BAND);
}

/**
 * Adds athlete id, opening price, the measured record and the computed probability to a priced leg,
 * and anchors fairProbability to the computed number. The model's own estimate is kept as
 * rawProbability so the ledger can race the two once the leg settles. A player LISTED OUT keeps
 * the model's own number: her computed probability assumes she plays, and pulling a 20% up to 70%
 * on a player the report says is out would be the anchor working against the evidence — the flag
 * stays on the row and the prompt treats her as unplayable until the report changes.
 */
export function enrichLeg(leg: BetLeg, key: LegKey, ctx: EnrichContext): BetLeg {
  const prop = matchCandidate(key, ctx);
  if (prop) {
    const m = prop.measured;
    const model = prop.model ?? null;
    const listedOut = model?.minutes.availability === "listed_out";
    return {
      ...leg,
      athleteId: prop.athleteId,
      openOdds: prop.openDecimal ?? undefined,
      measured: m ? { last5: frac(m.last5), last10: frac(m.last10), season: frac(m.season), rate: m.impliedFair } : undefined,
      ...(model ? {
        computedProbability: Number(model.computed.toFixed(3)),
        modelNote: model.note,
        projectedMinutes: Number.isFinite(model.minutes.expected) ? Number(model.minutes.expected.toFixed(1)) : undefined,
        rawProbability: leg.fairProbability,
        fairProbability: listedOut ? leg.fairProbability : anchoredProbability(leg.fairProbability, model.computed),
      } : {}),
    };
  }
  const line = matchGameLine(key, ctx);
  return line?.open ? { ...leg, openOdds: line.open } : leg;
}
