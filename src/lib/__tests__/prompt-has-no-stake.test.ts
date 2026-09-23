import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The compliance trip-wire of the whole policy: **code sizes the bet, the model never does.**
 *
 * Brazilian betting-advertising rules forbid a product from promising a result, and the honest way
 * to keep a language model out of that promise is to keep it out of the question. Every number
 * about how much to stake is computed in src/lib/bets/sizing.ts, from measured calibration, and no
 * prompt the model ever reads is allowed to mention stake, unit, bankroll or Kelly.
 *
 * If this test fails, something taught the model to size a bet. Do not relax it — move the number.
 */
const SRC = fileURLToPath(new URL("../..", import.meta.url));
const read = (rel: string) => readFileSync(join(SRC, rel), "utf8");

/** Words that would put the model inside the sizing decision. */
const STAKE_WORDS = /\bstake\b|\bstakes?\b|unidade|\bunit(s)? of bankroll\b|\bbanca\b|\bbankroll\b|\bkelly\b|aposte R\$|quanto apostar|how much to bet|size (of|your) (the )?bet/i;

/**
 * The strings every generation prompt is built from. A prompt assembled at runtime from a template
 * lives in these files, so reading them is reading what the model gets.
 */
const PROMPT_SOURCES = [
  "lib/bets/prompt-defaults.ts",
  "lib/ledger/calibrate.ts",
  "lib/ledger/learn.ts",
  "lib/ledger/factor-report.ts",
  "lib/server/live-read.ts",
];

/**
 * A line that FORBIDS the model from sizing is the separation working, not a breach of it:
 * "never recommend a stake size" belongs in the prompt. Anything else that names a stake does not.
 */
const PROHIBITION = /\b(never|no|not|nunca|não|do not|don't)\b[^.]{0,90}?(stake|unidade|banca|bankroll|kelly|how much)/i;

/** Every string literal's lines — the text the model can receive, not the code around it. */
function promptLines(source: string): string[] {
  return [...source.matchAll(/`(?:[^`\\]|\\.)*`|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g)]
    .flatMap((m) => m[0].split("\n"))
    .map((line) => line.trim())
    .filter(Boolean);
}

describe("the model is never told how much to bet", () => {
  it.each(PROMPT_SOURCES)("%s carries no stake language in any string it can send", (file) => {
    const offenders = promptLines(read(file)).filter((line) => STAKE_WORDS.test(line) && !PROHIBITION.test(line));
    expect(offenders).toEqual([]);
  });

  it("still requires the prompt to forbid it out loud", () => {
    expect(read("lib/bets/prompt-defaults.ts")).toMatch(/never recommend a stake size/i);
  });

  it("the assembled calibration prompt is clean, including its headings", async () => {
    const { calibrationPrompt } = await import("@/lib/ledger/calibrate");
    expect(STAKE_WORDS.test(calibrationPrompt())).toBe(false);
  });

  it("the factor lines handed to the prompt are clean", async () => {
    const { factorPromptLines } = await import("@/lib/ledger/factor-report");
    const line = factorPromptLines([{
      id: "pregame-main|stat|pra", scope: "pregame-main", dim: "stat", value: "pra", legs: 40, won: 16, games: 9, days: 4,
      hitRate: 0.4, predicted: 0.8, gap: 0.4, ciLow: 0.26, ciHigh: 0.56, pValue: 0.0001, qValue: 0.002, flagged: true,
    }]);
    expect(line).toContain("pregame-main|stat|pra");
    expect(STAKE_WORDS.test(line)).toBe(false);
  });

  it("keeps the sizing where it belongs: in code, with its own constants", async () => {
    const { SIZING } = await import("@/lib/bets/sizing");
    expect(SIZING.kellyFraction).toBe(0.25);
    expect(SIZING.unitPct).toBe(0.01);
    // And the game page's own reference number keeps its signature, untouched by the wallet.
    const { kellyFraction } = await import("@/lib/odds");
    expect(kellyFraction(2, 0.6)).toBeGreaterThan(0);
  });
});
