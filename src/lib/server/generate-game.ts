import { savePrediction } from "@/lib/server/predictions";
import { buildBets } from "@/lib/bets/builder";
import { localiseSlate } from "@/lib/bets/localise";
import { getGameDetail } from "@/lib/sources/espn";
import { buildPropCandidates } from "@/lib/props/candidates";
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
export async function generateGame(args: { sportKey: string; dateKey: string; detail: Detail; langs: Lang[] }): Promise<{ primary: BetSlate; costUsd: number; notes: string[] }> {
  const { sportKey, dateKey, detail } = args;
  const [primary, ...derived] = args.langs;
  const notes: string[] = [];
  let cost = 0;
  const spend = () => { const c = lastUsage?.costUsd ?? 0; cost += c; return c; };

  const props = await buildPropCandidates(detail).catch(() => []);
  const sportDef = getSport(sportKey);
  const referee = sportDef.group === "soccer"
    ? await refereeForMatch(detail.game.home.displayName, detail.game.away.displayName, dateKey).catch(() => null)
    : null;
  const dvp = sportDef.group === "basketball"
    ? { home: await computeDvp(sportKey, detail.game.home.id, detail.game.home.abbreviation).catch(() => null),
        away: await computeDvp(sportKey, detail.game.away.id, detail.game.away.abbreviation).catch(() => null) }
    : undefined;

  const matchup = `${detail.game.away.displayName} @ ${detail.game.home.displayName}`;
  const base = baseUrlOrEmpty();
  const save = (lang: Lang, slate: BetSlate, costUsd: number) =>
    savePrediction({ scope: "game", sportKey, gameId: detail.game.id, dateKey, lang, matchup, startsAt: detail.game.startsAt, slate, costUsd });

  const primarySlate = await buildBets({ game: detail.game, detail, props, picks: [], dimers: [], x: null, bands: BANDS, lang: primary, referee, dvp });
  save(primary, primarySlate, spend());
  void announceTickets({ gameId: detail.game.id, matchup, sportKey, lang: primary, suggestions: primarySlate.suggestions, base });
  const slates: Partial<Record<Lang, BetSlate>> = { [primary]: primarySlate };
  for (const lang of derived) {
    try { const localised = await localiseSlate(primarySlate, primary, lang); save(lang, localised, spend()); slates[lang] = localised; }
    catch (error) { notes.push(`${lang}: ${error instanceof Error ? error.message : "?"}`); }
  }
  // Followers hear after every language is saved, so each gets the ticket in their own words.
  void notifyFollowers({ gameId: detail.game.id, sportKey, matchup, teamIds: [detail.game.home.id, detail.game.away.id], primary, slates, base })
    .catch((error) => console.warn("[telegram] notify failed:", error instanceof Error ? error.message : error));
  return { primary: primarySlate, costUsd: cost, notes };
}
