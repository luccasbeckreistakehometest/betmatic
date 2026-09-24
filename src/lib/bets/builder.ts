import { z } from "zod";
import { generateStructured } from "@/lib/ai/extract";
import { MODEL } from "@/lib/ai/client";
import { getPrompt, getPromptVersion } from "@/lib/server/prompts";
import { calibrationPrompt } from "@/lib/ledger/calibrate";
import { canonicalMarket } from "@/lib/ledger/stat-key";
import { ledgerIdFor, recordPredictions } from "@/lib/ledger/store";
import { recordLegPrices } from "@/lib/server/leg-prices";
import { logEvent } from "@/lib/server/ops-log";
import { settlePending } from "@/lib/ledger/settle";
import {
  ODDS_BANDS, expectedValue, formatAmerican, getBand, impliedProbability, parlayDecimal, parseOdds,
} from "@/lib/odds";
import type {
  BetLeg, BetSlate, BetSuggestion, Game, GameDetail, PickRow, PropRow, XIntel,
} from "@/lib/types";
import type { Lang } from "@/lib/i18n";
import { getSport, marketCatalogue } from "@/lib/sports";
import { duelsPrompt } from "@/lib/duels";
import type { Duel } from "@/lib/duels";
import { refereePrompt, type RefereeSignal } from "@/lib/signals/referee";
import { dvpPrompt, type DvpProfile } from "@/lib/signals/dvp";
import { splitsPrompt, type PlayerSplits } from "@/lib/signals/splits";
import { teamSeasonPrompt, type TeamSeasonMatchup } from "@/lib/signals/team-season";
import { consensusPrompt, type ConsensusProp } from "@/lib/props/consensus";
import { livePrompt, type LiveState } from "@/lib/live/state";
import { rolePrompt, type RoleProfile } from "@/lib/props/role";
import { anchoredOdds, enrichLeg, type EnrichContext } from "@/lib/bets/enrich";
import { calibratorFor, type Calibrator } from "@/lib/ledger/recalibrate";
import { minutesPrompt, type MinutesProjection } from "@/lib/props/minutes";
import { environmentPrompt, gameEnvironment, type GameEnvironment } from "@/lib/signals/environment";
import { ticketCorrelation, type CorrLeg } from "@/lib/signals/correlation";
import { matchAthlete, resolveStatLabels } from "@/lib/props/history";
import { linkAlternatives, ticketId } from "@/lib/bets/alternatives";
import { capPlayerConcentration, unplayableReason, type GateDrop } from "@/lib/bets/gates";
import type { ProviderLines } from "@/lib/sources/espn-props";
import { mockGameSlate, mockSlateBets } from "@/lib/ai/mocks";

/**
 * Output room for a slate. A full read is five bands, each main ticket with two alternatives and
 * five to eight legs carrying an explanation and its evidence — and on Claude the model's own
 * thinking counts against the same cap. 16k truncated every game on 22/09/2026 (three Opus reads,
 * US$1.48 for nothing) and 32k still cut the JSON short; 48k is the default, AI_MAX_OUTPUT_TOKENS moves it.
 */
export const JUDGEMENT_MAX_TOKENS = (() => {
  const v = Number(process.env.AI_MAX_OUTPUT_TOKENS);
  return Number.isFinite(v) && v >= 16000 ? Math.floor(v) : 48000;
})();

const LegSchema = z.object({
  selection: z.string().describe("The exact bet, including the number. e.g. 'Paolo Banchero over 22.5 points'"),
  market: z.string().describe("moneyline | spread | total | player prop | alternate | other"),
  odds: z.string().describe("The price exactly as the source showed it, American or decimal. Empty string if no price was published."),
  book: z.string().nullable(),
  explanation: z.string().describe("Why this leg. One or two sentences."),
  evidence: z.string().describe("The specific measured fact behind it — hit rate with sample size, injury status, or the insider post. Say 'no measured support' when there is none."),
  fairProbability: z.number().describe("Your estimate of this leg actually landing, 0 to 1. Use the measured hit rate when one is given; never exceed it by much without stating why."),
  settlementType: z.enum(["moneyline", "spread", "total", "player_prop", "other"]),
  settlementTeam: z.string().nullable().describe("Team abbreviation for moneyline/spread legs."),
  settlementPlayer: z.string().nullable().describe("Player name for prop legs, exactly as supplied."),
  settlementStat: z.string().nullable().describe("Stat for prop legs: points, rebounds, assists, PRA, 3PM…"),
  settlementLine: z.number().nullable(),
  settlementSide: z.enum(["over", "under", "home", "away", "yes", "no"]).nullable(),
  sourceBasis: z.string().describe("Which gathered input this leg leans on: 'measured history', 'book line', 'injury report', 'PropsCash', 'Dimers', 'Mama Knows Bets', 'insider X', or 'none'."),
  gameId: z.string().nullable().describe("For cross-game tickets, the id of the game this leg belongs to."),
});

const SuggestionSchema = z.object({
  kind: z.enum(["single", "parlay"]),
  alternativeOf: z.number().int().nullable().describe("null for a main ticket. For an alternative: the 0-based index, in this same suggestions list, of the main ticket it backs up."),
  swapReason: z.string().nullable().describe("For an alternative: when to switch to it, e.g. 'se o Fulano for vetado' or 'se a linha passar de 2,5'. null for a main ticket."),
  title: z.string().describe("Short label for the ticket."),
  background: z.string().describe("The situation that makes this worth a look: matchup context, injury picture, market read. Two or three sentences."),
  legs: z.array(LegSchema).min(1),
  riskNote: z.string().describe("What most plausibly breaks this ticket."),
  confidence: z.enum(["high", "medium", "low"]),
});

export type RawSuggestion = z.infer<typeof SuggestionSchema>;
/**
 * Whether a leg's settlement descriptor describes the bet its own text describes. The grader trusts
 * this descriptor completely, so an incoherent one is worse than no ticket: a player's rebounds
 * settled as a game total is a silent wrong grade, not a visible error.
 */
/**
 * Whether a leg names any evidence at all. `sourceBasis` is the model's own answer to "what is this
 * leaning on", and "none" is an answer it is allowed to give — the learning run of 23/09/2026 asked
 * for those legs to stop being published, having found one settled against the wrong market entirely.
 * It costs almost nothing to enforce: 2 legs of 1.099 in the record ever said "none".
 */
export function hasEvidence(sourceBasis: string): boolean {
  const s = sourceBasis.trim().toLowerCase();
  return !!s && !["none", "nenhuma", "nenhum", "sem fonte", "n/a", "na", "-", "—"].includes(s);
}

export function settlementIsCoherent(leg: Pick<RawLeg, "selection" | "settlementType" | "settlementPlayer" | "settlementStat" | "settlementLine" | "settlementSide" | "settlementTeam" | "sourceBasis">): boolean {
  const names = /(pontos|rebotes|assist|bolas de 3|triplos|roubos|tocos|erros|faltas|minutos|PRA|points|rebounds|assists|3-?point|steals|blocks|turnovers)/i;
  const looksLikeAPlayerLine = names.test(leg.selection) && !/^(mais|menos) de [\d.,]+ (gols|pontos no jogo)/i.test(leg.selection);
  switch (leg.settlementType) {
    case "player_prop":
      return !!leg.settlementPlayer && !!leg.settlementStat && leg.settlementLine !== null && (leg.settlementSide === "over" || leg.settlementSide === "under");
    case "total":
      // A game total never names a player, and a line that reads like a player's stat is not one.
      return !leg.settlementPlayer && !looksLikeAPlayerLine && leg.settlementLine !== null && (leg.settlementSide === "over" || leg.settlementSide === "under");
    case "spread":
      return !!leg.settlementTeam && !leg.settlementPlayer && leg.settlementLine !== null;
    case "moneyline":
      return !!leg.settlementTeam && !leg.settlementPlayer;
    case "other":
      // Nothing grades "other"; it would be voided at best and mis-graded at worst.
      return false;
    default:
      return false;
  }
}

export type RawLeg = z.infer<typeof LegSchema>;

export const SlateSchema = z.object({
  suggestions: z.array(SuggestionSchema),
  dataNote: z.string().describe("What was missing or thin in the inputs, so the reader can weigh the tickets."),
});



/**
 * Said once, above the lines, whenever the game is already under way: the posted prices are
 * pre-game references. ESPN's prop feed does not move after tip-off and there is no live odds
 * source wired in, so a price here is a reference, never something to quote as available now. The
 * legs the box score had already decided are gone before this point (props/stale.ts); the ones that
 * remain carry what they still need.
 */
const IN_PLAY_NOTE =
  "IN PLAY — this game has already started. Every price below is a PRE-GAME REFERENCE: the prop feed does not update once the ball is up and no live odds source is configured, so treat the numbers as references and say so. Legs the box score has already decided were removed; each line carries what it still needs and how much of regulation is left.";

const pct = (x: number) => `${Math.round(x * 100)}%`;

/**
 * The computed side of a candidate: the probability the arithmetic gives the line, the ladder
 * beside it, the minutes it stands on, and in play the requirement per remaining minute against
 * the rate produced tonight. Every number here was computed in code; the model reads, it does not
 * recompute.
 */
export function describeModel(p: PropRow): string {
  const m = p.model;
  if (!m) return "";
  const side = p.side === "under" ? "under" : "over";
  const rungs = m.ladder
    .filter((r) => Math.abs(r.line - (p.line ?? NaN)) > 1e-9)
    .map((r) => `${side === "over" ? "o" : "u"}${r.line} ${pct(side === "over" ? r.pOver : r.pUnder)}`)
    .join(", ");
  const availability = m.minutes.availability === "listed_out" ? " ⚠ LISTED OUT" : m.minutes.availability === "questionable" ? " ⚠ questionable" : "";
  if (m.live) {
    const l = m.live;
    const verb = side === "under" ? "room for" : "needs";
    const need = l.needed > 0
      ? `${verb} ${l.needed} more in ~${l.remainingMinutes} min = ${l.needPerMinute >= 99 ? "∞" : l.needPerMinute.toFixed(2)}/min`
      : side === "under" ? "no room left: the next one busts it" : "needs nothing more";
    return ` | COMPUTED ${pct(m.computed)} — ${need}, vs ${l.ratePerMinuteTonight.toFixed(2)}/min tonight (${l.minutesPlayed} min played${l.fouls >= 3 ? `, ${l.fouls} PF` : ""}), ${l.ratePerMinutePreGame.toFixed(2)}/min pre-game (the rate used for the rest); projected final ${m.mean} ± ${m.sd}${rungs ? ` [ladder ${rungs}]` : ""}`;
  }
  return ` | COMPUTED ${pct(m.computed)} (distribution ${pct(m.distribution)}; ${m.note}; minutes ${m.minutes.expected} ± ${m.minutes.sd}${availability}; rate ${m.rate}/min, L5 ${m.recentRate}/min)${rungs ? ` [ladder ${rungs}]` : ""}`;
}

/** Exported for the stale-line tests: the in-play marker has to reach the model, not just exist. */
export function describeProps(props: PropRow[]): string {
  if (!props.length) return "- none gathered";
  const lines = props
    .map((p) => {
      const measured = p.measured;
      const measuredText = measured
        ? ` | MEASURED ${measured.side} ${measured.line} ${measured.stat}: L5 ${measured.last5.hits}/${measured.last5.of}, L10 ${measured.last10.hits}/${measured.last10.of}, season ${measured.season.hits}/${measured.season.of} (${(measured.impliedFair * 100).toFixed(0)}%), avg ${measured.average}, median ${measured.median} [${measured.sampleNote}]`
        : " | MEASURED: none — no game log matched this player/market";
      const liveText = p.live
        ? ` | LIVE: ${p.live.current} so far, ${p.side === "under" ? `room for ${p.live.remaining} more` : `${p.live.remaining} to go`}, ~${p.live.minutesLeft} min of regulation left`
        : "";
      return `- ${p.player} ${p.market} ${p.side ?? ""} ${p.line ?? "?"} @ ${p.odds ?? "no price"} (${p.book ?? "?"})${p.note ? ` [${p.note}]` : ""}${p.projection !== undefined ? ` toolProj ${p.projection}` : ""}${p.edgePct !== undefined ? ` toolEdge ${p.edgePct}%` : ""}${measuredText}${liveText}${describeModel(p)}`;
    });
  return props.some((p) => p.live) ? [IN_PLAY_NOTE, ...lines].join("\n") : lines.join("\n");
}

export interface BuildArgs {
  game: Game;
  detail: GameDetail;
  /** Positional matchups derived from lineups; empty when no lineup was available. */
  duels?: Duel[];
  /** Card environment. The strongest evidenced angle in soccer. */
  referee?: RefereeSignal | null;
  /** What each defence concedes by position. The defensible form of "player vs team". */
  dvp?: { home: DvpProfile | null; away: DvpProfile | null };
  /**
   * The players' own seasons cut by venue and by tonight's opponent, already through the sample
   * gate. Pre-game only: a live read has the night's real production, which beats a season average.
   */
  splits?: PlayerSplits[];
  /** Both sides' season rates with their league ranks — what "fast" and "slow" mean in this league. */
  teamSeason?: TeamSeasonMatchup | null;
  /** The same prop as posted by every source, for line shopping and disagreement. */
  consensus?: ConsensusProp[];
  /** Minutes and role, which gate whether any matchup edge can be reached. */
  roles?: RoleProfile[];
  /** Present once the match has kicked off; changes the question from 90 minutes to what is left. */
  live?: LiveState | null;
  /**
   * Whether this build is a read taken with the game under way, whatever the sport.
   *
   * `live` above carries SOCCER state and is null for a basketball quarter read, whose in-play
   * context travels in `extraContext` — so `!!live` answers "is this soccer, in play", never "is
   * this in play". On 23/09/2026 the availability gate read `!!live`, decided a half-time read was
   * a pre-game build, and applied the 20-minute floor to minutes that were the REMAINDER of the
   * game: every ticket of the Q2 read was dropped and the read published nothing. The flag is
   * explicit so a sport without a structured live slot cannot be mistaken for a game that has not
   * started.
   */
  inPlay?: boolean;
  /** Open/current/close game lines: anchor prices and show movement. */
  lines?: ProviderLines[];
  /** Live reads and previews are not logged to the public ledger. */
  record?: boolean;
  /** Defaults to the judgement model. */
  model?: string;
  /** In-play context that has no structured slot (the basketball live read). */
  extraContext?: string;
  /** Thinking effort for the judgement call; the live read asks for less, the auto-adjust ladder lowers it further on a cut. */
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  /** Pace, blowout risk and rest for the matchup; computed here from the schedules when not supplied. */
  environment?: GameEnvironment | null;
  /** One minutes projection per player; derived from the candidate rows when not supplied. */
  minutes?: MinutesProjection[];
  props: PropRow[];
  picks: PickRow[];
  dimers: PickRow[];
  x: XIntel | null;
  bands: string[];
  lang: Lang;
  maxPerBand?: number;
}

/**
 * The model proposes selections and reasoning; every number below is computed here.
 * Compounding decimal odds across eight legs is exactly the arithmetic a language model gets
 * subtly wrong, and a wrong payout number would be the most damaging error this app could make.
 */
/**
 * Scores how well-evidenced a ticket actually is, separately from the model's self-reported
 * confidence. A model can say "high" about a ticket built on nothing; this cannot.
 */
function scoreEvidence(legs: BetLeg[]): { score: number; notes: string[] } {
  const notes: string[] = [];
  let score = 100;

  const unpriced = legs.filter((l) => !Number.isFinite(l.oddsDecimal) || l.oddsDecimal <= 1).length;
  if (unpriced) {
    score -= unpriced * 20;
    notes.push(`${unpriced} leg${unpriced === 1 ? "" : "s"} without a verified market price`);
  }

  const measured = legs.filter((l) => /measured|hit rate|game log/i.test(l.evidence)).length;
  const unsupported = legs.filter((l) => /no measured support|none|sem suporte/i.test(l.evidence)).length;
  if (unsupported) {
    score -= unsupported * 15;
    notes.push(`${unsupported} leg${unsupported === 1 ? "" : "s"} with no measured support`);
  }
  if (measured) notes.push(`${measured} leg${measured === 1 ? "" : "s"} backed by measured history`);

  // Every extra leg multiplies the ways a ticket can break.
  if (legs.length > 4) {
    score -= (legs.length - 4) * 6;
    notes.push(`${legs.length} legs — each one is another way to lose`);
  }

  return { score: Math.max(0, Math.min(100, Math.round(score))), notes };
}

export function priceSuggestion(
  raw: z.infer<typeof SuggestionSchema>,
  bandKey: string,
): BetSuggestion | null {
  const legs: BetLeg[] = [];
  for (const leg of raw.legs) {
    // A settlement descriptor that does not match its own selection is how a ticket gets graded
    // against the wrong thing: on 22/09/2026 "Kamilla Cardoso under 8.5 rebotes" was emitted as a
    // game `total` and settled against the final score (182 vs 8.5), losing a ticket that had
    // nothing to do with the game's points. The leg is dropped here rather than graded later.
    if (!settlementIsCoherent(leg)) return null;
    // A leg that names no evidence is a guess wearing a probability. It is dropped with the ticket,
    // the same way an incoherent settlement is: publishing it would put a number on nothing.
    if (!hasEvidence(leg.sourceBasis)) return null;
    const decimal = parseOdds(leg.odds);
    legs.push({
      selection: leg.selection,
      market: leg.market,
      odds: leg.odds || "—",
      oddsDecimal: decimal,
      book: leg.book ?? undefined,
      explanation: leg.explanation,
      evidence: leg.evidence,
      fairProbability: Math.min(Math.max(leg.fairProbability, 0.001), 0.999),
      gameId: leg.gameId ?? undefined,
      settlement: {
        type: leg.settlementType,
        teamAbbreviation: leg.settlementTeam ?? undefined,
        player: leg.settlementPlayer ?? undefined,
        stat: leg.settlementStat ?? undefined,
        line: leg.settlementLine ?? undefined,
        side: leg.settlementSide ?? undefined,
        sourceBasis: leg.sourceBasis,
      },
    });
  }

  const priced = legs.filter((l) => Number.isFinite(l.oddsDecimal) && l.oddsDecimal > 1);
  // Every leg needs a published price. A leg without one (a player prop measured from game logs,
  // with no book line attached) would make the shown payout — and the public ROI — smaller than the
  // ticket really is, so the whole ticket is dropped rather than shown with a made-up number.
  if (!legs.length || priced.length !== legs.length) return null;

  const combinedDecimal = parlayDecimal(priced.map((l) => l.oddsDecimal));
  const modelled = legs.reduce((acc, l) => acc * l.fairProbability, 1);
  // EV is only meaningful when every leg carries a price. With an unpriced leg the payout is
  // unknown, so reporting a number here would invent precision the ticket does not have.
  // With any leg unpriced the payout is unknown, so EV stays undefined rather than being reported
  // for the priced subset — that would label a two-leg ticket with one leg's edge.
  const ev =
    priced.length === legs.length
      ? expectedValue(priced.map((l) => l.oddsDecimal), priced.map((l) => l.fairProbability))
      : NaN;

  const evidence = scoreEvidence(legs);

  return {
    id: ticketId(bandKey, legs.map((l) => l.selection)),
    kind: legs.length > 1 ? "parlay" : "single",
    bandKey,
    title: raw.title,
    background: raw.background,
    legs,
    combinedDecimal,
    combinedAmerican: formatAmerican(combinedDecimal),
    impliedProbability: impliedProbability(combinedDecimal),
    modelledProbability: modelled,
    edgePct: Number.isFinite(ev) ? ev * 100 : NaN,
    riskNote: raw.riskNote,
    confidence: raw.confidence,
    evidenceScore: evidence.score,
    evidenceNotes: evidence.notes,
  };
}

/**
 * Same-game legs re-priced together. The independent product is what the legs' probabilities give;
 * the factor (signals/correlation.ts) is what sharing a player, a team or a scoreboard does to it.
 * Cross-game tickets hold one leg per game and are left alone. A ticket with two rungs of the same
 * stat on one player is dropped (null), like a ticket with an unpriced leg: the second rung adds
 * price and no probability, no book pays that product, and the prompt forbids the pair — pricing
 * it would show an edge that does not exist. An impossible pair (over 25.5 and under 20.5) is
 * dropped the same way.
 *
 * A leg the feed did not carry (priced from the model's own text) has no athlete id of its own; the
 * player is resolved by name against the candidate rows so two legs on one player are never priced
 * as strangers.
 */
export function applyCorrelation(bet: BetSuggestion, ctx: EnrichContext): BetSuggestion | null {
  if (bet.legs.length < 2 || independentGames(bet)) return bet;
  const people = [...new Map(ctx.props.filter((p) => p.athleteId).map((p) => [p.athleteId!, { id: p.athleteId!, name: p.player, team: p.team }])).values()];
  const legs: CorrLeg[] = bet.legs.map((l) => {
    const prop = matchedProp(l, ctx);
    const s = l.settlement;
    const resolved = s?.type === "player_prop" && s.player ? matchAthlete(s.player, people) : null;
    const person = resolved ? people.find((x) => x.id === resolved.id) : undefined;
    return {
      athleteId: l.athleteId ?? prop?.athleteId ?? resolved?.id,
      player: s?.player,
      team: prop?.team ?? person?.team ?? s?.teamAbbreviation,
      type: s?.type ?? "other",
      labels: s?.type === "player_prop" ? resolveStatLabels(s.stat ?? "", ctx.sportKey) : null,
      line: s?.line,
      side: s?.side,
      probability: l.fairProbability,
      series: prop?.series,
    };
  });
  const dk = ctx.lines?.find((l) => /draftkings/i.test(l.provider))?.current;
  const result = ticketCorrelation(legs, { homeAbbr: ctx.game?.home.abbreviation, awayAbbr: ctx.game?.away.abbreviation, spread: dk?.spread ?? ctx.game?.odds?.spread ?? null });
  if (result.redundant || result.impossible) return null;
  if (!result.pairs.length) return bet;
  const modelled = result.probability;
  return {
    ...bet,
    modelledProbability: modelled,
    edgePct: Number.isFinite(bet.combinedDecimal) ? (modelled * bet.combinedDecimal - 1) * 100 : NaN,
    correlation: { factor: result.factor, independentProbability: result.independent, note: result.note },
  };
}

/** The candidate row a priced leg came from, by athlete and exact line. */
function matchedProp(leg: BetLeg, ctx: EnrichContext): PropRow | null {
  const s = leg.settlement;
  if (!s || s.type !== "player_prop" || !leg.athleteId || s.line === undefined) return null;
  const wanted = resolveStatLabels(s.stat ?? "", ctx.sportKey);
  const markets = getSport(ctx.sportKey).markets;
  return ctx.props.find((p) => p.athleteId === leg.athleteId && Math.abs((p.line ?? NaN) - s.line!) < 0.01 && (p.side ?? "over") === (s.side ?? "over") &&
    JSON.stringify(markets.find((m) => m.key === p.marketKey)?.statLabels ?? null) === JSON.stringify(wanted)) ?? null;
}

/**
 * Anchors every leg to the posted price, prices each ticket in code, attaches the measured record
 * and the computed probability, applies same-game correlation and orders the result. The model's
 * own odds text is used only where no feed carries the market.
 */
/**
 * The stated chance replaced by the corrected one, where the record has enough settled legs to earn
 * a correction. The model's own number survives as `rawProbability`, so the ledger can still race
 * what it said against what it was served with.
 */
function calibrated(leg: BetLeg, calibrator: Calibrator, sportKey: string): BetLeg {
  const stat = canonicalMarket(leg, sportKey);
  const { probability, correction } = calibrator.apply(leg.fairProbability, leg.settlement?.sourceBasis ?? "", leg.market, stat);
  if (!correction || probability === leg.fairProbability) return leg;
  return { ...leg, rawProbability: leg.rawProbability ?? leg.fairProbability, fairProbability: probability };
}

/**
 * Prices a build's raw suggestions and applies every gate that decides what gets emitted.
 *
 * `onDrop` hears about the tickets the slate-level gates removed, with the reason, so the caller can
 * log them; pricing's own drops (an unpriced leg, an incoherent settlement, two rungs of one stat)
 * stay silent as they always were, because those are malformed tickets rather than rejected ones.
 */
export function priceAll(raws: RawSuggestion[], ctx: EnrichContext, opts: { oneLegPerGame?: boolean; live?: boolean; onDrop?: (drop: GateDrop) => void } = {}): BetSuggestion[] {
  // Read the record once for the whole slate: the correction is the same for every ticket in it.
  // A read taken with the game under way answers to the live record, which is the harsher one.
  const calibrator = calibratorFor(opts.live ? "live" : "pre");
  const items = raws.map((raw) => {
    const anchored: RawSuggestion = { ...raw, legs: raw.legs.map((l) => ({ ...l, odds: anchoredOdds(l, ctx) })) };
    const decimalGuess = parlayDecimal(
      anchored.legs.map((l) => parseOdds(l.odds)).filter((d) => Number.isFinite(d) && d > 1),
    );
    // Classify by the price actually computed, not by whatever band the model thought it hit.
    const band = ODDS_BANDS.find((b) => decimalGuess >= b.min && decimalGuess < b.max);
    let priced = priceSuggestion(anchored, band?.key ?? "unbanded");
    // Books discount legs from the same game, so a product of their prices would overstate the payout.
    if (priced && opts.oneLegPerGame && !independentGames(priced)) priced = null;
    // Who is playing, before anything is said about how she plays. Pre-game only: see bets/gates.ts.
    if (priced && !opts.live) {
      const reason = unplayableReason(anchored.legs, ctx);
      if (reason) {
        opts.onDrop?.({ ticketId: priced.id, gate: "availability", reason });
        priced = null;
      }
    }
    if (priced) {
      // The computed probability anchors fairProbability inside enrichLeg, so the ticket's numbers are
      // recomputed from the anchored legs before correlation is applied.
      const legs = priced.legs.map((leg, j) => calibrated(enrichLeg(leg, anchored.legs[j], ctx), calibrator, ctx.sportKey));
      const modelled = legs.reduce((acc, l) => acc * l.fairProbability, 1);
      priced = applyCorrelation({
        ...priced, legs, modelledProbability: modelled,
        edgePct: Number.isFinite(priced.combinedDecimal) ? (modelled * priced.combinedDecimal - 1) * 100 : NaN,
      }, ctx);
    }
    return { alternativeOf: raw.alternativeOf, swapReason: raw.swapReason, priced };
  });
  // The by-player cap is counted over the tickets this build actually returns, so it runs last, once
  // the alternatives know which main they belong to.
  const { kept, dropped } = capPlayerConcentration(linkAlternatives(items));
  for (const drop of dropped) opts.onDrop?.(drop);
  return kept;
}

/** A cross-game ticket needs one leg per game, each leg naming its game. */
export function independentGames(bet: Pick<BetSuggestion, "legs">): boolean {
  const ids = bet.legs.map((l) => l.gameId);
  return ids.every((id) => !!id) && new Set(ids).size === ids.length;
}

/** One minutes projection per player, from the candidate rows, for the prompt block. */
export function minutesFromProps(props: PropRow[]): MinutesProjection[] {
  const seen = new Map<string, MinutesProjection>();
  for (const p of props) {
    const m = p.minutesProjection;
    if (!m || seen.has(m.player)) continue;
    seen.set(m.player, { player: m.player, expected: m.expected, sd: m.sd, availability: m.availability, note: m.note, baseline: { recent5: NaN, recent10: NaN, season: NaN, trend: 0, games: 0, sd: NaN }, blowoutProbability: NaN, baselineBlowout: NaN, adjustments: [] });
  }
  return [...seen.values()];
}

/** The minutes block: the full projection when the caller supplied it, the per-row note otherwise. */
function minutesBlock(projections: MinutesProjection[]): string {
  if (!projections.length) return "";
  if (projections.some((p) => p.adjustments.length || Number.isFinite(p.baseline.recent5))) return minutesPrompt(projections);
  return [
    "MINUTES PROJECTION — computed from the game log, the injury report and the spread; the number every counting-stat leg stands on:",
    ...projections.slice(0, 14).map((p) => `- ${p.player}: ${p.note}${p.availability === "listed_out" ? " ⚠ LISTED OUT" : p.availability === "questionable" ? " ⚠ questionable" : ""}`),
    "A leg needs the minutes before it needs anything else. Treat a LISTED OUT player as unplayable until the report changes; a questionable one widens every line on her.",
  ].join("\n");
}

export async function buildBets(args: BuildArgs): Promise<BetSlate> {
  const { game, detail, props, picks, dimers, x, bands, lang, duels = [], referee = null, dvp, splits = [], teamSeason = null, consensus = [], roles = [], live = null, maxPerBand = 2, effort, lines = [], record = true } = args;
  // Grade anything finished first, so this build reasons over the newest track record.
  await settlePending(10).catch(() => null);
  const targets = bands.map((b) => getBand(b));
  const isBasketball = getSport(game.sportKey).group === "basketball";
  // Two cached schedule reads, no model call; a failure leaves the block as "not computed".
  const environment = args.environment !== undefined ? args.environment : isBasketball ? await gameEnvironment(detail, lines).catch(() => null) : null;
  const minutes = args.minutes ?? (isBasketball ? minutesFromProps(props) : []);

  const marketLines = detail.books.length
    ? detail.books
        .map((b) => `- ${b.provider}: ${b.details ?? "?"} (${b.homeSpreadOdds ?? "?"}/${b.awaySpreadOdds ?? "?"}), total ${b.overUnder ?? "?"} (o${b.overOdds ?? "?"}/u${b.underOdds ?? "?"}), ML ${b.awayMoneyline ?? "?"}/${b.homeMoneyline ?? "?"}`)
        .join("\n")
    : "- no book lines published";

  // A basketball quarter read has no `live` state (that field is soccer's), and reading `!!live` for
  // "is the game under way" is what made the gate treat a half-time read as a pre-game build.
  const inPlay = args.inPlay ?? !!live;

  const prompt = [
    `GAME: ${game.away.displayName} at ${game.home.displayName}`,
    game.tournament ? `TOURNAMENT: ${game.tournament} — ${game.round ?? ""}` : "",
    `TIPOFF (UTC): ${game.startsAt}`,
    "",
    `PUBLISHED MARKET:\n${marketLines}`,
    "",
    `INJURIES:\n${detail.injuries.map((i) => `- ${i.player} (${i.teamAbbreviation}): ${i.status}${i.detail ? ` — ${i.detail}` : ""}`).join("\n") || "- none listed"}`,
    "",
    `PLAYER PROPS WITH MEASURED HISTORY:\n${describeProps(props)}`,
    "",
    `PUBLISHED PICKS:\n${[...picks, ...dimers].map((p) => `- ${p.market}: ${p.selection} @ ${p.odds ?? "?"} (${p.book ?? "?"}) ${p.confidence ?? ""} — ${p.rationale ?? ""}`).join("\n") || "- none gathered"}`,
    "",
    `INSIDER REPORTING:\n${x?.items.length ? x.items.map((i) => `- @${i.handle} [${i.relevance}]: ${i.text.replace(/\s+/g, " ").slice(0, 250)}`).join("\n") : "- none gathered"}`,
    "",
    `PLAYER MARKETS AVAILABLE IN THIS SPORT:\n${marketCatalogue(getSport(game.sportKey), lang)}`,
    live ? livePrompt(live, referee?.yellowsPerGame ?? null, lang) : "",
    args.extraContext ?? "",
    "",
    consensusPrompt(consensus),
    "",
    isBasketball ? environmentPrompt(environment) : "",
    isBasketball ? minutesBlock(minutes) : "",
    rolePrompt(roles),
    "",
    refereePrompt(referee),
    "",
    dvpPrompt(dvp?.home ?? null, dvp?.away ?? null),
    "",
    // Both blocks are season context: pre-game only, because a read taken with the game under way
    // already carries the night's real production, which beats any season average.
    isBasketball && !inPlay ? teamSeasonPrompt(teamSeason) : "",
    isBasketball && !inPlay ? splitsPrompt(splits) : "",
    "",
    duelsPrompt(duels),
    "",
    calibrationPrompt(),
    "",
    `REQUESTED ODDS BANDS — build up to ${maxPerBand} tickets per band:`,
    ...targets.map((b) => `- ${b.key}: combined ${b.min}x to ${b.max}x (${b.typicalLegs}). Set bandKey to "${b.key}".`),
    "",
    `Return the bandKey on each suggestion via its title prefix is not needed — instead order suggestions from shortest odds to longest.`,
    "Every leg must carry a price that appears above. Measured player history without a published price is context for your reasoning, not a leg: a ticket with an unpriced leg is discarded.",
  ]
    .filter(Boolean)
    .join("\n");

  const result = await generateStructured({
    schema: SlateSchema,
    system: getPrompt("game", lang),
    prompt,
    maxTokens: JUDGEMENT_MAX_TOKENS,
    effort,
    label: inPlay ? "live" : "game",
    model: args.model,
    mock: () => mockGameSlate({ game, detail, props, lang, bands, live: !!live }),
  });

  const suggestions = priceAll(result.suggestions, { props, sportKey: game.sportKey, game, lines }, {
    live: inPlay,
    // A dropped ticket leaves a line behind: without it the only visible trace is a shorter slate.
    onDrop: (drop) => logEvent("bets.gate.dropped", { ...drop, gameId: game.id, sportKey: game.sportKey, scope: inPlay ? "live" : "pre" }),
  });

  // Log every ticket at generation time so it can be graded once the game finishes. The ledger keeps
  // the computed probability beside the model's per leg (SettledLeg.computedProbability), which is
  // what ledger/calibrate.ts races once the legs settle.
  // TODO(leg_prices): server/leg-prices.ts is owned by the price-integration work; when it is next
  // touched, add an additive column `computedProb REAL` to leg_prices (addColumn, idempotent) and
  // pass leg.computedProbability through recordLegPrices so CLV and the model can be read together.
  // TODO(ui): BetSuggestion.correlation (factor, independent probability, note) is carried on every
  // same-game ticket and nothing renders it yet; the ticket card should print it beside the chance.
  if (record) {
    recordPredictions(game, suggestions, {
      environment: environment ? { blowoutProbability: environment.blowoutProbability, paceDelta: environment.paceDelta } : null,
      // Which prompt wrote it and which model answered: `ledger/ab.ts` reads exactly these two.
      provenance: { promptVersion: getPromptVersion("game", lang).id, modelId: args.model ?? MODEL, generatedBy: live ? "live" : "game" },
    });
    recordLegPrices(suggestions.flatMap((s) => s.legs.map((leg, legIndex) => ({
      ledgerId: ledgerIdFor(game.id, s), legIndex, gameId: game.id, sportKey: game.sportKey, startsAt: game.startsAt, homeAbbr: game.home.abbreviation, leg,
    }))));
  }
  return { suggestions, dataNote: result.dataNote };
}



export interface SlateBuildArgs {
  games: { game: Game; detail: GameDetail; props?: PropRow[] }[];
  bands: string[];
  lang: Lang;
  maxPerBand?: number;
}

/**
 * Cross-game tickets. A single game publishes three or four markets, which cannot compound past
 * roughly 20x — reaching 100x or 400x requires stacking independent games, and independence is
 * exactly what makes the probability maths honest here.
 */
export async function buildSlateBets(args: SlateBuildArgs): Promise<BetSlate> {
  const { games, bands, lang, maxPerBand = 1 } = args;
  await settlePending(10).catch(() => null);
  const targets = bands.map((b) => getBand(b));

  const gameBlocks = games
    .map(({ game, detail, props }) => {
      const books = detail.books.length
        ? detail.books
            .map((bk) => `    ${bk.provider}: ${bk.details ?? "?"}, total ${bk.overUnder ?? "?"} (o${bk.overOdds ?? "?"}/u${bk.underOdds ?? "?"}), ML ${bk.awayMoneyline ?? "?"}/${bk.homeMoneyline ?? "?"}`)
            .join("\n")
        : "    no published lines";
      const outs = detail.injuries
        .filter((i) => /out|doubtful/i.test(i.status))
        .map((i) => `${i.player} (${i.teamAbbreviation}) ${i.status}`)
        .join("; ");
      return [
        `GAME ${game.id}: ${game.away.displayName} (${game.away.record ?? "?"}) at ${game.home.displayName} (${game.home.record ?? "?"}) — ${game.startsAt}`,
        books,
        `    key absences: ${outs || "none listed"}`,
        `    player prop material:\n${describeProps(props ?? []).split("\n").map((l) => `    ${l}`).join("\n")}`,
      ].join("\n");
    })
    .join("\n\n");

  const prompt = [
    `SLATE: ${games.length} games available for cross-game tickets.`,
    "",
    gameBlocks,
    "",
    `PLAYER MARKETS AVAILABLE IN THIS SPORT:\n${
      games.length ? marketCatalogue(getSport(games[0].game.sportKey), lang) : "-"
    }`,
    "",
    calibrationPrompt(),
    "",
    `REQUESTED ODDS BANDS — build up to ${maxPerBand} tickets per band:`,
    ...targets.map((b) => `- ${b.key}: combined ${b.min}x to ${b.max}x (${b.typicalLegs})`),
    "",
    "Only use prices that appear above. If a band cannot be reached with the published prices, skip it and say so in dataNote.",
    "Every leg must set gameId to the GAME id it belongs to, and a ticket may hold at most ONE leg per game: books discount same-game legs, so a ticket with two legs from one game is discarded.",
  ].join("\n");

  const result = await generateStructured({
    schema: SlateSchema,
    system: getPrompt("slate", lang),
    prompt,
    maxTokens: JUDGEMENT_MAX_TOKENS,
    label: "slate",
    mock: () => mockSlateBets({ games, lang }),
  });

  const allProps = games.flatMap((g) => g.props ?? []);
  const suggestions = priceAll(result.suggestions, { props: allProps, sportKey: games[0]?.game.sportKey ?? "" }, {
    oneLegPerGame: true,
    onDrop: (drop) => logEvent("bets.gate.dropped", { ...drop, gameId: "slate", sportKey: games[0]?.game.sportKey ?? "", scope: "slate" }),
  });

  // Cross-game tickets are logged against a synthetic game id so they can still be settled per leg.
  if (games.length) {
    // Label it as what it is; using the first game's matchup made a slate ticket look single-game.
    const label = `${games.length} ${games[0].game.sportKey} games`;
    const slateId = `slate:${games.map((g) => g.game.id).join("+")}`.slice(0, 120);
    recordPredictions(
      {
        ...games[0].game,
        id: slateId,
        home: { ...games[0].game.home, displayName: label, name: label },
        away: { ...games[0].game.away, displayName: "cross-game", name: "cross-game" },
      },
      suggestions,
      // Public only once every game on it has started; before that the remaining legs are still bettable.
      {
        startsAt: games.map((g) => g.game.startsAt).filter(Boolean).sort().at(-1),
        provenance: { promptVersion: getPromptVersion("slate", lang).id, modelId: MODEL, generatedBy: "slate" },
      },
    );
    // Each leg is closed against its own game.
    const byId = new Map(games.map((g) => [g.game.id, g.game]));
    recordLegPrices(suggestions.flatMap((s) => s.legs.flatMap((leg, legIndex) => {
      const g = leg.gameId ? byId.get(leg.gameId) : undefined;
      return g ? [{ ledgerId: ledgerIdFor(slateId, s), legIndex, gameId: g.id, sportKey: g.sportKey, startsAt: g.startsAt, homeAbbr: g.home.abbreviation, leg }] : [];
    })));
  }

  return { suggestions, dataNote: result.dataNote };
}
