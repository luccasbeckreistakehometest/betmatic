import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

const DIR = path.join(process.cwd(), "data", "unit-ai-auto-adjust");
process.env.DATA_DIR = DIR; process.env.AUTH_SECRET = "test-secret-that-is-long-enough";
process.env.AI_PROVIDER = "anthropic"; process.env.ANTHROPIC_API_KEY = "sk-ant-unit-test-key-0123456789abcdef";
delete process.env.AI_MOCK;
fs.rmSync(DIR, { recursive: true, force: true });

const efforts: string[] = [];
vi.mock("@/lib/ai/providers", () => ({
  getProvider: () => ({
    name: "anthropic",
    configured: () => true,
    generate: async (req: { effort?: string }) => {
      efforts.push(req.effort ?? "?");
      const usage = { inputTokens: 100, outputTokens: 48000, cacheReadTokens: 0, cacheWriteTokens: 0 };
      // The first two attempts are cut by the cap — the model thought the budget away.
      if (efforts.length < 3) return { text: "", parsed: null, stop: "max_tokens", refusal: null, usage };
      return { text: JSON.stringify({ ok: true }), parsed: null, stop: "end", refusal: null, usage: { ...usage, outputTokens: 900 } };
    },
    parse: async () => { throw new Error("not used"); },
  }),
}));

const { generateStructured } = await import("@/lib/ai/extract");

// A live read cut at 48k on 22/09/2026 ("Output hit the 48000-token cap") was simply lost. The read
// now lowers its thinking and tries again, twice at most, before giving up.
describe("the auto-adjust ladder", () => {
  it("retries a truncated read with less thinking until it fits", async () => {
    const out = await generateStructured({ schema: z.object({ ok: z.boolean() }), system: "s", prompt: "p", effort: "high", label: "unit" });
    expect(out).toEqual({ ok: true });
    expect(efforts).toEqual(["high", "medium", "low"]);
  });
  it("gives up after the ladder is exhausted, naming the cap", async () => {
    efforts.length = 0;
    // Force every attempt to be cut: three cuts in a row from "medium" leaves only one rung below.
    const provider = (await import("@/lib/ai/providers")).getProvider();
    const original = provider.generate;
    provider.generate = async (req: { effort?: string }) => { efforts.push(req.effort ?? "?"); return { text: "", parsed: null, stop: "max_tokens", refusal: null, usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 } }; };
    await expect(generateStructured({ schema: z.object({ ok: z.boolean() }), system: "s", prompt: "p", effort: "medium", label: "unit2" })).rejects.toThrow(/token cap/);
    expect(efforts).toEqual(["medium", "low"]);
    provider.generate = original;
  });
});
