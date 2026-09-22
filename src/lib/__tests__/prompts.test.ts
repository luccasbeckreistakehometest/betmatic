import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const DIR = path.join(process.cwd(), "data", "unit-prompts");
process.env.DATA_DIR = DIR; process.env.AUTH_SECRET = "test-secret-that-is-long-enough";
fs.rmSync(DIR, { recursive: true, force: true });

const { getPrompt, savePrompt, revertPrompt, resetToDefault, applyFeedback, listPromptVersions } = await import("@/lib/server/prompts");
const { DEFAULT_PROMPTS } = await import("@/lib/bets/prompt-defaults");

describe("what the default prompt must keep saying", () => {
  // The owner's rule: a game must always offer a long ticket, reached honestly — more legs, or
  // fewer legs on a stretched line the player has actually hit.
  it("asks every game for a ticket of 30x or longer, by either route", () => {
    for (const lang of ["pt", "en"] as const) {
      expect(DEFAULT_PROMPTS.game[lang]).toContain("30x");
      expect(DEFAULT_PROMPTS.game[lang]).toMatch(/TWO WAYS TO REACH A LONG PRICE/);
      expect(DEFAULT_PROMPTS.game[lang]).toMatch(/every leg priced/);
    }
  });

  // Learned on 21/09/2026 from the first hand-built slate: five nested tickets sharing one cold
  // scorer (Ogunbowale, 0 points at the half) put four of the five in the same hole at once.
  it("forbids a nested slate and caps how much one leg can carry", () => {
    for (const lang of ["pt", "en"] as const) {
      expect(DEFAULT_PROMPTS.game[lang]).toMatch(/A SLATE IS NOT ONE BET IN FIVE SIZES/);
      expect(DEFAULT_PROMPTS.game[lang]).toMatch(/more than half of\s+the tickets/);
      expect(DEFAULT_PROMPTS.game[lang]).toMatch(/WEIGH HOW A LEG DIES/);
      expect(DEFAULT_PROMPTS.game[lang]).toMatch(/RECENCY WINS/);
      expect(DEFAULT_PROMPTS.game[lang]).toMatch(/STRETCH A LINE ONLY WHERE THE PLAYER HAS BEEN THERE/);
    }
  });

  // The per-leg cap was not enough: the same slate spread one player over two markets and put her
  // in five of nine tickets without any single leg breaking the rule. She scored 7. Count players.
  it("counts concentration by player, across markets, not by leg", () => {
    for (const lang of ["pt", "en"] as const) {
      expect(DEFAULT_PROMPTS.game[lang]).toMatch(/CONCENTRATION IS COUNTED BY PLAYER, NOT BY LEG/);
      expect(DEFAULT_PROMPTS.game[lang]).toMatch(/No single player may appear in more than half/);
    }
  });

  // Two tickets died on a 67%-measured under because the game finished 87-86 and nobody sat.
  it("ties an under to the projected margin", () => {
    for (const lang of ["pt", "en"] as const) {
      expect(DEFAULT_PROMPTS.game[lang]).toMatch(/AN UNDER IS A BET ON THE GAME ENDING/);
      expect(DEFAULT_PROMPTS.game[lang]).toMatch(/name what widens the margin/);
    }
  });

  // The live reads beat the pre-game slate by a distance on 21/09/2026 (84% of legs against 76%,
  // +425% against -15%), and the reasons are teachable: price the remainder, never buy a reversion.
  it("carries the live doctrine that the hand-built halftime reads proved", () => {
    for (const lang of ["pt", "en"] as const) {
      expect(DEFAULT_PROMPTS.game[lang]).toMatch(/PRICE THE REMAINDER, NOT THE NIGHT/);
      expect(DEFAULT_PROMPTS.game[lang]).toMatch(/DO NOT BET ON A REVERSION/);
      expect(DEFAULT_PROMPTS.game[lang]).toMatch(/CUT, DO NOT HOPE/);
      expect(DEFAULT_PROMPTS.game[lang]).toMatch(/REACH THE LONG BAND LIVE WITH FEWER LEGS/);
      // The owner's rule: in basketball a read is taken at EVERY quarter break, never only at half-time.
      expect(DEFAULT_PROMPTS.game[lang]).toMatch(/A READ IS TAKEN AT EVERY QUARTER BREAK/);
    }
  });
});

describe("the basketball decision procedure", () => {
  // Written after the 21/09/2026 slate: minutes first, then the computed probability of the exact
  // line, the ladder with numbers, correlation priced in code, and a live section on the remainder.
  it("runs minutes → role → environment → matchup → computed → price, in that order", () => {
    for (const lang of ["pt", "en"] as const) {
      const text = DEFAULT_PROMPTS.game[lang];
      expect(text).toMatch(/BASKETBALL DECISION PROCEDURE/);
      const order = ["MINUTES FIRST", "ROLE.", "ENVIRONMENT.", "MATCHUP.", "LINE VS COMPUTED", "PRICE."].map((k) => text.indexOf(k));
      expect(order.every((i) => i >= 0)).toBe(true);
      expect([...order].sort((a, b) => a - b)).toEqual(order);
    }
  });

  it("names what disqualifies a leg, asks for the ladder's numbers and prices correlation in code", () => {
    for (const lang of ["pt", "en"] as const) {
      const text = DEFAULT_PROMPTS.game[lang];
      expect(text).toMatch(/DISQUALIFIED OUTRIGHT/);
      expect(text).toMatch(/LISTED OUT/);
      expect(text).toMatch(/within 8 points of COMPUTED/);
      expect(text).toMatch(/THE LADDER HAS NUMBERS/);
      expect(text).toMatch(/computed\s+near 45% by rate and minutes/);
      expect(text).toMatch(/SAME-GAME CORRELATION IS PRICED IN CODE/);
      expect(text).toMatch(/COMPOSE THE SLATE ACROSS BANDS/);
      expect(text).toMatch(/LIVE, WITH THE REMAINDER PROJECTED/);
      expect(text).toMatch(/NEEDS A REVERSION/);
    }
    expect(DEFAULT_PROMPTS.slate.en).toMatch(/Anchor fairProbability to it within 8 points/);
  });

  it("keeps the Portuguese instruction at the end of the pt version", () => {
    expect(DEFAULT_PROMPTS.game.pt.startsWith(DEFAULT_PROMPTS.game.en)).toBe(true);
    expect(DEFAULT_PROMPTS.game.pt).toMatch(/Brazilian Portuguese/);
  });
});

describe("prompt versions", () => {
  it("serves the code default until someone changes it", () => {
    expect(getPrompt("game", "pt")).toBe(DEFAULT_PROMPTS.game.pt);
    expect(getPrompt("slate", "en")).toBe(DEFAULT_PROMPTS.slate.en);
  });

  it("feedback rewrites both languages in one batch and activates them", async () => {
    const seen: string[] = [];
    const out = await applyFeedback({ kind: "game", feedback: "no máximo 4 pernas", createdBy: "admin" }, async ({ current, feedback }) => {
      seen.push(feedback);
      return { pt: current.pt + "\n- No máximo 4 pernas por bilhete.", en: current.en + "\n- At most 4 legs per ticket.", rationale: "Acrescentei o limite de pernas." };
    });
    expect(seen).toEqual(["no máximo 4 pernas"]);
    expect(out.versions.map((v) => `${v.lang}v${v.version}`)).toEqual(["ptv1", "env1"]);
    expect(getPrompt("game", "pt")).toContain("No máximo 4 pernas");
    expect(getPrompt("game", "en")).toContain("At most 4 legs");
    expect(getPrompt("slate", "pt")).toBe(DEFAULT_PROMPTS.slate.pt); // other kind untouched
    expect(listPromptVersions("game").every((v) => v.batch === out.batch)).toBe(true);
  });

  it("refuses a rewrite that came back empty, leaving the active prompt alone", async () => {
    const before = getPrompt("game", "pt");
    await expect(applyFeedback({ kind: "game", feedback: "qualquer coisa", createdBy: "admin" }, async () => ({ pt: "", en: "", rationale: "" }))).rejects.toThrow(/curto/);
    expect(getPrompt("game", "pt")).toBe(before);
  });

  it("manual edits, reverts and reset all keep a linear history", () => {
    const manual = savePrompt({ kind: "game", lang: "pt", content: "x".repeat(300), source: "manual", createdBy: "admin" });
    expect(getPrompt("game", "pt")).toBe("x".repeat(300));
    const v1 = listPromptVersions("game").find((v) => v.lang === "pt" && v.version === 1)!;
    const reverted = revertPrompt(v1.id, "admin")!;
    expect(reverted.version).toBeGreaterThan(manual.version);
    expect(getPrompt("game", "pt")).toContain("No máximo 4 pernas");
    resetToDefault("game", "admin");
    expect(getPrompt("game", "pt")).toBe(DEFAULT_PROMPTS.game.pt);
    expect(listPromptVersions("game").filter((v) => v.active).map((v) => v.lang).sort()).toEqual(["en", "pt"]);
  });
});

describe("alternatives rule upgrade", async () => {
  const { upgradeAlternativesRule, ALTERNATIVES_RULE } = await import("@/lib/server/prompts");
  it("replaces the old isAlternative paragraph and leaves current prompts alone", () => {
    const old = "intro\n- ALWAYS pair each main ticket with at least one alternative, flagged with isAlternative, placed\n  immediately after it. blah rather than restating the same bet at a worse price.\nend";
    expect(upgradeAlternativesRule(old)).toBe(`intro\n${ALTERNATIVES_RULE}\nend`);
    expect(upgradeAlternativesRule("edited by hand: use isAlternative")).toContain(ALTERNATIVES_RULE);
    expect(upgradeAlternativesRule("already current")).toBeNull();
  });
});
