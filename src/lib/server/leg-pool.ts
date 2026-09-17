import { buildPropCandidates, marketFair } from "@/lib/props/candidates";
import { getGameDetail, getSlateOrNearest, todayKey } from "@/lib/sources/espn";
import { getGameLines } from "@/lib/sources/espn-props";
import { shrinkMeasured, shrinkToHalf, type PoolLeg } from "@/lib/bets/custom-parlay";
import { americanToDecimal, noVigPair } from "@/lib/odds";
import { findPrediction } from "@/lib/server/predictions";
import { getSport } from "@/lib/sports";
import type { BetSlate, GameDetail } from "@/lib/types";
import type { Lang } from "@/lib/i18n";

/**
 * Every priced leg available for a sport's next slate: game lines (moneyline, draw, total, spread)
 * from the book, posted player props measured at their line, and — for paid plans — the legs of the
 * day's generated tickets. The custom parlay solver only ever picks from this pool.
 */
export interface PoolGame { id: string; matchup: string; startsAt: string }

function gameLineLegs(detail: GameDetail, lines: Awaited<ReturnType<typeof getGameLines>>, lang: Lang): PoolLeg[] {
  const g = detail.game;
  const matchup = `${g.away.displayName} @ ${g.home.displayName}`;
  const dk = lines.find((l) => /draftkings/i.test(l.provider))?.current;
  const book = detail.books[0];
  const homeMl = dk?.homeMl ?? (book?.homeMoneyline !== undefined ? americanToDecimal(book.homeMoneyline) : NaN);
  const awayMl = dk?.awayMl ?? (book?.awayMoneyline !== undefined ? americanToDecimal(book.awayMoneyline) : NaN);
  const draw = dk?.draw ?? NaN;
  const out: PoolLeg[] = [];
  const add = (key: string, selection: string, market: string, decimal: number, fair: number, settlement: PoolLeg["settlement"]) => {
    if (Number.isFinite(decimal) && decimal > 1 && Number.isFinite(fair)) {
      out.push({ key: `${g.id}:${key}`, gameId: g.id, matchup, selection, market, decimal, fairProbability: shrinkToHalf(fair), measured: false, measuredRate: null, evidence: lang === "pt" ? "preço da casa sem a margem" : "book price with the margin removed", settlement });
    }
  };
  const inv = [homeMl, awayMl, draw].map((d) => (Number.isFinite(d) && d > 1 ? 1 / d : 0));
  const sum = inv.reduce((a, b) => a + b, 0);
  if (sum > 0) {
    add("ml-home", lang === "pt" ? `${g.home.displayName} vence` : `${g.home.displayName} to win`, "moneyline", homeMl, inv[0] / sum, { type: "moneyline", teamAbbreviation: g.home.abbreviation, side: "home", sourceBasis: "book line" });
    add("ml-away", lang === "pt" ? `${g.away.displayName} vence` : `${g.away.displayName} to win`, "moneyline", awayMl, inv[1] / sum, { type: "moneyline", teamAbbreviation: g.away.abbreviation, side: "away", sourceBasis: "book line" });
  }
  const total = dk?.total ?? book?.overUnder;
  const over = dk?.over ?? (book?.overOdds !== undefined ? americanToDecimal(book.overOdds) : NaN);
  const under = dk?.under ?? (book?.underOdds !== undefined ? americanToDecimal(book.underOdds) : NaN);
  if (total !== undefined && total !== null && Number.isFinite(over) && Number.isFinite(under)) {
    const fair = noVigPair(over, under);
    const word = getSport(g.sportKey).group === "soccer" ? (lang === "pt" ? "gols" : "goals") : (lang === "pt" ? "pontos" : "points");
    add("over", lang === "pt" ? `Mais de ${total} ${word}` : `Over ${total} ${word}`, "total", over, fair.a, { type: "total", line: total, side: "over", sourceBasis: "book line" });
    add("under", lang === "pt" ? `Menos de ${total} ${word}` : `Under ${total} ${word}`, "total", under, fair.b, { type: "total", line: total, side: "under", sourceBasis: "book line" });
  }
  return out;
}

/**
 * `ticketBands`: legs of the stored tickets join the pool only from these bands (null = every band,
 * the admin view; empty = none). The caller passes what the viewer's plan shows for this sport.
 */
export async function buildLegPool(sportKey: string, opts: { lang: Lang; ticketBands: string[] | null; maxGames?: number }): Promise<{ pool: PoolLeg[]; games: PoolGame[]; dateKey: string }> {
  const slate = await getSlateOrNearest(todayKey(), false, sportKey);
  const upcoming = slate.games.filter((g) => g.status === "scheduled" && Date.parse(g.startsAt) > Date.now()).slice(0, opts.maxGames ?? 8);
  const pool: PoolLeg[] = [];
  const games: PoolGame[] = [];
  for (const g of upcoming) {
    const detail = await getGameDetail(g.id, false, sportKey).catch(() => null);
    if (!detail) continue;
    const matchup = `${detail.game.away.displayName} @ ${detail.game.home.displayName}`;
    games.push({ id: g.id, matchup, startsAt: detail.game.startsAt });
    pool.push(...gameLineLegs(detail, await getGameLines(sportKey, g.id).catch(() => []), opts.lang));
    const candidates = await buildPropCandidates(detail, { maxPlayers: 6, limit: 20 }).catch(() => null);
    for (const p of candidates?.props ?? []) {
      if (!p.priced || !p.decimal || !p.measured || p.line === undefined) continue;
      const side = p.side === "under" ? "under" : "over";
      const market = getSport(sportKey).markets.find((m) => m.key === p.marketKey);
      const label = market?.label[opts.lang] ?? p.market;
      pool.push({
        key: `${g.id}:${p.athleteId}:${p.marketKey}:${side}:${p.line}`, gameId: g.id, matchup,
        selection: `${p.player} ${opts.lang === "pt" ? (side === "over" ? "mais de" : "menos de") : side} ${p.line} ${label}`,
        market: p.marketKey ?? p.market, decimal: p.decimal,
        fairProbability: shrinkMeasured(p.measured.season.hits, p.measured.season.of, marketFair(p)),
        measured: true, measuredRate: p.measured.impliedFair,
        evidence: `L5 ${p.measured.last5.hits}/${p.measured.last5.of} · L10 ${p.measured.last10.hits}/${p.measured.last10.of} · ${opts.lang === "pt" ? "temp" : "season"} ${p.measured.season.hits}/${p.measured.season.of}`,
        settlement: { type: "player_prop", player: p.player, stat: p.marketKey, line: p.line, side, sourceBasis: "measured history" },
        athleteId: p.athleteId,
      });
    }
    if (opts.ticketBands === null || opts.ticketBands.length) {
      const stored = findPrediction({ scope: "game", sportKey, gameId: g.id, dateKey: slate.dateKey, lang: opts.lang });
      const slateJson = stored ? (JSON.parse(stored.payload) as BetSlate) : null;
      const bands = opts.ticketBands === null ? null : new Set(opts.ticketBands);
      for (const s of slateJson?.suggestions ?? []) {
        if (bands && !bands.has(s.bandKey)) continue;
        for (const leg of s.legs) {
          const key = `${g.id}:ticket:${leg.selection}`;
          if (!leg.settlement || !(leg.oddsDecimal > 1) || pool.some((x) => x.key === key || x.selection === leg.selection)) continue;
          pool.push({ key, gameId: g.id, matchup, selection: leg.selection, market: leg.settlement.stat ?? leg.settlement.type, decimal: leg.oddsDecimal, fairProbability: Math.min(0.97, Math.max(0.03, leg.fairProbability)), measured: !!leg.measured, measuredRate: leg.measured?.rate ?? null, evidence: leg.evidence, settlement: leg.settlement, athleteId: leg.athleteId });
        }
      }
    }
  }
  return { pool, games, dateKey: slate.dateKey };
}
