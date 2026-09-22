import { describe, expect, it } from "vitest";
import { effortOf, supportsAdaptiveThinking } from "@/lib/ai/providers/anthropic";

// Opus 5 spent whole output budgets thinking about one slate (22/09/2026); the effort is bounded.
describe("bounded effort on Claude", () => {
  it("defaults to high and takes only the five levels the API knows", () => {
    expect(effortOf({})).toBe("high");
    expect(effortOf({ ANTHROPIC_EFFORT: "medium" })).toBe("medium");
    expect(effortOf({ ANTHROPIC_EFFORT: " MAX " })).toBe("max");
    expect(effortOf({ ANTHROPIC_EFFORT: "extreme" })).toBe("high");
  });
  it("never asks Haiku to think", () => {
    expect(supportsAdaptiveThinking("claude-haiku-4-5")).toBe(false);
    expect(supportsAdaptiveThinking("claude-opus-5")).toBe(true);
  });
});
