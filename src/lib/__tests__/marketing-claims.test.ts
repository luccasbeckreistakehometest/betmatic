import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { landingCopy, LADDER } from "@/lib/landing-copy";
import { SPORT_LANDINGS } from "@/lib/sport-landing";
import { PLANS } from "@/lib/plans";
import { impliedProbability } from "@/lib/odds";
import { t as translate, type DictKey, type Lang } from "@/lib/i18n";

/** Every string "Os bilhetes de hoje" renders. Kept here so a new one cannot skip the scan. */
export const TODAY_KEYS: DictKey[] = [
  "navToday", "todayTitle", "todaySubtitle", "todayMeta", "todayMetaOne", "todayFooter", "todayStake", "todayStakeNoMoney",
  "todayChance", "todayMinOdds", "todayCheckPrice", "todayNoBankroll", "todaySetBankroll", "todaySmallBankroll", "todayWhy",
  "todayOpenBook", "todayOpenGame", "todayRegister", "todayRegistered", "todayLadder", "todayCapped", "todayAllTickets",
  "todayLive", "todayLiveReference", "todayLiveMin", "todayLiveAsk", "todayLiveExpired", "todayLiveUnverified",
  "todayMeasuring", "todayNoneTitle", "todayNoneBody", "todayNoneAll", "todayNoneMethod", "todayPlanBand",
  "todayUnavailable", "todayStakeRefused",
];

/**
 * Sales copy is the one place where a claim can outlive the feature it describes. Everything here
 * reads the copy the pages actually render and checks it against the routes on disk and against the
 * Brazilian advertising rules (Lei 14.790/2023 and the CONAR annex), so a removed page or a
 * borrowed "guaranteed profit" line fails the build instead of shipping.
 */
const SRC = fileURLToPath(new URL("../..", import.meta.url));
const APP = join(SRC, "app");

/** Every page route the app serves, with route groups stripped and dynamic segments kept as `[x]`. */
function routes(dir = APP, prefix = ""): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (!statSync(full).isDirectory()) {
      if (entry === "page.tsx") found.push(prefix || "/");
      continue;
    }
    if (entry.startsWith("_") || entry === "api") continue;
    // A route group — (marketing), (app) — is a folder, never a path segment.
    found.push(...routes(full, entry.startsWith("(") ? prefix : `${prefix}/${entry}`));
  }
  return found;
}

const ROUTES = new Set(routes());

const SPORT_SLUGS = new Set(SPORT_LANDINGS.flatMap((s) => [s.slug.pt, s.slug.en]));

/** `/planos?lang=en` and `/app/game/123` both have to land on a page that exists. */
function routeExists(href: string): boolean {
  const path = href.split(/[?#]/)[0].replace(/\/$/, "") || "/";
  if (ROUTES.has(path)) return true;
  const parts = path.split("/").filter(Boolean);
  return [...ROUTES].some((route) => {
    const own = route.split("/").filter(Boolean);
    if (own.length !== parts.length) return false;
    return own.every((seg, i) => {
      if (seg === parts[i]) return true;
      if (!/^\[.+\]$/.test(seg)) return false;
      // /[sport] is dynamic on disk but closed in code: anything but a known slug is a 404.
      return seg === "[sport]" ? SPORT_SLUGS.has(parts[i]) : true;
    });
  });
}

const LANGS: Lang[] = ["pt", "en"];

/** Every claim on the marketing pages, flattened: the text that is read and the link it offers. */
function claims(lang: Lang): { where: string; text: string; href?: string }[] {
  const c = landingCopy(lang);
  const out: { where: string; text: string; href?: string }[] = [
    { where: "hero", text: [c.heroTitle.join(" "), c.heroSub, c.heroCtaSub, c.heroProof].join(" ") },
    { where: "ladder", text: [c.ladderTitle, c.ladderSub, c.ladderFootnote].join(" ") },
    ...c.honestyPoints.map((p) => ({ where: "honesty", text: `${p.title} ${p.body}` })),
    ...c.edges.map((e) => ({ where: "edge", text: `${e.title} ${e.body}`, href: e.href })),
    ...c.daily.map((d) => ({ where: "daily", text: `${d.title} ${d.body} ${d.cta}`, href: d.href })),
    ...c.howSteps.map((s) => ({ where: "how", text: `${s.title} ${s.body}` })),
    ...c.sports.map((s) => ({ where: "sports", text: `${s.hook} ${s.detail} ${s.markets}` })),
    { where: "pricing", text: [c.pricingSub, c.pricingCoinsSub].join(" ") },
    ...c.faq.map((f) => ({ where: "faq", text: `${f.q} ${f.a}` })),
    { where: "final", text: `${c.finalTitle} ${c.finalSub}` },
    ...PLANS.flatMap((p) => p.highlights[lang].map((h) => ({ where: `plan:${p.id}`, text: h }))),
    // The day's short list is inside the app, but it is still copy a reader acts on: the same
    // advertising rules apply to it, so it is scanned with the landing.
    ...TODAY_KEYS.map((key) => ({ where: `today:${key}`, text: translate(key, lang) })),
  ];
  for (const s of SPORT_LANDINGS) {
    out.push({ where: `${s.slug[lang]}:hero`, text: `${s.title[lang]} ${s.sub[lang]} ${s.meta[lang]}` });
    out.push(...s.angle[lang].map((a) => ({ where: `${s.slug[lang]}:angle`, text: `${a.title} ${a.body}` })));
    out.push(...s.stack[lang].map((i) => ({ where: `${s.slug[lang]}:stack`, text: `${i.title} ${i.body} ${i.cta}`, href: i.href })));
  }
  return out;
}

describe("marketing copy points at things that exist", () => {
  it("finds the routes it is meant to find", () => {
    // A guard on the guard: if the walk ever returns nothing, every href below would pass.
    expect(ROUTES.has("/")).toBe(true);
    expect(ROUTES.has("/prova")).toBe(true);
    expect(ROUTES.has("/app/bankroll")).toBe(true);
    // The short list is a real route the copy and the rail both point at.
    expect(ROUTES.has("/app/hoje")).toBe(true);
    expect(routeExists("/planos?lang=en")).toBe(true);
    expect(routeExists("/nao-existe")).toBe(false);
  });

  it.each(LANGS)("links only to routes the app serves (%s)", (lang) => {
    const broken = claims(lang).filter((c) => c.href && !routeExists(c.href));
    expect(broken.map((c) => `${c.where} → ${c.href}`)).toEqual([]);
  });

  it("keeps both sport funnels on the same slugs the copy links to", () => {
    for (const s of SPORT_LANDINGS) {
      expect(routeExists(`/${s.slug.pt}`)).toBe(true);
      expect(routeExists(`/${s.slug.en}`)).toBe(true);
    }
  });
});

/**
 * The round-3 features. A funnel that sells the product as it was two releases ago is the failure
 * this catches: every sport page has to carry all of them, in both languages.
 */
const FEATURES: { name: string; pt: RegExp; en: RegExp }[] = [
  { name: "lineup/injury watch", pt: /escalaç|lesão|lesões/i, en: /lineup|injury/i },
  { name: "two alternatives", pt: /alternativa/i, en: /alternative|backup/i },
  { name: "slip screenshot", pt: /print/i, en: /screenshot|snap your slip/i },
  { name: "tipster audit", pt: /tipster/i, en: /tipster/i },
  { name: "closing line value", pt: /fechamento|CLV/i, en: /clos(e|ing)|CLV/i },
  { name: "live mode", pt: /ao vivo|jogo rolando|bola rolando/i, en: /live|while the (game|match) runs/i },
  { name: "player deep dive", pt: /raio-x do jogador/i, en: /player deep dive/i },
  { name: "featured games", pt: /destaques do dia/i, en: /featured (games|matches)/i },
];

describe("the sport funnels sell the product that exists today", () => {
  for (const s of SPORT_LANDINGS) {
    for (const lang of LANGS) {
      it(`/${s.slug[lang]} carries every round-3 angle`, () => {
        const text = claims(lang).filter((c) => c.where.startsWith(`${s.slug[lang]}:`)).map((c) => c.text).join(" ");
        const missing = FEATURES.filter((f) => !f[lang].test(text)).map((f) => f.name);
        expect(missing).toEqual([]);
      });
    }
  }

  it.each(LANGS)("the home names the two things that run on their own (%s)", (lang) => {
    const home = claims(lang).filter((c) => c.where === "daily").map((c) => c.text).join(" ");
    expect(home).toMatch(lang === "pt" ? /destaques do dia/i : /featured games/i);
    expect(home).toMatch(/CLV/);
  });
});

describe("Brazilian betting-advertising rules", () => {
  // Lei 14.790/2023 art. 24 and the CONAR annex: no promise of profit or income, no urgency.
  const PROMISE = [
    /lucro\s+(garantid|cert|f[áa]cil|assegurad)/i,
    /renda\s+(garantid|extra|passiva|mensal)/i,
    /ganhos?\s+garantid/i,
    /garantimos?\s+(lucro|ganho|retorno|renda)/i,
    /retorno\s+garantid/i,
    /guaranteed\s+(profit|income|returns?|wins?)/i,
    /risk[-\s]?free\s+(bet|money|profit)/i,
    /dinheiro\s+f[áa]cil|easy money/i,
  ];
  const URGENCY = [
    /últim[ao]s?\s+(vagas|horas|minutos|chance)/i,
    /só\s+hoje|apenas\s+hoje|agora\s+ou\s+nunca|corre\s+que\s+acaba/i,
    /oferta\s+(acaba|expira|termina)/i,
    /last\s+chance|ends\s+(tonight|today|in)|hurry|act\s+now|limited\s+spots/i,
    /contagem\s+regressiva|countdown/i,
  ];

  it.each(LANGS)("promises nothing and hurries nobody (%s)", (lang) => {
    const offenders = claims(lang).filter((c) => [...PROMISE, ...URGENCY].some((re) => re.test(c.text)));
    expect(offenders.map((c) => `${c.where}: ${c.text}`)).toEqual([]);
  });

  it("puts the real chance next to every multiplier on the ladder", () => {
    for (const rung of LADDER) {
      const chance = impliedProbability(rung.decimal);
      expect(chance).toBeGreaterThan(0);
      expect(chance).toBeLessThan(1);
    }
    // The longest rung is the one a reader is most likely to misread: it has to be the smallest chance.
    const longest = LADDER[LADDER.length - 1];
    expect(impliedProbability(longest.decimal)).toBeLessThan(0.01);
    for (const lang of LANGS) expect(landingCopy(lang).ladderChance).toBeTruthy();
  });

  it("keeps the 18+ notice and the helpline in the footer of every public page", () => {
    const shell = readFileSync(join(SRC, "components/MarketingShell.tsx"), "utf8");
    expect(shell).toMatch(/menores de 18 anos/);
    expect(shell).toMatch(/18\+/);
    expect(shell).toMatch(/CVV 188/);
    // The footer renders both disclaimers, not just the legal note.
    expect(shell).toMatch(/\{c\.responsible\}/);
  });
});
