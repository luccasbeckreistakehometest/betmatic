import { z } from "zod";
import { generateStructured } from "@/lib/ai/extract";
import { calibrationPrompt } from "@/lib/ledger/calibrate";
import { recordPredictions } from "@/lib/ledger/store";
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
import { rolePrompt, type RoleProfile } from "@/lib/props/role";

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
  isAlternative: z.boolean().describe("True when this ticket is a fallback for the one before it."),
  title: z.string().describe("Short label for the ticket."),
  background: z.string().describe("The situation that makes this worth a look: matchup context, injury picture, market read. Two or three sentences."),
  legs: z.array(LegSchema).min(1),
  riskNote: z.string().describe("What most plausibly breaks this ticket."),
  confidence: z.enum(["high", "medium", "low"]),
});

const SlateSchema = z.object({
  suggestions: z.array(SuggestionSchema),
  dataNote: z.string().describe("What was missing or thin in the inputs, so the reader can weigh the tickets."),
});

const SYSTEM_EN = `You build betting tickets for one game from gathered research, across a requested odds range.

Hard rules:
- Every leg must trace to a supplied fact: a measured hit rate, an injury line, an insider post, or a published price. Never invent a player, a line, or a price.
- fairProbability is your honest estimate of the leg landing. When a measured hit rate is supplied, anchor to it. Do not inflate it to make a ticket look good.
- Longer odds mean lower probability, not more skill. A big parlay is a low-probability ticket and your language must reflect that.
- Prefer legs that are correlated in the bettor's favour when building parlays, and say so in the background.
- If the gathered data cannot support a ticket in the requested band, return fewer tickets — or none — and explain why in dataNote. Padding the list with unsupported legs is a failure.
- Never state or imply a guaranteed outcome, and never recommend a stake size.
- Sanity-check yourself before returning: a bookmaker charges margin, so a fairly-read market yields
  mostly slightly negative EV. If nearly every ticket you built comes out positive, your probability
  estimates are optimistic rather than the book being wrong many times over — lower them, and say in
  dataNote that the read skewed optimistic. Most real tickets should be negative or near zero.
- ALWAYS pair each main ticket with at least one alternative, flagged with isAlternative, placed
  immediately after it. Markets suspend and prices move between generation and the moment someone
  reads this, so a single suggestion with no second door is of little use. A good alternative
  reaches a similar thesis through a different market — a double chance instead of the win, a
  different total line, a different player — rather than restating the same bet at a worse price.
- The market list you are given is the whole pool of what is actually open. Prefer a leg that
  exists in it over a market you assume is offered; if a thesis needs a market that is not listed,
  say so instead of inventing the leg.
- In TENNIS, do not lean on head-to-head. Measured against the field, ranking beats the head-to-head
  record when the two disagree; only a lopsided undefeated series on the same surface within about
  two years carries information. Prefer surface-specific recent form.

For each ticket write:
- background: the situation. What is going on in this game that makes this angle exist.
- explanation per leg: why that specific selection.
- evidence per leg: the measured fact, with its sample size when it has one.`;

const SYSTEM_PT = `${SYSTEM_EN}

Write every user-facing string (title, background, explanation, evidence, riskNote, dataNote) in Brazilian Portuguese. Keep player names, team names, market names and numbers exactly as supplied.`;

function describeProps(props: PropRow[]): string {
  if (!props.length) return "- none gathered";
  return props
    .map((p) => {
      const measured = p.measured;
      const measuredText = measured
        ? ` | MEASURED ${measured.side} ${measured.line} ${measured.stat}: L5 ${measured.last5.hits}/${measured.last5.of}, L10 ${measured.last10.hits}/${measured.last10.of}, season ${measured.season.hits}/${measured.season.of} (${(measured.impliedFair * 100).toFixed(0)}%), avg ${measured.average}, median ${measured.median} [${measured.sampleNote}]`
        : " | MEASURED: none — no game log matched this player/market";
      return `- ${p.player} ${p.market} ${p.side ?? ""} ${p.line ?? "?"} @ ${p.odds ?? "no price"} (${p.book ?? "?"})${p.projection !== undefined ? ` toolProj ${p.projection}` : ""}${p.edgePct !== undefined ? ` toolEdge ${p.edgePct}%` : ""}${measuredText}`;
    })
    .join("\n");
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

function priceSuggestion(
  raw: z.infer<typeof SuggestionSchema>,
  bandKey: string,
  index: number,
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
  // A ticket with no usable price cannot be evaluated, so it is dropped rather than shown blank.
  if (!priced.length) return null;

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
    alternativeFor: raw.isAlternative ? `${bandKey}-${Math.max(0, index - 1)}` : undefined,
    id: `${bandKey}-${index}`,
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

export async function buildBets(args: BuildArgs): Promise<BetSlate> {
  const { game, detail, props, picks, dimers, x, bands, lang, duels = [], referee = null, dvp, consensus = [], roles = [], maxPerBand = 2 } = args;
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
  ]
    .filter(Boolean)
    .join("\n");

  const result = await generateStructured({
    schema: SlateSchema,
    system: lang === "pt" ? SYSTEM_PT : SYSTEM_EN,
    prompt,
    maxTokens: 16000,
  });

  const suggestions = result.suggestions
    .map((s, i) => {
      const decimalGuess = parlayDecimal(
        s.legs.map((l) => parseOdds(l.odds)).filter((d) => Number.isFinite(d) && d > 1),
      );
      // Classify by the price actually computed, not by whatever band the model thought it hit.
      const band = ODDS_BANDS.find((b) => decimalGuess >= b.min && decimalGuess < b.max);
      return priceSuggestion(s, band?.key ?? "unbanded", i);
    })
    .filter((s): s is BetSuggestion => s !== null)
    .sort((a, b) => a.combinedDecimal - b.combinedDecimal);

  // Log every ticket at generation time so it can be graded once the game finishes.
  recordPredictions(game, suggestions);
  return { suggestions, dataNote: result.dataNote };
}

const SYSTEM_SLATE_EN = `${SYSTEM_EN}

You are building ACROSS SEVERAL GAMES. Extra rules:
- Mix leg types. A ticket made only of moneylines is lazy; player props, totals and spreads all
  belong, and props with a measured hit rate are the best-evidenced legs available.
- Build around a THESIS, not a pile of favourites. State it in the background. Good theses look like:
  a blowout script (big favourite + starters' unders on minutes-driven stats + the game under),
  a pace-up script (game over + both teams' scorers over), a short-handed script (a key absence,
  so the remaining creator's assists and the backup's minutes go over), or a role-shift script.
- Correlation is the point of a parlay. Legs that rise and fall together turn a longer price into a
  single bet on one story. Say explicitly which legs are correlated and why.
- Anti-correlation is a mistake to avoid: do not pair a big favourite's spread cover with that same
  star's heavy counting-stat over, because blowouts remove his fourth quarter.
- Weight the signals by how well evidenced they are, not by how interesting they sound:
  - THE BEST AVAILABLE PRICE is the one edge that is free and certain. When several sources posted
    the same bet, always quote the best of them and name where it is. Taking a worse number for an
    identical bet is a guaranteed loss with no upside.
  - MINUTES AND ROLE gate everything else. A soft matchup is worth nothing to a player who will not
    be on the field long enough to reach the line — check the role before any other signal.
  - The REFEREE is the primary driver of a card or foul environment. Card markets attract little
    sharp money, so the appointment is often the least-priced public fact in the match. A strict
    referee is a reason on its own; a lenient one argues against card legs entirely.
  - DEFENCE VS POSITION is the defensible form of "player versus team": it aggregates a whole
    defence rather than the handful of times one player faced it. Use it, but only after the
    player's minutes and role make the volume plausible.
  - A POSITIONAL DUEL is a modifier, not a primary signal — it sharpens a card or foul lean the
    referee already supports. There is no published study quantifying it, so never build a ticket
    on a duel alone, and ignore any duel whose flank confidence is low.
- Never lean on a player's personal record against one opponent. Two to four meetings is noise, and
  regression to the mean makes it actively misleading.
- A prop candidate marked "no market price" cannot be priced. You may include at most one such leg
  per ticket, must say the price is unverified, and must not invent a number for it.
- Every leg must name the game it belongs to via gameId, taken from the supplied list.
- Legs from different games are independent, so their probabilities multiply cleanly — this is how a
  ticket reaches long odds. Say plainly in the background that length comes from stacking
  independent games, not from any single strong read.
- Never put two legs from the same game in a cross-game ticket unless they are genuinely correlated,
  and say why when you do.
- The longer the ticket, the more the book's margin compounds. Reflect that in the risk note.`;

const SYSTEM_SLATE_PT = `${SYSTEM_SLATE_EN}

Write every user-facing string in Brazilian Portuguese. Keep names, markets and numbers as supplied.`;

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
  ].join("\n");

  const result = await generateStructured({
    schema: SlateSchema,
    system: lang === "pt" ? SYSTEM_SLATE_PT : SYSTEM_SLATE_EN,
    prompt,
    maxTokens: 16000,
  });

  const suggestions = result.suggestions
    .map((s, i) => {
      const decimalGuess = parlayDecimal(
        s.legs.map((l) => parseOdds(l.odds)).filter((d) => Number.isFinite(d) && d > 1),
      );
      const band = ODDS_BANDS.find((bd) => decimalGuess >= bd.min && decimalGuess < bd.max);
      return priceSuggestion(s, band?.key ?? "unbanded", i);
    })
    .filter((s): s is BetSuggestion => s !== null)
    .sort((a, b) => a.combinedDecimal - b.combinedDecimal);

  // Cross-game tickets are logged against a synthetic game id so they can still be settled per leg.
  if (games.length) {
    // Label it as what it is; using the first game's matchup made a slate ticket look single-game.
    const label = `${games.length} ${games[0].game.sportKey} games`;
    recordPredictions(
      {
        ...games[0].game,
        id: `slate:${games.map((g) => g.game.id).join("+")}`.slice(0, 120),
        home: { ...games[0].game.home, displayName: label, name: label },
        away: { ...games[0].game.away, displayName: "cross-game", name: "cross-game" },
      },
      suggestions,
    );
  }

  return { suggestions, dataNote: result.dataNote };
}
