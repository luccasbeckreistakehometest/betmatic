import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TODAY_KEYS } from "./marketing-claims.test";
import { t as translate, type Lang } from "@/lib/i18n";

/**
 * The words on "Os bilhetes de hoje". The screen is the one place in the product where a reader is
 * told to put money on something, so its copy is held to the advertising rules the landing is held
 * to (Lei 14.790/2023, CONAR annex X) and to the design system's own rule that a multiplier never
 * appears without its chance.
 */
const SRC = fileURLToPath(new URL("../..", import.meta.url));
const LANGS: Lang[] = ["pt", "en"];
const text = (lang: Lang) => TODAY_KEYS.map((k) => translate(k, lang));

describe("both languages are written, not translated at render time", () => {
  it.each(LANGS)("has every key in %s", (lang) => {
    const missing = TODAY_KEYS.filter((k) => !translate(k, lang)?.trim());
    expect(missing).toEqual([]);
  });

  it("never ships the Portuguese string as the English one", () => {
    const same = TODAY_KEYS.filter((k) => translate(k, "pt") === translate(k, "en") && translate(k, "pt").length > 12);
    expect(same).toEqual([]);
  });

  it("keeps every placeholder in both languages", () => {
    for (const key of TODAY_KEYS) {
      const pt = [...translate(key, "pt").matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
      const en = [...translate(key, "en").matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
      expect({ key, en }).toEqual({ key, en: pt });
    }
  });
});

describe("what the screen may never say", () => {
  const BANNED: [string, RegExp][] = [
    ["projected profit", /lucro (projetado|previsto|estimado)|projected profit/i],
    ["income", /\brenda\b|\bincome\b/i],
    ["a method", /\bmétodo\b|\bmetodo\b/i],
    ["a guaranteed bankroll", /banca garantida|guaranteed bankroll/i],
    ["a countdown", /contagem regressiva|countdown/i],
    ["a deadline on the pitch", /só até|last chance|última chance/i],
    ["ROI without its sample", /\bROI\b/i],
  ];

  it.each(LANGS)("says none of the forbidden things (%s)", (lang) => {
    const offenders = text(lang).flatMap((line) => BANNED.filter(([, re]) => re.test(line)).map(([name]) => `${name}: ${line}`));
    expect(offenders).toEqual([]);
  });

  it.each(LANGS)("never prints a bare multiplier — prices go through <Odds> (%s)", (lang) => {
    // A literal "5x" in a sentence is a multiplier without its chance beside it (docs/DESIGN.md §13).
    expect(text(lang).filter((line) => /\d+(?:[.,]\d+)?\s*x\b/.test(line))).toEqual([]);
  });

  it("puts the chance next to the price in the component, not in the copy", () => {
    const card = readFileSync(join(SRC, "components/TodayCard.tsx"), "utf8");
    expect(card).toMatch(/<Odds\s+decimal=/);
    expect(card).toMatch(/probability=/);
  });
});

describe("the four things a card says, and the door to everything else", () => {
  const card = readFileSync(join(SRC, "components/TodayCard.tsx"), "utf8");
  const board = readFileSync(join(SRC, "components/TodayBoard.tsx"), "utf8");

  it("names the ticket, the unit, the chance and the next step", () => {
    for (const key of ["todayStake", "todayChance", "todayMinOdds", "todayRegister"]) expect(card).toContain(key);
  });

  it("keeps everything else behind one closed disclosure", () => {
    expect(card).toContain("<details");
    expect(card).toContain("todayWhy");
    // The legs, the evidence and the band did not disappear: they moved inside it.
    expect(card).toMatch(/d\.legs\.map/);
    expect(card).toMatch(/evidenceScore/);
  });

  it("always offers the full desk from the short list", () => {
    expect(board).toContain("todayAllTickets");
    expect(board).toMatch(/pathname: "\/app"/);
  });

  it("carries the responsible-gambling line and the helpline", () => {
    expect(translate("todayFooter", "pt")).toMatch(/18\+/);
    expect(translate("todayFooter", "pt")).toMatch(/CVV 188/);
    expect(board).toContain("todayFooter");
  });

  it("answers an empty day without offering a substitute", () => {
    expect(board).toContain("todayNoneTitle");
    expect(board).toContain("todayNoneBody");
    // Two ways out and nothing else: the generated tickets, and the method.
    expect(translate("todayNoneBody", "pt")).not.toMatch(/mas |porém|no entanto/i);
  });

  it("never states a stake without the unit and the share of bankroll together", () => {
    for (const lang of LANGS) {
      expect(translate("todayStake", lang)).toMatch(/\{u\}/);
      expect(translate("todayStake", lang)).toMatch(/\{pct\}/);
      expect(translate("todayStakeNoMoney", lang)).toMatch(/\{u\}/);
      expect(translate("todayStakeNoMoney", lang)).toMatch(/\{pct\}/);
    }
  });
});

describe("the measurement regime explains itself", () => {
  it.each(LANGS)("says the size is the minimum and names the sample (%s)", (lang) => {
    const line = translate("todayMeasuring", lang);
    expect(line).toMatch(/\{n\}/);
    expect(line).toMatch(/\{x\}/);
    expect(line).toMatch(lang === "pt" ? /0,25 u/ : /0\.25 u/);
  });
});
