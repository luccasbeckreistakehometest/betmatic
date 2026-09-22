import { getGameDetail, getPlayerHistory } from "@/lib/sources/espn";
import { matchAthlete, resolveStatLabels, statTotal } from "@/lib/props/history";
import { pendingEntries, updateEntries } from "@/lib/ledger/store";
import { getSport } from "@/lib/sports";
import type { GameDetail, LedgerEntry, LegOutcome, SettledLeg } from "@/lib/types";

interface FinalGame {
  gameId: string;
  /** Kickoff, from ESPN — the clock the boxscore grace window runs on. */
  startsAt: string;
  homeAbbr: string;
  awayAbbr: string;
  homeNames: string[];
  awayNames: string[];
  homeScore: number;
  awayScore: number;
  athletes: { name: string; id: string }[];
  sportKey: string;
}

/**
 * How long after kickoff a player leg may stay unsettled while ESPN publishes the game into the
 * athletes' gamelogs. Settling runs minutes after the final whistle and the gamelog lags it: on
 * 21/09/2026 nine tickets on Dallas @ Phoenix were written off as void within that lag, when the
 * real record was 4 won / 5 lost. Past this window a leg the gamelog still cannot answer is written
 * off for good, so no ticket can hang forever.
 */
export const BOXSCORE_GRACE_MS = 6 * 60 * 60 * 1000;

/**
 * Whether the gamelog has had its chance. A game with no usable kickoff counts as past the window:
 * a ticket that can never settle is worse than one voided early.
 */
export function boxscoreGraceOver(startsAt: string | undefined, now: number = Date.now()): boolean {
  const kickoff = startsAt ? Date.parse(startsAt) : Number.NaN;
  return !Number.isFinite(kickoff) || now - kickoff >= BOXSCORE_GRACE_MS;
}

/** Waiting on data, not a verdict: held while the window is open, written off once it closes. */
function unmeasured(leg: SettledLeg, final: FinalGame): SettledLeg {
  return boxscoreGraceOver(final.startsAt)
    ? { ...leg, outcome: "void", actual: "não é possível medir" }
    : { ...leg, outcome: "pending", actual: "aguardando boxscore" };
}

function gradeMargin(value: number, line: number, side: "over" | "under"): LegOutcome {
  if (value === line) return "push";
  const won = side === "over" ? value > line : value < line;
  return won ? "won" : "lost";
}

async function gradeLeg(leg: SettledLeg, final: FinalGame, parsed: ParsedSelection): Promise<SettledLeg> {
  const { homeScore, awayScore, homeAbbr, awayAbbr } = final;

  if (parsed.type === "moneyline" && parsed.team) {
    const isHome = parsed.team === homeAbbr;
    const own = isHome ? homeScore : awayScore;
    const other = isHome ? awayScore : homeScore;
    // A football match has three outcomes: a draw loses a win bet (it is not a push, as in basketball OT-less lines).
    const drawLoses = getSport(final.sportKey).group === "soccer";
    return {
      ...leg,
      outcome: own === other ? (drawLoses ? "lost" : "push") : own > other ? "won" : "lost",
      actual: `${awayAbbr} ${awayScore} - ${homeScore} ${homeAbbr}`,
    };
  }

  if (parsed.type === "spread" && parsed.team && parsed.line !== undefined) {
    const isHome = parsed.team === homeAbbr;
    const margin = (isHome ? homeScore - awayScore : awayScore - homeScore) + parsed.line;
    return {
      ...leg,
      outcome: margin === 0 ? "push" : margin > 0 ? "won" : "lost",
      actual: `margin ${isHome ? homeScore - awayScore : awayScore - homeScore} vs line ${parsed.line}`,
    };
  }

  if (parsed.type === "total" && parsed.line !== undefined && parsed.side) {
    const total = homeScore + awayScore;
    return {
      ...leg,
      outcome: gradeMargin(total, parsed.line, parsed.side === "under" ? "under" : "over"),
      actual: `total ${total} vs line ${parsed.line}`,
    };
  }

  if (parsed.type === "player_prop" && parsed.player && parsed.line !== undefined) {
    // A market the vocabulary cannot name is a modelling failure, not a publishing delay: no amount
    // of waiting turns it into something gradable, so it is written off at once.
    const labels = resolveStatLabels(parsed.stat ?? "", final.sportKey);
    if (!labels) return { ...leg, outcome: "void", actual: "não é possível medir" };

    const match = matchAthlete(parsed.player, final.athletes);
    // No roster at all is a half-published payload; a roster without this player is a wrong pick.
    if (!match) return final.athletes.length
      ? { ...leg, outcome: "void", actual: "player not on either roster" }
      : unmeasured(leg, final);

    const history = await getPlayerHistory(final.sportKey, match.id).catch(() => null);
    // The game is found by its event id, never taken as "the newest logged one": until ESPN
    // publishes this game, the newest entry is the player's PREVIOUS game and grading it is wrong.
    const played = history?.games.find((g) => g.eventId === final.gameId);
    const value = played ? statTotal(played, labels) : Number.NaN;
    if (!Number.isFinite(value)) return unmeasured(leg, final);

    return {
      ...leg,
      outcome: gradeMargin(value, parsed.line, parsed.side === "under" ? "under" : "over"),
      actual: `${labels.join("+")} ${value} vs ${parsed.line}`,
    };
  }

  return { ...leg, outcome: "void", actual: "not automatically gradable" };
}

interface ParsedSelection {
  type: "moneyline" | "spread" | "total" | "player_prop" | "other";
  team?: string;
  player?: string;
  stat?: string;
  line?: number;
  side?: string;
}

/** Prefers the stored descriptor; the prose parse is the fallback for rows written without one. */
function parseSelection(leg: SettledLeg, final: FinalGame): ParsedSelection {
  if (leg.settlement && leg.settlement.type !== "other") {
    return {
      type: leg.settlement.type,
      team: leg.settlement.teamAbbreviation,
      player: leg.settlement.player,
      stat: leg.settlement.stat,
      line: leg.settlement.line,
      side: leg.settlement.side,
    };
  }

  const text = leg.selection.toLowerCase();
  const num = text.match(/([+-]?\d+(?:\.\d+)?)/);
  const line = num ? Number(num[1]) : undefined;
  const side = /under/.test(text) ? "under" : /over/.test(text) ? "over" : undefined;

  // Match the selection text against this game's actual teams to recover the side.
  const team = [
    { abbr: final.homeAbbr, names: final.homeNames },
    { abbr: final.awayAbbr, names: final.awayNames },
  ].find((c) => c.names.some((n) => n && text.includes(n.toLowerCase())))?.abbr;

  if (leg.market === "moneyline" || /moneyline|\bml\b/.test(text)) return { type: "moneyline", team };
  if (leg.market === "spread" || /spread|handicap/.test(text)) return { type: "spread", team, line };
  if (leg.market === "total" || /total|over|under/.test(text)) return { type: "total", line, side };
  if (leg.market === "player_prop") return { type: "player_prop", line, side };
  return { type: "other" };
}

function finalOf(detail: GameDetail, sportKey: string): FinalGame {
  return {
    gameId: detail.game.id,
    startsAt: detail.game.startsAt,
    homeAbbr: detail.game.home.abbreviation,
    awayAbbr: detail.game.away.abbreviation,
    homeNames: [detail.game.home.displayName, detail.game.home.name, detail.game.home.abbreviation].filter(Boolean),
    awayNames: [detail.game.away.displayName, detail.game.away.name, detail.game.away.abbreviation].filter(Boolean),
    homeScore: detail.game.home.score ?? 0,
    awayScore: detail.game.away.score ?? 0,
    athletes: detail.rosters.flatMap((r) => r.athletes ?? []),
    sportKey,
  };
}

/** Grades one leg against a finished game (bankroll legs, scanned slips, tipster picks). */
export async function gradeLegAgainst(leg: SettledLeg, detail: GameDetail, sportKey: string): Promise<SettledLeg> {
  if (detail.game.status !== "final") return { ...leg, outcome: "pending" };
  const final = finalOf(detail, sportKey);
  return gradeLeg(leg, final, parseSelection(leg, final));
}

/** A ticket's outcome from its graded legs: any loss loses; an ungradable leg voids; all wins win. */
export function ticketOutcome(legs: Pick<SettledLeg, "outcome">[]): LegOutcome {
  const decided = legs.filter((l) => l.outcome === "won" || l.outcome === "lost");
  if (decided.some((l) => l.outcome === "lost")) return "lost";
  if (legs.some((l) => l.outcome === "pending")) return "pending";
  if (legs.some((l) => l.outcome === "void")) return "void";
  if (!decided.length) return "push";
  return decided.every((l) => l.outcome === "won") ? "won" : "push";
}

/**
 * Grades every pending ticket whose game has finished. Runs on demand — there is no scheduler here,
 * and a leg that cannot be graded deterministically is marked void rather than guessed at.
 *
 * A ticket is only written once every leg has an answer. One still waiting on the gamelog is left
 * exactly as it was — no outcome, no `settledAt` — so the next pass picks it up again and grades it
 * for real; `awaitingBoxscore` counts those, and they are part of `stillPending`.
 */
export async function settlePending(limit = 50): Promise<{ settled: number; stillPending: number; awaitingBoxscore: number }> {
  const pending = pendingEntries().slice(0, limit);
  if (!pending.length) return { settled: 0, stillPending: 0, awaitingBoxscore: 0 };

  const updated: LedgerEntry[] = [];
  let stillPending = 0;
  let awaitingBoxscore = 0;

  for (const entry of pending) {
    const detail = await getGameDetail(entry.gameId, false, entry.sportKey).catch(() => null);
    if (!detail || detail.game.status !== "final") {
      stillPending += 1;
      continue;
    }

    const final = finalOf(detail, entry.sportKey);
    const legs: SettledLeg[] = [];
    for (const leg of entry.legs) {
      legs.push(await gradeLeg(leg, final, parseSelection(leg, final)));
    }

    // A parlay needs every leg; pushes are ignored rather than counted as losses. A lost leg settles
    // the ticket regardless — a dead parlay does not get any better once the rest lands.
    const outcome = ticketOutcome(legs);
    if (outcome === "pending") {
      stillPending += 1;
      awaitingBoxscore += 1;
      continue;
    }

    updated.push({ ...entry, legs, outcome, settledAt: new Date().toISOString() });
  }

  updateEntries(updated);
  return { settled: updated.length, stillPending, awaitingBoxscore };
}
