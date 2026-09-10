import { z } from "zod";
import { activeInsiders, batchHandles, type XConfig } from "@/lib/config";
import { withPage } from "@/lib/browser/session";
import { generateStructured } from "@/lib/ai/extract";
import type { Lang } from "@/lib/i18n";
import type { Game, GameDetail, Tweet, XIntel } from "@/lib/types";

/** X search caps query length; `-filter:replies` keeps the feed to original reporting. */
function buildQuery(handles: string[]): string {
  return `(${handles.map((h) => `from:${h}`).join(" OR ")}) -filter:replies`;
}

function searchUrl(template: string, query: string): string {
  return template.replace("{query}", encodeURIComponent(query));
}

async function scrapeSearch(
  url: string,
  maxTweets: number,
): Promise<{ tweets: Tweet[]; loginWall: boolean }> {
  return withPage("x", async (page) => {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.waitForTimeout(2_500);

    if (/\/i\/flow\/login|\/login/.test(page.url())) {
      return { tweets: [], loginWall: true };
    }

    const seen = new Map<string, Tweet>();
    // X virtualises the timeline: nodes are recycled on scroll, so harvest after every pass.
    for (let pass = 0; pass < 10 && seen.size < maxTweets; pass += 1) {
      const batch = await page.$$eval('article[data-testid="tweet"]', (articles) =>
        articles.map((article) => {
          const textNode = article.querySelector('[data-testid="tweetText"]');
          const timeNode = article.querySelector("time");
          const permalink = timeNode?.closest("a") as HTMLAnchorElement | null;
          const href = permalink?.getAttribute("href") ?? "";
          const match = href.match(/^\/([^/]+)\/status\/(\d+)/);
          const nameNode = article.querySelector('[data-testid="User-Name"]');
          return {
            id: match?.[2] ?? "",
            handle: match?.[1] ?? "",
            authorName: (nameNode as HTMLElement | null)?.innerText?.split("\n")[0] ?? "",
            text: (textNode as HTMLElement | null)?.innerText ?? "",
            postedAt: timeNode?.getAttribute("datetime") ?? "",
            url: href ? `https://x.com${href}` : "",
          };
        }),
      );

      for (const t of batch) {
        if (!t.id || !t.text || seen.has(t.id)) continue;
        seen.set(t.id, t as Tweet);
      }

      await page.mouse.wheel(0, 2600);
      await page.waitForTimeout(1_200);
    }

    return { tweets: [...seen.values()], loginWall: false };
  });
}

export class XLoginWallError extends Error {
  constructor() {
    super("X redirected to the login wall — the saved session expired. Run: pnpm login x");
    this.name = "XLoginWallError";
  }
}

export async function fetchInsiderTweets(cfg: XConfig): Promise<Tweet[]> {
  const insiders = activeInsiders(cfg);
  const tierByHandle = new Map(insiders.map((i) => [i.handle.toLowerCase(), i.tier ?? "beat"]));
  const cutoff = Date.now() - cfg.lookbackHours * 3_600_000;
  const collected = new Map<string, Tweet>();

  for (const batch of batchHandles(insiders, cfg.handlesPerQuery)) {
    const url = searchUrl(cfg.searchUrl, buildQuery(batch.map((i) => i.handle)));
    const { tweets, loginWall } = await scrapeSearch(url, cfg.maxTweetsPerQuery);
    if (loginWall) throw new XLoginWallError();
    for (const tweet of tweets) {
      const ts = tweet.postedAt ? Date.parse(tweet.postedAt) : Date.now();
      if (Number.isFinite(ts) && ts < cutoff) continue;
      collected.set(tweet.id, { ...tweet, tier: tierByHandle.get(tweet.handle.toLowerCase()) });
    }
  }

  return [...collected.values()].sort((a, b) => (b.postedAt ?? "").localeCompare(a.postedAt ?? ""));
}

function lastNames(detail: GameDetail | null): string[] {
  if (!detail) return [];
  return detail.rosters
    .flatMap((r) => r.players)
    .map((name) => name.split(" ").slice(-1)[0])
    .filter((n) => n.length > 3);
}

/** Cheap keyword pass so the model sees a focused set instead of the whole insider firehose. */
export function preFilterForGame(tweets: Tweet[], game: Game, detail: GameDetail | null): Tweet[] {
  const needles = [
    game.home.name,
    game.away.name,
    game.home.displayName,
    game.away.displayName,
    game.home.abbreviation,
    game.away.abbreviation,
    ...lastNames(detail),
  ]
    .filter(Boolean)
    .map((n) => n.toLowerCase());

  const matched: Tweet[] = [];
  const rest: Tweet[] = [];
  for (const tweet of tweets) {
    const haystack = tweet.text.toLowerCase();
    (needles.some((n) => haystack.includes(n)) ? matched : rest).push(tweet);
  }
  // Keep a slice of unmatched recent posts — league-wide news can still move a line.
  return [...matched, ...rest.slice(0, Math.max(0, 25 - matched.length))].slice(0, 120);
}

const IntelSchema = z.object({
  summary: z
    .string()
    .describe("Two to four sentences on what the last day of reporting means for this specific game."),
  items: z.array(
    z.object({
      tweetId: z.string(),
      relevance: z.enum(["high", "medium", "low"]),
      category: z.enum(["injury", "lineup", "rotation", "trade", "rest", "betting", "other"]),
      playersMentioned: z.array(z.string()),
      teamsMentioned: z.array(z.string()),
      bettingImpact: z.string().describe("One line on how this could move a line or a prop. Say 'none' if it does not."),
    }),
  ),
});

const INTEL_SYSTEM = `You triage NBA reporting for a bettor researching one specific game.

- Only keep posts that bear on this matchup: the two teams, their players, injuries, rest, rotations, trades, or lines.
- Drop unrelated league news, promos, and commentary.
- Never restate a rumour as confirmed. Reflect the reporter's own hedging ("expected to", "questionable").
- Rank relevance by how directly it changes who plays or how a line should move.
- Return only tweetIds present in the input.`;

const INTEL_SYSTEM_PT = `${INTEL_SYSTEM}

Write the summary and every bettingImpact in Brazilian Portuguese. Leave the quoted post text,
player names and team names exactly as they appear.`;

export async function buildXIntel(
  tweets: Tweet[],
  game: Game,
  detail: GameDetail | null,
  lang: Lang = "pt",
): Promise<XIntel> {
  const candidates = preFilterForGame(tweets, game, detail);
  if (!candidates.length) {
    return {
      summary:
        lang === "pt"
          ? "Nenhuma publicação das contas configuradas mencionou este confronto."
          : "No insider posts from the configured accounts mentioned this matchup.",
      items: [],
      scanned: tweets.length,
    };
  }

  const byId = new Map(candidates.map((t) => [t.id, t]));
  const prompt = [
    `GAME: ${game.away.displayName} @ ${game.home.displayName}`,
    `TIPOFF (UTC): ${game.startsAt}`,
    game.odds?.details ? `MARKET: ${game.odds.details}, total ${game.odds.overUnder ?? "n/a"}` : "",
    detail ? `INJURY REPORT: ${detail.injuries.map((i) => `${i.player} (${i.teamAbbreviation}) ${i.status}`).join("; ") || "none listed"}` : "",
    "",
    "POSTS:",
    ...candidates.map((t) => `[${t.id}] @${t.handle} ${t.postedAt ?? ""}\n${t.text}`),
  ]
    .filter(Boolean)
    .join("\n");

  const result = await generateStructured({
    schema: IntelSchema,
    system: lang === "pt" ? INTEL_SYSTEM_PT : INTEL_SYSTEM,
    prompt,
  });

  const items = result.items
    .map((item) => {
      const tweet = byId.get(item.tweetId);
      if (!tweet) return null;
      return {
        tweetId: item.tweetId,
        handle: tweet.handle,
        url: tweet.url,
        postedAt: tweet.postedAt,
        text: tweet.text,
        relevance: item.relevance,
        category: item.category,
        playersMentioned: item.playersMentioned,
        teamsMentioned: item.teamsMentioned,
        bettingImpact: item.bettingImpact,
      };
    })
    .filter((i): i is NonNullable<typeof i> => i !== null);

  const order = { high: 0, medium: 1, low: 2 } as const;
  items.sort((a, b) => order[a.relevance] - order[b.relevance]);

  return { summary: result.summary, items, scanned: tweets.length };
}
