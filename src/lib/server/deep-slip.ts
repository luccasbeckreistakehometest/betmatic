import { z } from "zod";
import { generateStructured } from "@/lib/ai/extract";
import { aiConfigured, CHEAP_MODEL } from "@/lib/ai/client";
import { correlationFlags, flagText, resolveParsedLeg, resolveTypedLeg, type GameContext, type ResolvedLeg, type TypedLeg } from "@/lib/bets/deep-slip";
import { historyFor, roleFor } from "@/lib/props/candidates";
import { measureProp } from "@/lib/props/history";
import { getGameDetail, getSlate, shiftKey, todayKey } from "@/lib/sources/espn";
import { getPropPrices } from "@/lib/sources/espn-props";
import { americanToDecimal, noVigPair } from "@/lib/odds";
import { normaliseName } from "@/lib/resolve/names";
import { reportError } from "@/lib/server/ops-log";
import { getSport, SOLD_SPORTS } from "@/lib/sports";
import type { GameDetail } from "@/lib/types";
import type { Lang } from "@/lib/i18n";

/** One typed leg after the deterministic enrichment: what the numbers say before the model speaks. */
export interface DeepLegView extends ResolvedLeg {
  selection: string;
  measured: { last5: string; last10: string; season: string; rate: number } | null;
  posted: { decimal: number; noVigFair: number | null; line: number } | null;
  role: string | null;
  injury: string | null;
  /** Best moneyline among the providers ESPN lists, for team legs (providers stay unnamed). */
  bestPrice: { decimal: number; books: number } | null;
  startsAt: string | null;
}

export interface DeepContext { legs: DeepLegView[]; flags: string[]; resolved: number; parsed: number }

const ParseSchema = z.object({
  legs: z.array(z.object({
    index: z.number(),
    player: z.string().nullable().describe("Player name exactly as typed, or null."),
    team: z.string().nullable().describe("Team name as typed, or null."),
    stat: z.string().nullable().describe("The stat or market in English (points, rebounds, shots, goals, moneyline, total), or null."),
    line: z.number().nullable(),
    side: z.enum(["over", "under"]).nullable(),
  })),
});

/**
 * The games a typed or printed leg can be matched to: the sport's slates on the given day offsets,
 * with rosters. `upcomingOnly` keeps scheduled games (the deep analysis); a slip print can also be of
 * a game that already started or ended.
 */
export async function slateContexts(sportKey: string, offsets: number[], opts: { upcomingOnly: boolean; max?: number }): Promise<{ contexts: GameContext[]; details: Map<string, GameDetail> }> {
  const today = todayKey();
  const slates = await Promise.all(offsets.map((o) => getSlate(shiftKey(today, o), false, sportKey).catch(() => [])));
  const games = slates.flat()
    .filter((g) => !opts.upcomingOnly || (g.status === "scheduled" && Date.parse(g.startsAt) > Date.now() - 3 * 3_600_000))
    .slice(0, opts.max ?? 16);
  const details = new Map<string, GameDetail>();
  const contexts: GameContext[] = [];
  // Six at a time: a full round of details is a few dozen cached ESPN reads.
  const fetched: (GameDetail | null)[] = [];
  for (let i = 0; i < games.length; i += 6) {
    fetched.push(...(await Promise.all(games.slice(i, i + 6).map((g) => getGameDetail(g.id, false, sportKey).catch(() => null)))));
  }
  for (const [i, g] of games.entries()) {
    const d = fetched[i];
    if (!d) continue;
    details.set(g.id, d);
    contexts.push({
      id: g.id, sportKey, startsAt: g.startsAt, home: d.game.home, away: d.game.away,
      athletes: d.rosters.flatMap((r) => (r.athletes ?? []).map((a) => ({ id: a.id, name: a.name, team: r.teamAbbreviation }))),
    });
  }
  return { contexts, details };
}

/** Decimal moneyline of a team in a book row, whichever form ESPN printed. */
const mlDecimal = (american: number | undefined) => (american !== undefined && Number.isFinite(american) && american !== 0 ? americanToDecimal(american) : NaN);

/**
 * Resolves and enriches a typed slip. The sport comes from the page the user is on; legs that name
 * nothing on its upcoming slate stay "not found" (a single cheap parse is tried first when AI is on).
 */
export async function buildDeepContext(sportKey: string, legs: TypedLeg[], lang: Lang): Promise<DeepContext> {
  const sport = SOLD_SPORTS.find((s) => s.key === sportKey) ?? getSport(sportKey);
  const { contexts, details } = await slateContexts(sport.key, [0, 1], { upcomingOnly: true });
  const resolved = legs.map((l, i) => resolveTypedLeg(l, i, contexts));
  const missing = resolved.filter((r) => r.kind === "unknown" || (r.kind === "player" && (r.line === null || !r.marketKey)));
  let parsedCount = 0;
  if (missing.length && contexts.length && aiConfigured()) {
    try {
      const out = await generateStructured({
        schema: ParseSchema,
        system: "You split betting-slip lines into fields. Copy names exactly as written; never guess a name that is not in the text.",
        prompt: missing.map((r) => `[${r.index}] ${legs[r.index].selection} | ${legs[r.index].market}`).join("\n"),
        model: CHEAP_MODEL,
        maxTokens: 1000,
        label: "slip_parse",
        mock: () => ({ legs: missing.map((r) => ({ index: r.index, player: null, team: null, stat: null, line: null, side: null })) }),
      });
      for (const p of out.legs) {
        const current = resolved[p.index];
        if (!current) continue;
        const next = resolveParsedLeg(p, contexts);
        if (next.kind === "unknown") continue;
        parsedCount += 1;
        resolved[p.index] = current.kind === "player" ? { ...current, marketKey: current.marketKey ?? next.marketKey, line: current.line ?? p.line, side: current.side ?? p.side, via: "parse" } : next;
      }
    } catch (error) {
      reportError("ai.slip_parse", error, {}, "warn");
    }
  }

  const favourite: Record<string, string | null> = {};
  for (const [id, d] of details) {
    const book = d.books[0];
    const home = mlDecimal(book?.homeMoneyline);
    const away = mlDecimal(book?.awayMoneyline);
    favourite[id] = Number.isFinite(home) && Number.isFinite(away) ? (home < away ? d.game.home.abbreviation : d.game.away.abbreviation) : null;
  }

  const views: DeepLegView[] = [];
  for (const r of resolved) {
    const d = r.gameId ? details.get(r.gameId) : undefined;
    const view: DeepLegView = { ...r, selection: legs[r.index].selection, measured: null, posted: null, role: null, injury: null, bestPrice: null, startsAt: d?.game.startsAt ?? null };
    if (r.kind === "player" && r.athleteId && d) {
      const injury = d.injuries.find((i) => normaliseName(i.player) === normaliseName(r.player ?? ""));
      view.injury = injury?.status ?? null;
      const history = await historyFor(sport.key, r.athleteId).catch(() => null);
      view.role = (await roleFor(sport, { athleteId: r.athleteId, name: r.player ?? "" }, history).catch(() => null))?.tier ?? null;
      if (history && r.marketKey && r.line !== null) {
        const m = measureProp(history, r.marketKey, r.line, r.side ?? "over", sport.key);
        if (m) view.measured = { last5: `${m.last5.hits}/${m.last5.of}`, last10: `${m.last10.hits}/${m.last10.of}`, season: `${m.season.hits}/${m.season.of}`, rate: m.impliedFair };
      }
      const feed = await getPropPrices(sport.key, d.game.id).catch(() => null);
      const posted = feed?.props.find((p) => p.athleteId === r.athleteId && p.marketKey === r.marketKey && p.side === (r.side ?? "over") && (r.line === null || p.line === r.line))
        ?? feed?.props.find((p) => p.athleteId === r.athleteId && p.marketKey === r.marketKey && p.side === (r.side ?? "over"));
      if (posted) view.posted = { decimal: posted.decimal, noVigFair: posted.noVigFair, line: posted.line };
    }
    if ((r.kind === "moneyline" || r.kind === "draw") && d && r.team) {
      const home = r.team === d.game.home.abbreviation;
      const prices = d.books.map((b) => mlDecimal(home ? b.homeMoneyline : b.awayMoneyline)).filter(Number.isFinite);
      if (prices.length && r.kind === "moneyline") view.bestPrice = { decimal: Math.max(...prices), books: prices.length };
      const book = d.books[0];
      const pair = book ? [mlDecimal(book.homeMoneyline), mlDecimal(book.awayMoneyline)] : [];
      if (pair.length === 2 && pair.every(Number.isFinite) && r.kind === "moneyline") {
        // Football has a draw: a two-way no-vig would overstate both sides, so it is left out there.
        const fair = sport.group === "basketball" ? noVigPair(pair[0], pair[1]) : null;
        view.posted = { decimal: home ? pair[0] : pair[1], noVigFair: fair ? (home ? fair.a : fair.b) : null, line: 0 };
      }
    }
    views.push(view);
  }
  const flags = correlationFlags(resolved, favourite).map((f) => flagText(f, lang));
  return { legs: views, flags, resolved: resolved.filter((r) => r.kind !== "unknown").length, parsed: parsedCount };
}

/** The verified block the judgement model reads before writing its verdict. */
export function deepPrompt(ctx: DeepContext): string {
  const lines = ["VERIFIED DATA PER LEG (computed in code from ESPN; trust these numbers over your own):"];
  for (const l of ctx.legs) {
    if (l.kind === "unknown") { lines.push(`[${l.index}] not found on the upcoming slate — judge it with caution and say it could not be checked.`); continue; }
    const parts = [`[${l.index}] ${l.kind} · ${l.matchup ?? ""}`];
    if (l.player) parts.push(`player ${l.player} (${l.team}), role ${l.role ?? "unknown"}${l.injury ? `, injury status ${l.injury}` : ""}`);
    if (l.marketKey && l.line !== null) parts.push(`${l.marketKey} ${l.side ?? "over"} ${l.line}`);
    if (l.measured) parts.push(`measured L5 ${l.measured.last5}, L10 ${l.measured.last10}, season ${l.measured.season}`);
    if (l.posted) parts.push(`book ${l.posted.decimal.toFixed(2)}${l.posted.noVigFair !== null ? ` (no-vig ${Math.round(l.posted.noVigFair * 100)}%)` : ""}${l.posted.line && l.line !== null && l.posted.line !== l.line ? ` at line ${l.posted.line}` : ""}`);
    if (l.bestPrice) parts.push(`best price ${l.bestPrice.decimal.toFixed(2)}`);
    lines.push(parts.join(" | "));
  }
  if (ctx.flags.length) lines.push("CORRELATION FLAGS:", ...ctx.flags.map((f) => `- ${f}`));
  return lines.join("\n");
}
