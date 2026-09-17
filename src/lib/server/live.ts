import { cached } from "@/lib/cache";
import { espnJson } from "@/lib/sources/espn-http";
import { getGameDetail } from "@/lib/sources/espn";
import { parseLiveSnapshot, type LiveSnapshot } from "@/lib/live/snapshot";
import { ticketChance, trackLeg, type LegTrack, type PreMatch } from "@/lib/live/tracker";
import { historyFor } from "@/lib/props/candidates";
import { measureProp, resolveStatLabels } from "@/lib/props/history";
import { servedGameFor } from "@/lib/server/entitlement";
import { getDb } from "@/lib/server/db";
import { readLedger } from "@/lib/ledger/store";
import { normaliseName } from "@/lib/resolve/names";
import { getSport } from "@/lib/sports";
import type { PublicUser } from "@/lib/server/users";
import type { Settlement } from "@/lib/types";
import type { Lang } from "@/lib/i18n";

/** ESPN's summary, re-read at most every 45 seconds per game whatever the number of viewers. */
export async function getLiveSnapshot(sportKey: string, gameId: string): Promise<LiveSnapshot | null> {
  const sport = getSport(sportKey);
  if (sport.group !== "basketball" && sport.group !== "soccer") return null;
  const group = sport.group;
  return cached(`live-${sport.key}-${gameId}`, 45_000, async () => {
    try {
      const summary = await espnJson(`https://site.api.espn.com/apis/site/v2/sports/${sport.espnSport}/${sport.espnLeague}/summary?event=${gameId}`, { timeoutMs: 6000 });
      return parseLiveSnapshot(summary, gameId, group, sport.key === "wnba" ? 10 : 12);
    } catch {
      return null;
    }
  });
}

export interface TrackedLeg { selection: string; state: LegTrack["state"]; probability: number | null; reason: string; flags: LegTrack["flags"] }
export interface TrackedTicket { id: string; title: string; source: "served" | "saved"; preChance: number | null; chanceNow: number | null; legs: TrackedLeg[] }

interface LegInput { selection: string; settlement?: Settlement; athleteId?: string; fairProbability?: number }

async function preFor(sportKey: string, leg: LegInput, snap: LiveSnapshot, game: { total: number | null; spread: number | null }): Promise<PreMatch> {
  const s = leg.settlement;
  if (s?.type !== "player_prop" || !s.stat || s.line === undefined) return game;
  const id = leg.athleteId ?? snap.players.find((p) => normaliseName(p.name) === normaliseName(s.player ?? ""))?.id;
  if (!id) return game;
  const history = await historyFor(sportKey, id).catch(() => null);
  if (!history) return game;
  const m = measureProp(history, s.stat, s.line, s.side === "under" ? "under" : "over", sportKey);
  const minutes = history.games.map((g) => Number(g.stats.MIN)).filter((x) => Number.isFinite(x) && x > 0);
  return { ...game, average: m?.average ?? null, minutes: minutes.length ? minutes.reduce((a, b) => a + b, 0) / minutes.length : null };
}

async function track(sportKey: string, legs: LegInput[], snap: LiveSnapshot, lang: Lang, game: { total: number | null; spread: number | null }): Promise<TrackedLeg[]> {
  const out: TrackedLeg[] = [];
  for (const leg of legs) {
    const labels = leg.settlement?.stat ? resolveStatLabels(leg.settlement.stat, sportKey) : null;
    const t = trackLeg(leg.settlement, labels, snap, await preFor(sportKey, leg, snap, game));
    out.push({ selection: leg.selection, state: t.state, probability: t.probability, reason: t.reason[lang], flags: t.flags });
  }
  return out;
}

const chance = (legs: TrackedLeg[]) => ticketChance(legs.map((l) => ({ state: l.state, probability: l.probability, current: null, reason: { pt: "", en: "" }, flags: [] })));

/**
 * The live panel's payload: the served tickets of this game the viewer can read, plus the viewer's own
 * saved tickets on it, each leg tracked against the snapshot.
 */
export async function liveTracker(user: PublicUser, sportKey: string, gameId: string, dateKey: string, lang: Lang): Promise<{ snapshot: LiveSnapshot | null; tickets: TrackedTicket[] }> {
  const snapshot = await getLiveSnapshot(sportKey, gameId);
  if (!snapshot) return { snapshot: null, tickets: [] };
  const detail = await getGameDetail(gameId, false, sportKey).catch(() => null);
  const game = { total: detail?.game.odds?.overUnder ?? null, spread: detail?.game.odds?.spread ?? null };
  const served = servedGameFor(user, { sportKey, gameId, dateKey, lang });
  const tickets: TrackedTicket[] = [];
  for (const s of (served?.slate.suggestions ?? []).filter((x) => !x.alternativeFor).slice(0, 8)) {
    const legs = await track(sportKey, s.legs, snapshot, lang, game);
    tickets.push({ id: s.id, title: s.title, source: "served", preChance: s.modelledProbability, chanceNow: chance(legs), legs });
  }
  const ledger = new Map(readLedger().filter((e) => e.gameId === gameId).map((e) => [e.id, e]));
  const saved = getDb().prepare("SELECT id, title, ledgerId FROM bankroll_entries WHERE userId=? AND outcome='pending' ORDER BY createdAt DESC LIMIT 50").all(user.id) as { id: string; title: string; ledgerId: string | null }[];
  for (const row of saved) {
    const entry = row.ledgerId ? ledger.get(row.ledgerId) : undefined;
    let legs: LegInput[] = entry ? entry.legs.map((l) => ({ selection: l.selection, settlement: l.settlement })) : [];
    if (!entry) {
      const own = getDb().prepare("SELECT selection, settlement FROM bankroll_legs WHERE entryId=? AND gameId=?").all(row.id, gameId) as { selection: string; settlement: string | null }[];
      legs = own.map((l) => ({ selection: l.selection, settlement: l.settlement ? (JSON.parse(l.settlement) as Settlement) : undefined }));
    }
    if (!legs.length) continue;
    const tracked = await track(sportKey, legs, snapshot, lang, game);
    tickets.push({ id: `saved:${row.id}`, title: row.title, source: "saved", preChance: entry?.modelledProbability ?? null, chanceNow: chance(tracked), legs: tracked });
  }
  return { snapshot, tickets };
}
