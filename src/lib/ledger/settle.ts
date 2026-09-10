import { getGameDetail, getPlayerHistory } from "@/lib/sources/espn";
import { measureProp, matchAthlete, resolveStatLabels } from "@/lib/props/history";
import { pendingEntries, updateEntries } from "@/lib/ledger/store";
import type { LedgerEntry, LegOutcome, SettledLeg } from "@/lib/types";

interface FinalGame {
  homeAbbr: string;
  awayAbbr: string;
  homeNames: string[];
  awayNames: string[];
  homeScore: number;
  awayScore: number;
  athletes: { name: string; id: string }[];
  sportKey: string;
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
    return {
      ...leg,
      outcome: own === other ? "push" : own > other ? "won" : "lost",
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
    const match = matchAthlete(parsed.player, final.athletes);
    if (!match) return { ...leg, outcome: "void", actual: "player not on either roster" };
    const history = await getPlayerHistory(final.sportKey, match.id).catch(() => null);
    if (!history?.games.length) return { ...leg, outcome: "void", actual: "no game log" };

    // The most recent logged game is the one that just finished.
    const labels = resolveStatLabels(parsed.stat ?? "", final.sportKey);
    if (!labels) return { ...leg, outcome: "void", actual: "unmapped stat" };
    const single = measureProp({ ...history, games: history.games.slice(0, 1) }, parsed.stat ?? "", parsed.line, parsed.side === "under" ? "under" : "over", final.sportKey);
    if (!single) return { ...leg, outcome: "void", actual: "could not measure" };
    const hit = single.season.hits === 1;
    const pushed = single.season.of === 0;
    return {
      ...leg,
      outcome: pushed ? "push" : hit ? "won" : "lost",
      actual: `${labels.join("+")} vs ${parsed.line}`,
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

/**
 * Grades every pending ticket whose game has finished. Runs on demand — there is no scheduler here,
 * and a leg that cannot be graded deterministically is marked void rather than guessed at.
 */
export async function settlePending(limit = 50): Promise<{ settled: number; stillPending: number }> {
  const pending = pendingEntries().slice(0, limit);
  if (!pending.length) return { settled: 0, stillPending: 0 };

  const updated: LedgerEntry[] = [];
  let stillPending = 0;

  for (const entry of pending) {
    const detail = await getGameDetail(entry.gameId, false, entry.sportKey).catch(() => null);
    if (!detail || detail.game.status !== "final") {
      stillPending += 1;
      continue;
    }

    const final: FinalGame = {
      homeAbbr: detail.game.home.abbreviation,
      awayAbbr: detail.game.away.abbreviation,
      homeNames: [detail.game.home.displayName, detail.game.home.name, detail.game.home.abbreviation].filter(Boolean),
      awayNames: [detail.game.away.displayName, detail.game.away.name, detail.game.away.abbreviation].filter(Boolean),
      homeScore: detail.game.home.score ?? 0,
      awayScore: detail.game.away.score ?? 0,
      athletes: detail.rosters.flatMap((r) => r.athletes ?? []),
      sportKey: entry.sportKey,
    };

    const legs: SettledLeg[] = [];
    for (const leg of entry.legs) {
      legs.push(await gradeLeg(leg, final, parseSelection(leg, final)));
    }

    // A parlay needs every leg; pushes are ignored rather than counted as losses.
    const decided = legs.filter((l) => l.outcome === "won" || l.outcome === "lost");
    const anyVoid = legs.some((l) => l.outcome === "void");
    // A lost leg settles the ticket regardless; anything else with an ungradable leg stays void,
    // because calling it a win on partial information would poison the calibration data.
    const outcome: LegOutcome = decided.some((l) => l.outcome === "lost")
      ? "lost"
      : anyVoid
        ? "void"
        : !decided.length
          ? "push"
          : decided.every((l) => l.outcome === "won")
            ? "won"
            : "push";

    updated.push({ ...entry, legs, outcome, settledAt: new Date().toISOString() });
  }

  updateEntries(updated);
  return { settled: updated.length, stillPending };
}
