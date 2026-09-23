import { readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { NAV_GROUPS, NAV_ITEMS, RAIL_GROUPS, hrefFor } from "@/lib/nav";
import { ACTION_COST } from "@/lib/plans";
import { PLAYER_FREE_PER_DAY } from "@/lib/server/player-access";
import { t, type Lang } from "@/lib/i18n";

/**
 * The menu is a promise: it says the product's doors are all here, each with what it is for and
 * what it costs. These tests keep that promise mechanical — a page added under /app and left out of
 * the list fails here, and a price written on a row has to be the price the code charges.
 */
const APP = join(fileURLToPath(new URL("../..", import.meta.url)), "app");

function routes(dir = APP, prefix = ""): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (!statSync(full).isDirectory()) {
      if (entry === "page.tsx") found.push(prefix || "/");
      continue;
    }
    if (entry.startsWith("_") || entry === "api") continue;
    found.push(...routes(full, entry.startsWith("(") ? prefix : `${prefix}/${entry}`));
  }
  return found;
}

const ROUTES = new Set(routes());
const LANGS: Lang[] = ["pt", "en"];

/**
 * The pages under /app that are a detail of something else: you arrive on them from a game on the
 * slate or a player's name on a leg, never from a list of destinations. They have no row, and the
 * menu names the feature they carry under "inside the screens" instead.
 */
const REACHED_FROM_INSIDE = new Set(["/app/game/[gameId]", "/app/player/[athleteId]"]);

describe("the nav model", () => {
  it("finds the routes it is meant to find", () => {
    expect(ROUTES.has("/app")).toBe(true);
    expect(ROUTES.has("/app/hoje")).toBe(true);
  });

  it("points every row at a page that exists, in both languages", () => {
    for (const item of NAV_ITEMS) {
      for (const lang of LANGS) {
        expect(ROUTES.has(hrefFor(item, lang)), `${item.key} → ${hrefFor(item, lang)}`).toBe(true);
      }
    }
  });

  it("names every page under /app, or says it is reached from inside one", () => {
    const named = new Set(NAV_ITEMS.flatMap((i) => LANGS.map((l) => hrefFor(i, l))));
    const orphans = [...ROUTES].filter((r) => r.startsWith("/app") && !named.has(r) && !REACHED_FROM_INSIDE.has(r));
    expect(orphans).toEqual([]);
  });

  it("gives every row a label and one line saying what it is for", () => {
    for (const item of NAV_ITEMS) {
      for (const lang of LANGS) {
        expect(t(item.key, lang).trim().length, `${item.key} label (${lang})`).toBeGreaterThan(0);
        expect(item.note[lang].trim().length, `${item.key} note (${lang})`).toBeGreaterThan(0);
        // A note is a line, not a paragraph: it has to fit a row on a phone.
        expect(item.note[lang].length, `${item.key} note (${lang})`).toBeLessThanOrEqual(90);
      }
    }
  });

  it("opens each door once", () => {
    const hrefs = NAV_ITEMS.map((i) => i.href);
    expect(hrefs).toEqual([...new Set(hrefs)]);
  });

  it("tells a feature with no page where it lives", () => {
    const hints = NAV_GROUPS.flatMap((g) => g.hints ?? []);
    expect(hints.length).toBeGreaterThan(0);
    for (const hint of hints) {
      for (const lang of LANGS) {
        expect(hint.label[lang].trim().length).toBeGreaterThan(0);
        expect(hint.note[lang].trim().length).toBeGreaterThan(0);
        expect(hint.where[lang].trim().length).toBeGreaterThan(0);
      }
    }
    const ids = hints.map((h) => h.id);
    expect(ids).toEqual([...new Set(ids)]);
  });

  it("says what the reader comes to each room to do", () => {
    for (const group of NAV_GROUPS) {
      for (const lang of LANGS) {
        expect(group.label[lang].trim().length).toBeGreaterThan(0);
        expect(group.intent[lang].trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("keeps the rail a subset of the menu, in the menu's own order", () => {
    const menuOrder = NAV_ITEMS.map((i) => i.href);
    const railOrder = RAIL_GROUPS.flatMap((g) => g.items.map((i) => i.href));
    expect(railOrder.length).toBeLessThan(menuOrder.length);
    expect(menuOrder.filter((h) => railOrder.includes(h))).toEqual(railOrder);
    // The rail never carries a door the menu does not, and never carries the admin one.
    expect(railOrder.every((h) => menuOrder.includes(h))).toBe(true);
    expect(railOrder).not.toContain("/admin");
  });

  it("prices a row at what the code charges for it", () => {
    const gateOf = (href: string) => NAV_ITEMS.find((i) => i.href === href)?.gate;
    expect(gateOf("/app/slip")?.pt).toBe(`${ACTION_COST.analyse_slip} coins`);
    expect(gateOf("/app/parlays/custom")?.pt).toBe(`${ACTION_COST.custom_parlay} coins`);
    // The two doors a plan opens rather than coins.
    expect(gateOf("/app/parlays")?.pt).toBe("Pro");
    expect(gateOf("/app")?.pt).toMatch(/1 jogo por dia/);
    // The player deep dive has no page of its own; its allowance is on the hint.
    const player = NAV_GROUPS.flatMap((g) => g.hints ?? []).find((h) => h.id === "player");
    expect(player?.gate?.pt).toBe(`${PLAYER_FREE_PER_DAY} por dia no grátis`);
  });

  it("writes a gate in both languages or in neither", () => {
    for (const item of NAV_ITEMS) {
      if (!item.gate) continue;
      for (const lang of LANGS) expect(item.gate[lang].trim().length, `${item.key} gate (${lang})`).toBeGreaterThan(0);
    }
  });
});
