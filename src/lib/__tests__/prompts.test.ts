import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const DIR = path.join(process.cwd(), "data", "unit-prompts");
process.env.DATA_DIR = DIR; process.env.AUTH_SECRET = "test-secret-that-is-long-enough";
fs.rmSync(DIR, { recursive: true, force: true });

const { getPrompt, savePrompt, revertPrompt, resetToDefault, applyFeedback, listPromptVersions } = await import("@/lib/server/prompts");
const { DEFAULT_PROMPTS } = await import("@/lib/bets/prompt-defaults");

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
