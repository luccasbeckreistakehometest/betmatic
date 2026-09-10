import { z } from "zod";
import { cached } from "@/lib/cache";
import { loadConfig } from "@/lib/config";
import { getGameDetail } from "@/lib/sources/espn";
import { XLoginWallError, buildXIntel, fetchInsiderTweets } from "@/lib/sources/x";
import { fetchPicks, fetchProps, toSourceError } from "@/lib/sources/scraped";
import { generateStructured } from "@/lib/ai/extract";
import { aiConfigured } from "@/lib/ai/client";
import { NeedsLoginError } from "@/lib/browser/session";
import type { GameBrief, GameDetail, GameIntel, SourceResult, Tweet, XIntel } from "@/lib/types";

export type SourceName = "x" | "propscash" | "mamaknowsbets" | "dimers" | "brief";

const TTL = {
  tweets: 8 * 60_000,
  xIntel: 12 * 60_000,
  scraped: 15 * 60_000,
  brief: 15 * 60_000,
};

function nowIso() {
  return new Date().toISOString();
}

function disabled<T>(source: string): SourceResult<T> {
  return { source, status: "disabled", data: null, fetchedAt: nowIso() };
}

async function xIntelFor(
  detail: GameDetail,
  force: boolean,
): Promise<SourceResult<XIntel>> {
  const cfg = loadConfig().x;
  if (!cfg.enabled) return disabled("X");
  try {
    // The tweet pull is slate-wide, so it is cached once and reused by every game page.
    const tweets = await cached<Tweet[]>(
      `x-tweets-${cfg.lookbackHours}h`,
      TTL.tweets,
      () => fetchInsiderTweets(cfg),
      force,
    );
    if (!aiConfigured()) {
      return {
        source: "X",
        status: "error",
        data: null,
        error: "ANTHROPIC_API_KEY is not set — tweets were fetched but cannot be triaged.",
        fetchedAt: nowIso(),
        meta: { scanned: tweets.length },
      };
    }
    const intel = await cached<XIntel>(
      `x-intel-${detail.game.id}`,
      TTL.xIntel,
      () => buildXIntel(tweets, detail.game, detail),
      force,
    );
    return {
      source: "X",
      status: intel.items.length ? "ok" : "empty",
      data: intel,
      fetchedAt: nowIso(),
      meta: { scanned: intel.scanned, accounts: cfg.insiders.length },
    };
  } catch (error) {
    if (error instanceof XLoginWallError || error instanceof NeedsLoginError) {
      return { source: "X", status: "needs-login", data: null, error: error.message, fetchedAt: nowIso() };
    }
    return toSourceError<XIntel>("X", error);
  }
}

const BriefSchema = z.object({
  headline: z.string().describe("One sentence: the single most important thing to know before betting this game."),
  keyAngles: z.array(
    z.object({
      angle: z.string().describe("A specific, checkable angle — name the market and side."),
      support: z.string().describe("Which gathered source supports it, and what it actually said."),
      confidence: z.enum(["high", "medium", "low"]),
    }),
  ),
  injuryWatch: z.array(z.string()).describe("Players whose status is unresolved and would change the read."),
  conflicts: z.array(z.string()).describe("Places where two sources disagree."),
  missingData: z.array(z.string()).describe("Sources that returned nothing, so the reader knows what is not covered."),
  disclaimer: z.string(),
});

const BRIEF_SYSTEM = `You write a pre-game research brief for someone who bets on the NBA.

- Ground every claim in the gathered data. If a number did not come from a source, do not state it.
- Attribute: name which source supports each angle.
- Flag disagreement between sources rather than averaging it away.
- Confidence reflects evidence strength, not enthusiasm. Most angles should be medium or low.
- Never predict a result as certain, never suggest a stake size, and never imply an edge the sources do not show.
- Say plainly what is missing — an empty source is information.
- End with a one-line disclaimer that this is research, not advice, and that outcomes are uncertain.`;

async function briefFor(
  detail: GameDetail,
  x: SourceResult<XIntel>,
  props: GameIntel["propscash"],
  picks: GameIntel["mamaKnowsBets"],
  dimers: GameIntel["dimers"],
  force: boolean,
): Promise<SourceResult<GameBrief>> {
  if (!aiConfigured()) {
    return {
      source: "Synthesis",
      status: "error",
      data: null,
      error: "ANTHROPIC_API_KEY is not set — add it to .env.local to generate briefs.",
      fetchedAt: nowIso(),
    };
  }

  const { game } = detail;
  const sourceLine = (r: SourceResult<unknown>) =>
    r.status === "ok" ? "" : `${r.source}: ${r.status}${r.error ? ` — ${r.error}` : ""}`;

  const prompt = [
    `GAME: ${game.away.displayName} (${game.away.record ?? "?"}) at ${game.home.displayName} (${game.home.record ?? "?"})`,
    `TIPOFF (UTC): ${game.startsAt} · ${game.venue ?? ""} · ${game.broadcast ?? ""}`,
    game.odds ? `MARKET: ${game.odds.details ?? ""} | total ${game.odds.overUnder ?? "n/a"} | ML ${game.odds.awayMoneyline ?? "?"}/${game.odds.homeMoneyline ?? "?"} (${game.odds.provider ?? "n/a"})` : "MARKET: not published yet",
    detail.predictor ? `ESPN WIN PROBABILITY: away ${detail.predictor.awayWinPct ?? "?"}% / home ${detail.predictor.homeWinPct ?? "?"}%` : "",
    detail.ats.length ? `AGAINST THE SPREAD: ${detail.ats.map((a) => `${a.teamAbbreviation} ${a.record}`).join(" | ")}` : "",
    "",
    `INJURY REPORT (ESPN):\n${detail.injuries.map((i) => `- ${i.player} (${i.teamAbbreviation}, ${i.position ?? "?"}): ${i.status}${i.detail ? ` — ${i.detail}` : ""}`).join("\n") || "- none listed"}`,
    "",
    `INSIDER REPORTING (X):\n${
      x.data?.items.length
        ? `${x.data.summary}\n${x.data.items.map((i) => `- [${i.relevance}/${i.category}] @${i.handle}: ${i.text.replace(/\s+/g, " ").slice(0, 400)} → impact: ${i.bettingImpact}`).join("\n")}`
        : sourceLine(x) || "- nothing relevant found"
    }`,
    "",
    `PLAYER PROPS (${props.source}):\n${
      props.data?.props.length
        ? props.data.props
            .map((p) => `- ${p.player} ${p.market} ${p.side ?? ""} ${p.line ?? ""} @ ${p.odds ?? "?"} (${p.book ?? "?"}) proj ${p.projection ?? "?"} edge ${p.edgePct ?? "?"}%`)
            .join("\n")
        : sourceLine(props) || "- nothing returned"
    }`,
    "",
    `PUBLISHED PICKS (${picks.source}):\n${
      picks.data?.picks.length
        ? picks.data.picks.map((p) => `- ${p.label} | ${p.market} | ${p.selection} @ ${p.odds ?? "?"} (${p.book ?? "?"}) conf ${p.confidence ?? "?"} — ${p.rationale ?? ""}`).join("\n")
        : sourceLine(picks) || "- nothing returned"
    }`,
    "",
    `MODEL PROJECTIONS & BEST BETS (${dimers.source}):\n${
      dimers.data?.picks.length
        ? `${(dimers.data.notes ?? []).map((n) => `- ${n}`).join("\n")}\n${dimers.data.picks.map((p) => `- ${p.label} | ${p.market} | ${p.selection} @ ${p.odds ?? "?"} (${p.book ?? "?"}) conf ${p.confidence ?? "?"} — ${p.rationale ?? ""}`).join("\n")}`.trim()
        : sourceLine(dimers) || "- nothing returned"
    }`,
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const brief = await cached<GameBrief>(
      `brief-${game.id}`,
      TTL.brief,
      () => generateStructured({ schema: BriefSchema, system: BRIEF_SYSTEM, prompt, maxTokens: 8000 }),
      force,
    );
    return { source: "Synthesis", status: "ok", data: brief, fetchedAt: nowIso() };
  } catch (error) {
    return toSourceError<GameBrief>("Synthesis", error);
  }
}

export interface GatherOptions {
  force?: boolean;
  only?: SourceName[];
}

export async function gatherIntel(gameId: string, opts: GatherOptions = {}): Promise<GameIntel> {
  const { force = false, only } = opts;
  const wants = (name: SourceName) => !only || only.includes(name);
  const cfg = loadConfig();

  const detail = await getGameDetail(gameId, force);
  if (!detail) throw new Error(`Game ${gameId} not found on the ESPN slate.`);

  const [x, propscash, mamaKnowsBets, dimers] = await Promise.all([
    wants("x") ? xIntelFor(detail, force) : Promise.resolve(disabled<XIntel>("X")),
    wants("propscash")
      ? cached(`propscash-${gameId}`, TTL.scraped, () => fetchProps("propscash", cfg.propscash, detail.game), force)
      : Promise.resolve(disabled<{ props: never[]; notes: never[] }>(cfg.propscash.label)),
    wants("mamaknowsbets")
      ? cached(`mama-${gameId}`, TTL.scraped, () => fetchPicks("mamaknowsbets", cfg.mamaknowsbets, detail.game), force)
      : Promise.resolve(disabled<{ picks: never[]; notes: never[] }>(cfg.mamaknowsbets.label)),
    wants("dimers")
      ? cached(`dimers-${gameId}`, TTL.scraped, () => fetchPicks("dimers", cfg.dimers, detail.game), force)
      : Promise.resolve(disabled<{ picks: never[]; notes: never[] }>(cfg.dimers.label)),
  ]);

  const brief = wants("brief")
    ? await briefFor(
        detail,
        x,
        propscash as GameIntel["propscash"],
        mamaKnowsBets as GameIntel["mamaKnowsBets"],
        dimers as GameIntel["dimers"],
        force,
      )
    : disabled<GameBrief>("Synthesis");

  return {
    game: detail.game,
    detail,
    x,
    propscash: propscash as GameIntel["propscash"],
    mamaKnowsBets: mamaKnowsBets as GameIntel["mamaKnowsBets"],
    dimers: dimers as GameIntel["dimers"],
    brief,
  };
}

export type IntelEvent =
  | { type: "detail"; detail: GameDetail }
  | { type: "started"; sources: SourceName[] }
  | { type: "source"; name: SourceName; result: SourceResult<unknown> }
  | { type: "done" }
  | { type: "error"; message: string };

/** Tags a promise with its key so Promise.race can tell which source just landed. */
function tagged<K extends string, T>(key: K, promise: Promise<T>): Promise<{ key: K; value: T }> {
  return promise.then((value) => ({ key, value }));
}

/**
 * Same work as gatherIntel, but yields each source the moment it lands.
 * Scrapes take minutes, so the dashboard fills in progressively instead of staring at one spinner.
 */
export async function* streamIntel(
  gameId: string,
  opts: GatherOptions = {},
): AsyncGenerator<IntelEvent> {
  const { force = false, only } = opts;
  const wants = (name: SourceName) => !only || only.includes(name);
  const cfg = loadConfig();

  const detail = await getGameDetail(gameId, force);
  if (!detail) {
    yield { type: "error", message: `Game ${gameId} not found on the ESPN slate.` };
    return;
  }
  yield { type: "detail", detail };

  const planned = (["x", "propscash", "mamaknowsbets", "dimers"] as const).filter(wants);
  yield { type: "started", sources: [...planned, ...(wants("brief") ? (["brief"] as const) : [])] };

  const results: Record<string, SourceResult<unknown>> = {};
  const inflight = new Map<string, Promise<{ key: string; value: SourceResult<unknown> }>>();

  if (wants("x")) inflight.set("x", tagged("x", xIntelFor(detail, force)));
  if (wants("propscash")) {
    inflight.set(
      "propscash",
      tagged("propscash", cached(`propscash-${gameId}`, TTL.scraped, () => fetchProps("propscash", cfg.propscash, detail.game), force) as Promise<SourceResult<unknown>>),
    );
  }
  if (wants("mamaknowsbets")) {
    inflight.set(
      "mamaknowsbets",
      tagged("mamaknowsbets", cached(`mama-${gameId}`, TTL.scraped, () => fetchPicks("mamaknowsbets", cfg.mamaknowsbets, detail.game), force) as Promise<SourceResult<unknown>>),
    );
  }
  if (wants("dimers")) {
    inflight.set(
      "dimers",
      tagged("dimers", cached(`dimers-${gameId}`, TTL.scraped, () => fetchPicks("dimers", cfg.dimers, detail.game), force) as Promise<SourceResult<unknown>>),
    );
  }

  while (inflight.size) {
    const { key, value } = await Promise.race(inflight.values());
    inflight.delete(key);
    results[key] = value;
    yield { type: "source", name: key as SourceName, result: value };
  }

  if (wants("brief")) {
    const brief = await briefFor(
      detail,
      (results.x as SourceResult<XIntel>) ?? disabled<XIntel>("X"),
      (results.propscash as GameIntel["propscash"]) ?? disabled("PropsCash"),
      (results.mamaknowsbets as GameIntel["mamaKnowsBets"]) ?? disabled("Mama Knows Bets"),
      (results.dimers as GameIntel["dimers"]) ?? disabled("Dimers"),
      force,
    );
    yield { type: "source", name: "brief", result: brief };
  }

  yield { type: "done" };
}
