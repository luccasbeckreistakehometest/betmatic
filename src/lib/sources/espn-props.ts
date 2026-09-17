import { readCache, writeCache } from "@/lib/cache";
import { espnJson, type Json } from "@/lib/sources/espn-http";
import { getSport, type SportDef } from "@/lib/sports";
import { noVigPair } from "@/lib/odds";

/**
 * Posted prices from ESPN's core odds API (provider 100 = DraftKings): player props with their open
 * and current price, and the game lines with open / current / close. Undocumented public JSON —
 * The Odds API (paid props tier) is the licensed fallback if ESPN changes it.
 */
const CORE = "https://sports.core.api.espn.com/v2/sports";
const TTL = { props: 10 * 60_000, lines: 5 * 60_000 };
export const PROP_BOOK = "DraftKings";

export interface PostedProp {
  athleteId: string;
  /** MarketDef.key within the sport. */
  marketKey: string;
  line: number;
  side: "over" | "under";
  decimal: number;
  /** Only when the book opened this same line; a moved line has no comparable open price. */
  openDecimal: number | null;
  openLine: number | null;
  /** The other side's price at this line when the book posts both (the no-vig input). */
  otherDecimal: number | null;
  /** Fair chance of this side with the margin removed; null for one-sided ladders. */
  noVigFair: number | null;
  kind: "total" | "milestone" | "yes";
  book: string;
  updatedAt: string | null;
}

type Kind = PostedProp["kind"];
const T = (marketKey: string, kind: Kind) => ({ marketKey, kind });

/** Verified against live payloads on 17/09/2026 (WNBA 401857190, Brasileirão 401841239). */
const TYPE_MAP: Record<"basketball" | "soccer", Record<string, { marketKey: string; kind: Kind }>> = {
  basketball: {
    "Total Points": T("points", "total"), "Points Milestones": T("points", "milestone"),
    "Total Rebounds": T("rebounds", "total"), "Rebounds Milestones": T("rebounds", "milestone"),
    "Total Assists": T("assists", "total"), "Assists Milestones": T("assists", "milestone"),
    "Total 3-Point Field Goals": T("threes", "total"), "3-Point Field Goals Milestones": T("threes", "milestone"),
    "Total Points and Rebounds": T("pr", "total"), "Points + Rebounds Milestones": T("pr", "milestone"),
    "Total Points and Assists": T("pa", "total"), "Points + Assists Milestones": T("pa", "milestone"),
    "Total Assists and Rebounds": T("ra", "total"), "Rebounds + Assists Milestones": T("ra", "milestone"),
    "Total Points, Rebounds, and Assists": T("pra", "total"), "Points + Assists + Rebounds Milestones": T("pra", "milestone"),
  },
  soccer: {
    "Shots Milestones": T("shots", "milestone"),
    "Shots on Target Milestones": T("shots_on_target", "milestone"),
    "Fouls Committed Milestones": T("fouls_committed", "milestone"),
    "Offsides Milestones": T("offsides", "milestone"),
    "Assists Milestones": T("assists", "milestone"),
    "Anytime Goalscorer": T("goals", "yes"),
    "To Receive a Card": T("cards", "yes"),
  },
};

const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

const athleteOf = (row: Json): string | null => String(row.athlete?.$ref ?? "").match(/\/athletes\/(\d+)/)?.[1] ?? null;
const priceOf = (row: Json): number | null => num(row.odds?.decimal?.value) ?? num(row.current?.over?.decimal) ?? num(row.current?.under?.decimal);
const openPriceOf = (row: Json): number | null => num(row.odds?.decimal?.open) ?? num(row.open?.over?.decimal) ?? num(row.open?.under?.decimal);
const targetOf = (block: Json | undefined, fallback: unknown): number | null => num(block?.target?.value) ?? num(String(fallback ?? "").replace("+", ""));

/**
 * Maps a propBets payload onto posted prices. "Total X" rows come in pairs per player and line, over
 * first (checked against the milestone ladder: 44 of 46 pairs agree, the other two are priced
 * 1.85/1.86 and cannot disagree meaningfully); a group that is not exactly a sane pair is skipped.
 * Milestone "N+" is an over at N − 0.5; "yes" markets are an over at 0.5.
 */
export function parsePropBets(payload: Json, sportKey: string, book = PROP_BOOK): PostedProp[] {
  const sport = getSport(sportKey);
  const map = sport.group === "tennis" ? {} : TYPE_MAP[sport.group];
  const out: PostedProp[] = [];
  const pairs = new Map<string, Json[]>();

  for (const row of (payload.items ?? []) as Json[]) {
    const type = map[String(row.type?.name ?? "")];
    const athleteId = athleteOf(row);
    const decimal = priceOf(row);
    if (!type || !athleteId || decimal === null || decimal <= 1) continue;
    const updatedAt = typeof row.lastUpdated === "string" ? row.lastUpdated : null;

    if (type.kind === "total") {
      const line = targetOf(row.current, row.odds?.total?.value);
      if (line === null) continue;
      const key = `${type.marketKey}|${athleteId}|${line}`;
      pairs.set(key, [...(pairs.get(key) ?? []), row]);
      continue;
    }

    const rung = type.kind === "yes" ? 1 : targetOf(row.current, row.odds?.total?.value);
    if (rung === null || rung < 1) continue;
    const openRung = type.kind === "yes" ? 1 : targetOf(row.open, row.odds?.total?.open);
    const line = rung - 0.5;
    out.push({
      athleteId, marketKey: type.marketKey, line, side: "over", decimal,
      openDecimal: openRung === rung ? openPriceOf(row) : null,
      openLine: openRung === null ? null : openRung - 0.5,
      otherDecimal: null, noVigFair: null, kind: type.kind, book, updatedAt,
    });
  }

  for (const [key, rows] of pairs) {
    if (rows.length !== 2) continue;
    const [marketKey, athleteId, lineText] = key.split("|");
    const line = Number(lineText);
    const [over, under] = rows.map((r) => priceOf(r)!);
    const overround = 1 / over + 1 / under;
    if (overround < 1 || overround > 1.2) continue;
    const fair = noVigPair(over, under);
    rows.forEach((row, i) => {
      const openLine = targetOf(row.open, row.odds?.total?.open);
      out.push({
        athleteId, marketKey, line, side: i === 0 ? "over" : "under", decimal: i === 0 ? over : under,
        openDecimal: openLine === line ? openPriceOf(row) : null,
        openLine,
        otherDecimal: i === 0 ? under : over,
        noVigFair: i === 0 ? fair.a : fair.b,
        kind: "total", book, updatedAt: typeof row.lastUpdated === "string" ? row.lastUpdated : null,
      });
    });
  }
  return out;
}

function eventBase(sport: SportDef, eventId: string): string {
  return `${CORE}/${sport.espnSport}/leagues/${sport.espnLeague}/events/${eventId}/competitions/${eventId}`;
}

export interface PropFeed { status: "ok" | "empty" | "error"; props: PostedProp[] }

/** One request per game, cached ten minutes; a failure is never cached and never throws. */
export async function getPropPrices(sportKey: string, eventId: string, force = false): Promise<PropFeed> {
  const sport = getSport(sportKey);
  if (sport.kind !== "team" || !/^\d{1,12}$/.test(eventId)) return { status: "empty", props: [] };
  const key = `espn-props-${sport.key}-${eventId}`;
  if (!force) {
    const hit = readCache<PropFeed>(key, TTL.props);
    if (hit) return hit;
  }
  try {
    const payload = await espnJson(`${eventBase(sport, eventId)}/odds/100/propBets?limit=1000`, { timeoutMs: 5000 });
    const props = parsePropBets(payload, sport.key);
    const feed: PropFeed = { status: props.length ? "ok" : "empty", props };
    writeCache(key, feed);
    return feed;
  } catch {
    return { status: "error", props: [] };
  }
}

// ---- game lines: open, current, close ------------------------------------------------------------

export interface LineSnapshot {
  homeMl: number | null; awayMl: number | null; draw: number | null;
  total: number | null; over: number | null; under: number | null;
  /** Home handicap (e.g. -1.5) and its two prices. */
  spread: number | null; homeSpread: number | null; awaySpread: number | null;
}
export interface ProviderLines { provider: string; open: LineSnapshot | null; current: LineSnapshot | null; close: LineSnapshot | null }

const EMPTY: LineSnapshot = { homeMl: null, awayMl: null, draw: null, total: null, over: null, under: null, spread: null, homeSpread: null, awaySpread: null };

function snapshot(item: Json, phase: "open" | "current" | "close"): LineSnapshot | null {
  const block = item[phase] as Json | undefined;
  const home = item.homeTeamOdds?.[phase] as Json | undefined;
  const away = item.awayTeamOdds?.[phase] as Json | undefined;
  if (!block && !home && !away) return null;
  const snap: LineSnapshot = {
    homeMl: num(home?.moneyLine?.decimal), awayMl: num(away?.moneyLine?.decimal), draw: num(block?.draw?.decimal),
    total: num(block?.total?.american ?? block?.total?.alternateDisplayValue), over: num(block?.over?.decimal), under: num(block?.under?.decimal),
    spread: num(home?.pointSpread?.american ?? home?.pointSpread?.alternateDisplayValue), homeSpread: num(home?.spread?.decimal), awaySpread: num(away?.spread?.decimal),
  };
  return Object.values(snap).some((v) => v !== null) ? snap : null;
}

export function parseGameLines(payload: Json): ProviderLines[] {
  const out: ProviderLines[] = [];
  for (const item of (payload.items ?? []) as Json[]) {
    const provider = String(item.provider?.name ?? "").trim();
    if (!provider) continue;
    if (item.open || item.current || item.close) {
      out.push({ provider, open: snapshot(item, "open"), current: snapshot(item, "current"), close: snapshot(item, "close") });
    } else if (item.homeTeamOdds?.odds || item.drawOdds) {
      // Bet 365 publishes only a current decimal per outcome.
      const current = { ...EMPTY, homeMl: num(item.homeTeamOdds?.odds?.value), awayMl: num(item.awayTeamOdds?.odds?.value), draw: num(item.drawOdds?.value) };
      out.push({ provider, open: null, current: Object.values(current).some((v) => v !== null) ? current : null, close: null });
    }
  }
  return out;
}

export async function getGameLines(sportKey: string, eventId: string, force = false): Promise<ProviderLines[]> {
  const sport = getSport(sportKey);
  if (sport.kind !== "team" || !/^\d{1,12}$/.test(eventId)) return [];
  const key = `espn-lines-${sport.key}-${eventId}`;
  if (!force) {
    const hit = readCache<ProviderLines[]>(key, TTL.lines);
    if (hit) return hit;
  }
  try {
    const lines = parseGameLines(await espnJson(`${eventBase(sport, eventId)}/odds?limit=100`, { timeoutMs: 5000 }));
    if (lines.length) writeCache(key, lines);
    return lines;
  } catch {
    return [];
  }
}
