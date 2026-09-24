import { describe, expect, it } from "vitest";
import { DIFF_MAX_LINES, diffHunks, diffStats, lineDiff } from "@/lib/diff";

/**
 * The diff exists so an operator approves a text rather than a promise. Its job is to be readable
 * and complete: every changed line shown, and every stretch it leaves out announced as left out.
 */
describe("lineDiff", () => {
  it("marks only what changed and keeps the rest as context", () => {
    const out = lineDiff("a\nb\nc", "a\nB\nc");
    expect(out.map((l) => l.op)).toEqual(["same", "remove", "add", "same"]);
    expect(out.filter((l) => l.op === "add").map((l) => l.text)).toEqual(["B"]);
    expect(diffStats(out)).toEqual({ added: 1, removed: 1, same: 2 });
  });

  it("reports identical texts as no change at all", () => {
    const text = "regra 1\nregra 2\n";
    expect(diffStats(lineDiff(text, text))).toEqual({ added: 0, removed: 0, same: 3 });
    expect(diffHunks(lineDiff(text, text))).toEqual([]);
  });

  it("numbers lines on the side they belong to", () => {
    const out = lineDiff("a\nb", "a\nb\nc");
    const added = out.find((l) => l.op === "add")!;
    expect([added.before, added.after]).toEqual([null, 3]);
    const kept = out.find((l) => l.text === "a")!;
    expect([kept.before, kept.after]).toEqual([1, 1]);
  });

  it("an appended paragraph is an addition, not a rewrite of the whole prompt", () => {
    const before = Array.from({ length: 40 }, (_, i) => `linha ${i}`).join("\n");
    const out = lineDiff(before, `${before}\n\nREGRA NOVA`);
    expect(diffStats(out).removed).toBe(0);
    expect(diffStats(out).added).toBe(2);
  });
});

describe("diffHunks", () => {
  it("shows the changed region with its context and nothing else", () => {
    const before = Array.from({ length: 60 }, (_, i) => `linha ${i}`).join("\n");
    const after = before.replace("linha 30", "linha trinta");
    const hunks = diffHunks(lineDiff(before, after), 2);
    expect(hunks).toHaveLength(1);
    // two context lines each side, plus the removed and the added line
    expect(hunks[0]).toHaveLength(6);
    expect(hunks[0].map((l) => l.text)).toContain("linha trinta");
  });

  it("splits distant changes into separate hunks, so nothing is skipped in silence", () => {
    const before = Array.from({ length: 60 }, (_, i) => `linha ${i}`).join("\n");
    const after = before.replace("linha 5", "cinco").replace("linha 50", "cinquenta");
    expect(diffHunks(lineDiff(before, after), 2)).toHaveLength(2);
  });
});

describe("the guard against a pathological input", () => {
  it("falls back to a wholesale replacement instead of a quadratic table", () => {
    const huge = Array.from({ length: DIFF_MAX_LINES + 1 }, (_, i) => `l${i}`).join("\n");
    const out = lineDiff(huge, "uma linha só");
    expect(out.some((l) => l.op === "same")).toBe(false);
    expect(diffStats(out).added).toBe(1);
  });
});
