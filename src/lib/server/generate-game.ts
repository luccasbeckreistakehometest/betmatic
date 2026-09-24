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
import { splitsForGame } from "@/lib/signals/splits";
import { teamSeasonForGame } from "@/lib/signals/team-season";
import { getSport } from "@/lib/sports";
import { lastUsage } from "@/lib/ai/extract";
import { announceTickets } from "@/lib/server/webhook";
import { notifyFollowers } from "@/lib/server/telegram";
import { sendTicketMail } from "@/lib/server/ticket-mail";
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
  // The Brazilian books' current prices on this game (stored by the books job), read BEFORE the
  // candidates so the players they priced can be measured too. Until 24/09/2026 this was read after,
  // and the consequence was the product's main complaint: the books published lines on players whose
  // game logs were never fetched, so a priced line had no measured history to stand on and could not
  // carry a leg. `pricesForGame` on an empty store returns nothing and the behaviour is unchanged.
  const bookPrices = (() => { try { return pricesForGame(detail.game.id); } catch { return []; } })();
  const bookPlayers = [...new Set(bookPrices.map((p) => (p.player ?? "").trim()).filter(Boolean))];
  const candidates = await buildPropCandidates(detail, { alsoMeasure: bookPlayers }).catch(() => null);
  const props = candidates?.props ?? [];
  const lines = await getGameLines(sportKey, detail.game.id).catch(() => []);
  if (candidates?.dropped.length) info.push(`role gate dropped: ${candidates.dropped.join(", ")}`);
  // The guard only ever fires on a game already under way; saying so in the run note makes a stale
  // feed visible in the ops log instead of silently thinning the candidates.
  if (candidates?.staleDropped.length) info.push(`stale line guard dropped: ${candidates.staleDropped.join(" | ")}`);
  const consensus = consensusWithBooks(props, sportDefinition.group === "soccer" ? lines : [], { home: detail.game.home.displayName, away: detail.game.away.displayName }, bookPrices, sportKey);
  if (bookPrices.length) info.push(`book prices: ${bookPrices.length} rows from ${new Set(bookPrices.map((p) => p.book)).size} books`);
  // Said out loud in the run note, because "how many of the books' players did we manage to measure"
  // is the number that decides how much material a night has.
  if (bookPlayers.length) info.push(`book players offered for measurement: ${bookPlayers.length}`);
  const referee = sportDefinition.group === "soccer"
    ? await refereeForMatch(detail.game.home.displayName, detail.game.away.displayName, dateKey).catch(() => null)
    : null;
  const dvp = sportDefinition.group === "basketball"
    ? { home: await computeDvp(sportKey, detail.game.home.id, detail.game.home.abbreviation).catch(() => null),
        away: await computeDvp(sportKey, detail.game.away.id, detail.game.away.abbreviation).catch(() => null) }
    : undefined;

  // Two more cached ESPN reads per team and one per player, all pre-game. Both blocks are season
  // context and are deliberately NOT handed to the live read, which already has the night's real
  // production in front of it; adding a season average there would only dilute a longer prompt.
  const teamSeason = sportDefinition.group === "basketball"
    ? await teamSeasonForGame({ sportKey, home: detail.game.home, away: detail.game.away, startsAt: detail.game.startsAt }).catch(() => null)
    : null;
  // Only the players who survived the role gate, so the requests follow the candidates rather than
  // the whole roster. Deduped and capped inside splitsForGame.
  const withProps = new Set(props.map((p) => p.player));
  const splits = sportDefinition.group === "basketball"
    ? await splitsForGame({
        sportKey,
        homeAbbreviation: detail.game.home.abbreviation,
        awayAbbreviation: detail.game.away.abbreviation,
        startsAt: detail.game.startsAt,
        targets: (candidates?.players ?? []).filter((p) => withProps.has(p.name)).map((p) => ({ athleteId: p.athleteId, player: p.name, team: p.team })),
      }).catch(() => [])
    : [];
  if (splits.length) info.push(`splits: ${splits.length} players, ${splits.filter((s) => s.venueLine && s.otherVenueLine).length} with a usable venue cut`);

  const matchup = `${detail.game.away.displayName} @ ${detail.game.home.displayName}`;
  const base = baseUrlOrEmpty();
  const save = (lang: Lang, slate: BetSlate, costUsd: number) =>
    savePrediction({ scope: "game", sportKey, gameId: detail.game.id, dateKey, lang, matchup, startsAt: detail.game.startsAt, slate, costUsd });

  // One main ticket per band, each with its two alternatives: fifteen tickets is the slate the
  // prompt composes, and twice that was the output no thinking budget could finish (22/09/2026).
  const primarySlate = await buildBets({ game: detail.game, detail, props, picks: [], dimers: [], x: null, bands: BANDS, maxPerBand: 1, lang: primary, referee, dvp, splits, teamSeason, roles: candidates?.roles ?? [], minutes: candidates?.minutes ?? [], consensus, lines });
  save(primary, primarySlate, spend());
  // The operators' running picture of the game, by mail: every pre-game ticket, then every live read.
  void sendTicketMail({ gameId: detail.game.id, sportKey, dateKey, matchup, lang: primary, fresh: { kind: "pre" } });
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
