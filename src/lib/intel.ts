import { z } from "zod";
import { cached } from "@/lib/cache";
import { listExtraSources, loadConfig } from "@/lib/config";
import { getGameDetail, getPlayerHistory } from "@/lib/sources/espn";
import { attachMeasurement, matchAthlete } from "@/lib/props/history";
import { buildBets } from "@/lib/bets/builder";
import { normaliseLang, type Lang } from "@/lib/i18n";
import { DEFAULT_SPORT } from "@/lib/sports";
import { XLoginWallError, buildXIntel, fetchInsiderTweets } from "@/lib/sources/x";
import { fetchPicks, fetchProps, toSourceError } from "@/lib/sources/scraped";
import { generateStructured } from "@/lib/ai/extract";
import { aiConfigured } from "@/lib/ai/client";
import { NeedsLoginError } from "@/lib/browser/session";
import type {
  BetSlate, GameBrief, GameDetail, GameIntel, PickRow, PropRow, SourceResult, Tweet, XIntel,
} from "@/lib/types";

/** The four named sources plus "brief"/"bets"; any other string is an extraSources key. */
export type SourceName = string;

const TTL = {
  tweets: 8 * 60_000,
  xIntel: 12 * 60_000,
  scraped: 15 * 60_000,
  brief: 15 * 60_000,
  bets: 15 * 60_000,
};

/**
 * Enriches scraped prop rows with hit rates computed from ESPN game logs. Doing this before the
 * brief and the bet builder run means both reason over measured numbers rather than the source
 * tool's own claims — and a disagreement between the two becomes visible.
 */
async function measureProps(props: PropRow[], detail: GameDetail, force: boolean): Promise<PropRow[]> {
  const athletes = detail.rosters.flatMap((r) => r.athletes ?? []);
  if (!athletes.length) return props.map((p) => ({ ...p, measured: null }));

  const histories = new Map<string, Awaited<ReturnType<typeof getPlayerHistory>>>();
  const out: PropRow[] = [];
  for (const prop of props) {
    const match = matchAthlete(prop.player, athletes);
    if (!match) {
      out.push({ ...prop, measured: null });
      continue;
    }
    if (!histories.has(match.id)) {
      histories.set(match.id, await getPlayerHistory(detail.game.sportKey, match.id, force).catch(() => null));
    }
    out.push(attachMeasurement(prop, histories.get(match.id) ?? null, detail.game.sportKey));
  }
  return out;
}

function nowIso() {
  return new Date().toISOString();
}

function disabled<T>(source: string): SourceResult<T> {
  return { source, status: "disabled", data: null, fetchedAt: nowIso() };
}

async function xIntelFor(
  detail: GameDetail,
  lang: Lang,
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
      `x-intel-${detail.game.id}-${lang}`,
      TTL.xIntel,
      () => buildXIntel(tweets, detail.game, detail, lang),
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

const BRIEF_SYSTEM_PT = `${BRIEF_SYSTEM}

Write every field of your answer in Brazilian Portuguese — headline, angles, support, injuryWatch,
conflicts, missingData and disclaimer. Keep player names, team names, market names and every number
exactly as supplied.`;

async function briefFor(
  detail: GameDetail,
  x: SourceResult<XIntel>,
  props: GameIntel["propscash"],
  picks: GameIntel["mamaKnowsBets"],
  dimers: GameIntel["dimers"],
  lang: Lang,
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
      `brief-${game.id}-${lang}`,
      TTL.brief,
      () =>
        generateStructured({
          schema: BriefSchema,
          system: lang === "pt" ? BRIEF_SYSTEM_PT : BRIEF_SYSTEM,
          prompt,
          maxTokens: 8000,
        }),
      force,
    );
    return { source: "Synthesis", status: "ok", data: brief, fetchedAt: nowIso() };
  } catch (error) {
    return toSourceError<GameBrief>("Synthesis", error);
  }
}

async function betsFor(
  detail: GameDetail,
  props: PropRow[],
  picks: PickRow[],
  dimers: PickRow[],
  x: XIntel | null,
  bands: string[],
  lang: Lang,
  force: boolean,
): Promise<SourceResult<BetSlate>> {
  if (!aiConfigured()) {
    return {
      source: "Bets",
      status: "error",
      data: null,
      error: "ANTHROPIC_API_KEY is not set — add it to .env.local to build tickets.",
      fetchedAt: nowIso(),
    };
  }
  try {
    const slate = await cached<BetSlate>(
      `bets-${detail.game.id}-${bands.join("_")}-${lang}`,
      TTL.bets,
      () => buildBets({ game: detail.game, detail, props, picks, dimers, x, bands, lang }),
      force,
    );
    return {
      source: "Bets",
      status: slate.suggestions.length ? "ok" : "empty",
      data: slate,
      error: slate.suggestions.length ? undefined : slate.dataNote,
      fetchedAt: nowIso(),
    };
  } catch (error) {
    return toSourceError<BetSlate>("Bets", error);
  }
}

export interface GatherOptions {
  force?: boolean;
  only?: SourceName[];
  sportKey?: string;
  lang?: Lang;
  bands?: string[];
}

export async function gatherIntel(gameId: string, opts: GatherOptions = {}): Promise<GameIntel> {
  const { force = false, only, sportKey = DEFAULT_SPORT, bands = ["value", "mid", "long", "moonshot"] } = opts;
  const lang = normaliseLang(opts.lang);
  const wants = (name: SourceName) => !only || only.includes(name);
  const cfg = loadConfig();

  const detail = await getGameDetail(gameId, force, sportKey);
  if (!detail) throw new Error(`Game ${gameId} not found on the ESPN slate.`);

  const [x, propscash, mamaKnowsBets, dimers] = await Promise.all([
    wants("x") ? xIntelFor(detail, lang, force) : Promise.resolve(disabled<XIntel>("X")),
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

  if (propscash.status === "ok" && propscash.data) {
    const data = propscash.data as { props: PropRow[]; notes: string[] };
    (propscash as SourceResult<unknown>).data = {
      ...data,
      props: await measureProps(data.props, detail, force).catch(() => data.props),
    };
  }

  const brief = wants("brief")
    ? await briefFor(
        detail,
        x,
        propscash as GameIntel["propscash"],
        mamaKnowsBets as GameIntel["mamaKnowsBets"],
        dimers as GameIntel["dimers"],
        lang,
        force,
      )
    : disabled<GameBrief>("Synthesis");

  const bets = wants("bets")
    ? await betsFor(
        detail,
        (propscash.data as { props: PropRow[] } | null)?.props ?? [],
        (mamaKnowsBets.data as { picks: PickRow[] } | null)?.picks ?? [],
        (dimers.data as { picks: PickRow[] } | null)?.picks ?? [],
        (x.data as XIntel | null) ?? null,
        bands,
        lang,
        force,
      )
    : disabled<BetSlate>("Bets");

  return {
    game: detail.game,
    detail,
    x,
    propscash: propscash as GameIntel["propscash"],
    mamaKnowsBets: mamaKnowsBets as GameIntel["mamaKnowsBets"],
    dimers: dimers as GameIntel["dimers"],
    brief,
    bets,
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
  const { force = false, only, sportKey = DEFAULT_SPORT, bands = ["value", "mid", "long", "moonshot"] } = opts;
  const lang = normaliseLang(opts.lang);
  const wants = (name: SourceName) => !only || only.includes(name);
  const cfg = loadConfig();

  const detail = await getGameDetail(gameId, force, sportKey);
  if (!detail) {
    yield { type: "error", message: `Game ${gameId} not found on the ESPN slate.` };
    return;
  }
  yield { type: "detail", detail };

  const planned = ["x", "propscash", "mamaknowsbets", "dimers", ...listExtraSources(cfg).map((e) => e.key)].filter(wants);
  yield {
    type: "started",
    sources: [...planned, ...(wants("brief") ? (["brief"] as const) : []), ...(wants("bets") ? (["bets"] as const) : [])],
  };

  const results: Record<string, SourceResult<unknown>> = {};
  const inflight = new Map<string, Promise<{ key: string; value: SourceResult<unknown> }>>();

  if (wants("x")) inflight.set("x", tagged("x", xIntelFor(detail, lang, force)));
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
  for (const extra of listExtraSources(cfg)) {
    if (!wants(extra.key)) continue;
    inflight.set(
      extra.key,
      tagged(
        extra.key,
        cached(`${extra.key}-${gameId}`, TTL.scraped, () => fetchPicks(extra.key, extra.config, detail.game), force) as Promise<SourceResult<unknown>>,
      ),
    );
  }

  while (inflight.size) {
    const { key, value } = await Promise.race(inflight.values());
    inflight.delete(key);

    // Props get measured against game logs the moment they land, before anything reads them.
    if (key === "propscash" && value.status === "ok") {
      const data = value.data as { props: PropRow[]; notes: string[] };
      const measured = await measureProps(data.props, detail, force).catch(() => data.props);
      value.data = { ...data, props: measured } as typeof value.data;
      const withHistory = measured.filter((p) => p.measured).length;
      value.meta = { ...(value.meta ?? {}), measured: withHistory, ofProps: measured.length };
    }

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
      lang,
      force,
    );
    yield { type: "source", name: "brief", result: brief };
  }

  if (wants("bets")) {
    const props = (results.propscash?.data as { props: PropRow[] } | undefined)?.props ?? [];
    const picks = (results.mamaknowsbets?.data as { picks: PickRow[] } | undefined)?.picks ?? [];
    const dimersPicks = [
      ...((results.dimers?.data as { picks: PickRow[] } | undefined)?.picks ?? []),
      ...listExtraSources(cfg).flatMap((e) => {
        const picks = (results[e.key]?.data as { picks: PickRow[] } | undefined)?.picks ?? [];
        // Tag the origin so calibration can later attribute hits to the right source.
        return picks.map((p) => ({ ...p, book: p.book ?? e.config.label, label: `[${e.config.label}] ${p.label}` }));
      }),
    ];
    const xIntel = (results.x?.data as XIntel | undefined) ?? null;
    const bets = await betsFor(detail, props, picks, dimersPicks, xIntel, bands, lang, force);
    yield { type: "source", name: "bets", result: bets };
  }

  yield { type: "done" };
}
