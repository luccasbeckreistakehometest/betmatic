import { z } from "zod";
import { generateStructured } from "@/lib/ai/extract";
import { getPrompt } from "@/lib/server/prompts";
import { calibrationPrompt } from "@/lib/ledger/calibrate";
import { ledgerIdFor, recordPredictions } from "@/lib/ledger/store";
import { recordLegPrices } from "@/lib/server/leg-prices";
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
import { consensusPrompt, type ConsensusProp } from "@/lib/props/consensus";
import { livePrompt, type LiveState } from "@/lib/live/state";
import { rolePrompt, type RoleProfile } from "@/lib/props/role";
import { anchoredOdds, enrichLeg, type EnrichContext } from "@/lib/bets/enrich";
import { linkAlternatives, ticketId } from "@/lib/bets/alternatives";
import type { ProviderLines } from "@/lib/sources/espn-props";
import { mockGameSlate, mockSlateBets } from "@/lib/ai/mocks";

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

function describeProps(props: PropRow[]): string {
  if (!props.length) return "- none gathered";
  const lines = props
    .map((p) => {
      const measured = p.measured;
      const measuredText = measured
        ? ` | MEASURED ${measured.side} ${measured.line} ${measured.stat}: L5 ${measured.last5.hits}/${measured.last5.of}, L10 ${measured.last10.hits}/${measured.last10.of}, season ${measured.season.hits}/${measured.season.of} (${(measured.impliedFair * 100).toFixed(0)}%), avg ${measured.average}, median ${measured.median} [${measured.sampleNote}]`
        : " | MEASURED: none — no game log matched this player/market";
      const liveText = p.live ? ` | LIVE: ${p.live.current} so far, ${p.live.remaining} to go, ~${p.live.minutesLeft} min of regulation left` : "";
      return `- ${p.player} ${p.market} ${p.side ?? ""} ${p.line ?? "?"} @ ${p.odds ?? "no price"} (${p.book ?? "?"})${p.note ? ` [${p.note}]` : ""}${p.projection !== undefined ? ` toolProj ${p.projection}` : ""}${p.edgePct !== undefined ? ` toolEdge ${p.edgePct}%` : ""}${measuredText}${liveText}`;
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
  /** The same prop as posted by every source, for line shopping and disagreement. */
  consensus?: ConsensusProp[];
  /** Minutes and role, which gate whether any matchup edge can be reached. */
  roles?: RoleProfile[];
  /** Present once the match has kicked off; changes the question from 90 minutes to what is left. */
  live?: LiveState | null;
  /** Open/current/close game lines: anchor prices and show movement. */
  lines?: ProviderLines[];
  /** Live reads and previews are not logged to the public ledger. */
  record?: boolean;
  /** Defaults to the judgement model. */
  model?: string;
  /** In-play context that has no structured slot (the basketball live read). */
  extraContext?: string;
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
 * Anchors every leg to the posted price, prices each ticket in code, attaches the measured record and
 * orders the result. The model's own odds text is used only where no feed carries the market.
 */
export function priceAll(raws: RawSuggestion[], ctx: EnrichContext, opts: { oneLegPerGame?: boolean } = {}): BetSuggestion[] {
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
    return {
      alternativeOf: raw.alternativeOf,
      swapReason: raw.swapReason,
      priced: priced ? { ...priced, legs: priced.legs.map((leg, j) => enrichLeg(leg, anchored.legs[j], ctx)) } : null,
    };
  });
  return linkAlternatives(items);
}

/** A cross-game ticket needs one leg per game, each leg naming its game. */
export function independentGames(bet: Pick<BetSuggestion, "legs">): boolean {
  const ids = bet.legs.map((l) => l.gameId);
  return ids.every((id) => !!id) && new Set(ids).size === ids.length;
}

export async function buildBets(args: BuildArgs): Promise<BetSlate> {
  const { game, detail, props, picks, dimers, x, bands, lang, duels = [], referee = null, dvp, consensus = [], roles = [], live = null, maxPerBand = 2, lines = [], record = true } = args;
  // Grade anything finished first, so this build reasons over the newest track record.
  await settlePending(10).catch(() => null);
  const targets = bands.map((b) => getBand(b));

  const marketLines = detail.books.length
    ? detail.books
        .map((b) => `- ${b.provider}: ${b.details ?? "?"} (${b.homeSpreadOdds ?? "?"}/${b.awaySpreadOdds ?? "?"}), total ${b.overUnder ?? "?"} (o${b.overOdds ?? "?"}/u${b.underOdds ?? "?"}), ML ${b.awayMoneyline ?? "?"}/${b.homeMoneyline ?? "?"}`)
        .join("\n")
    : "- no book lines published";

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
    rolePrompt(roles),
    "",
    refereePrompt(referee),
    "",
    dvpPrompt(dvp?.home ?? null, dvp?.away ?? null),
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
    maxTokens: 16000,
    label: live ? "live" : "game",
    model: args.model,
    mock: () => mockGameSlate({ game, detail, props, lang, bands, live: !!live }),
  });

  const suggestions = priceAll(result.suggestions, { props, sportKey: game.sportKey, game, lines });

  // Log every ticket at generation time so it can be graded once the game finishes.
  if (record) {
    recordPredictions(game, suggestions);
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
    maxTokens: 16000,
    label: "slate",
    mock: () => mockSlateBets({ games, lang }),
  });

  const allProps = games.flatMap((g) => g.props ?? []);
  const suggestions = priceAll(result.suggestions, { props: allProps, sportKey: games[0]?.game.sportKey ?? "" }, { oneLegPerGame: true });

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
      { startsAt: games.map((g) => g.game.startsAt).filter(Boolean).sort().at(-1) },
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
