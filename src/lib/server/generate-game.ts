import { savePrediction } from "@/lib/server/predictions";
import { buildBets } from "@/lib/bets/builder";
import { localiseSlate } from "@/lib/bets/localise";
import { getGameDetail } from "@/lib/sources/espn";
import { buildPropCandidates } from "@/lib/props/candidates";
import { consensusWithBooks } from "@/lib/props/consensus";
import { pricesForGame } from "@/lib/server/book-prices";
import { getGameLines } from "@/lib/sources/espn-props";
import { refereeForMatch } from "@/lib/signals/referee";
import { computeDvp } from "@/lib/signals/dvp";
import { getSport } from "@/lib/sports";
import { lastUsage } from "@/lib/ai/extract";
import { announceTickets } from "@/lib/server/webhook";
import { notifyFollowers } from "@/lib/server/telegram";
import type { BetSlate } from "@/lib/types";
import type { Lang } from "@/lib/i18n";
import { baseUrlOrEmpty } from "@/lib/base-url";

export const BANDS = ["safe", "value", "mid", "long", "moonshot"];
export type Detail = NonNullable<Awaited<ReturnType<typeof getGameDetail>>>;

/**
 * Everything it takes to turn one game into saved tickets: signals, the primary-language build by
 * the judgement model, and the derived languages by the cheaper one. Shared by the background job
 * and by on-demand generation so both spend tokens the same way.
 */
export async function generateGame(args: { sportKey: string; dateKey: string; detail: Detail; langs: Lang[] }): Promise<{ primary: BetSlate; costUsd: number; notes: string[]; info: string[] }> {
  const { sportKey, dateKey, detail } = args;
  const [primary, ...derived] = args.langs;
  const notes: string[] = [];
  const info: string[] = [];
  let cost = 0;
  const spend = () => { const c = lastUsage?.costUsd ?? 0; cost += c; return c; };

  // Priced player legs, gated by minutes/role before the prompt; a failing feed falls back to
  // unpriced candidates (which the builder never lets into a ticket).
  const sportDefinition = getSport(sportKey);
  const candidates = await buildPropCandidates(detail).catch(() => null);
  const props = candidates?.props ?? [];
  const lines = await getGameLines(sportKey, detail.game.id).catch(() => []);
  if (candidates?.dropped.length) info.push(`role gate dropped: ${candidates.dropped.join(", ")}`);
  // The guard only ever fires on a game already under way; saying so in the run note makes a stale
  // feed visible in the ops log instead of silently thinning the candidates.
  if (candidates?.staleDropped.length) info.push(`stale line guard dropped: ${candidates.staleDropped.join(" | ")}`);
  // The Brazilian books' current prices on this game (stored by the books job), so the model can
  // shop the line and name the book that pays most; an empty store changes nothing.
  const bookPrices = (() => { try { return pricesForGame(detail.game.id); } catch { return []; } })();
  const consensus = consensusWithBooks(props, sportDefinition.group === "soccer" ? lines : [], { home: detail.game.home.displayName, away: detail.game.away.displayName }, bookPrices, sportKey);
  if (bookPrices.length) info.push(`book prices: ${bookPrices.length} rows from ${new Set(bookPrices.map((p) => p.book)).size} books`);
  const referee = sportDefinition.group === "soccer"
    ? await refereeForMatch(detail.game.home.displayName, detail.game.away.displayName, dateKey).catch(() => null)
    : null;
  const dvp = sportDefinition.group === "basketball"
    ? { home: await computeDvp(sportKey, detail.game.home.id, detail.game.home.abbreviation).catch(() => null),
        away: await computeDvp(sportKey, detail.game.away.id, detail.game.away.abbreviation).catch(() => null) }
    : undefined;

  const matchup = `${detail.game.away.displayName} @ ${detail.game.home.displayName}`;
  const base = baseUrlOrEmpty();
  const save = (lang: Lang, slate: BetSlate, costUsd: number) =>
    savePrediction({ scope: "game", sportKey, gameId: detail.game.id, dateKey, lang, matchup, startsAt: detail.game.startsAt, slate, costUsd });

  const primarySlate = await buildBets({ game: detail.game, detail, props, picks: [], dimers: [], x: null, bands: BANDS, lang: primary, referee, dvp, roles: candidates?.roles ?? [], consensus, lines });
  save(primary, primarySlate, spend());
  void announceTickets({ gameId: detail.game.id, matchup, sportKey, lang: primary, suggestions: primarySlate.suggestions, base });
  const slates: Partial<Record<Lang, BetSlate>> = { [primary]: primarySlate };
  for (const lang of derived) {
    try { const localised = await localiseSlate(primarySlate, primary, lang); save(lang, localised, spend()); slates[lang] = localised; }
    catch (error) { notes.push(`${lang}: ${error instanceof Error ? error.message : "?"}`); }
  }
  // Followers hear after every language is saved, so each gets the ticket in their own words.
  void notifyFollowers({ gameId: detail.game.id, sportKey, matchup, teamIds: [detail.game.home.id, detail.game.away.id], dateKey, primary, slates, base })
    .catch((error) => console.warn("[telegram] notify failed:", error instanceof Error ? error.message : error));
  return { primary: primarySlate, costUsd: cost, notes, info };
}
