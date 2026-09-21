import fs from "node:fs";
import path from "node:path";
import { envValue } from "@/lib/env";
import { aiProviderName, type ProviderName, type ProviderUsage } from "@/lib/ai/provider";
import { getProvider } from "@/lib/ai/providers";
import { AiBudgetExceededError, recordAiSpend } from "@/lib/server/ai-budget";

export { supportsAdaptiveThinking } from "@/lib/ai/providers/anthropic";
export { aiProviderName } from "@/lib/ai/provider";

export interface AiModels {
  /** Judgement work: the synthesis brief and the ticket builder. */
  judgement: string;
  /** Bulk extraction from structured captures — mechanical, and cheaper per token. */
  extraction: string;
  /** Mechanical passes: short write-ups, parsing typed legs, reading a slip print. Has vision. */
  cheap: string;
  /** The in-play read: faster and cheaper than the judgement model, still good at numbers. */
  live: string;
}

/**
 * OpenAI defaults. Confirm against GET /v1/models when the key arrives — they were chosen from the
 * published lineup without an account to verify them, and the startup check shouts if one is wrong.
 * Everything but judgement sits on the cheap tier of the current generation, because a second
 * person with an admin login should not be able to run up a bill by clicking.
 */
export const OPENAI_DEFAULT_MODELS: AiModels = {
  judgement: "gpt-5.6-terra",
  extraction: "gpt-5.6-luna",
  cheap: "gpt-5.6-luna",
  live: "gpt-5.6-luna",
};

export const ANTHROPIC_DEFAULT_MODELS: AiModels = {
  judgement: "claude-opus-5",
  extraction: "claude-sonnet-5",
  cheap: "claude-haiku-4-5",
  live: "claude-sonnet-5",
};

/** Which four model ids this configuration runs on. Pure, so both providers are unit-tested. */
export function aiModels(env: Record<string, string | undefined> = process.env): AiModels {
  if (aiProviderName(env) === "openai") {
    return {
      judgement: envValue("OPENAI_MODEL", env) || OPENAI_DEFAULT_MODELS.judgement,
      extraction: envValue("OPENAI_EXTRACTION_MODEL", env) || OPENAI_DEFAULT_MODELS.extraction,
      cheap: envValue("OPENAI_CHEAP_MODEL", env) || OPENAI_DEFAULT_MODELS.cheap,
      live: envValue("OPENAI_LIVE_MODEL", env) || OPENAI_DEFAULT_MODELS.live,
    };
  }
  return {
    judgement: env.ANTHROPIC_MODEL ?? ANTHROPIC_DEFAULT_MODELS.judgement,
    extraction: env.ANTHROPIC_EXTRACTION_MODEL ?? ANTHROPIC_DEFAULT_MODELS.extraction,
    cheap: envValue("ANTHROPIC_CHEAP_MODEL", env) || ANTHROPIC_DEFAULT_MODELS.cheap,
    live: envValue("ANTHROPIC_LIVE_MODEL", env) || ANTHROPIC_DEFAULT_MODELS.live,
  };
}

const MODELS = aiModels();

export const MODEL = MODELS.judgement;
export const EXTRACTION_MODEL = MODELS.extraction;
export const CHEAP_MODEL = MODELS.cheap;
export const LIVE_MODEL = MODELS.live;

/**
 * Test mode. AI_MOCK=1 answers every model call with the caller's deterministic fixture;
 * AI_MOCK=switch does the same only while DATA_DIR/ai-mock.on exists, so one test server can run
 * specs with and without AI. Refused in production (lib/env.ts).
 */
export function aiMockActive(env: Record<string, string | undefined> = process.env): boolean {
  if (env.AI_MOCK === "1") return true;
  if (env.AI_MOCK !== "switch") return false;
  const dir = env.DATA_DIR ?? path.join(process.cwd(), "data");
  return fs.existsSync(path.join(dir, "ai-mock.on"));
}

export function aiConfigured(): boolean {
  if (aiMockActive()) return true;
  return getProvider().configured();
}

export class AiNotConfiguredError extends Error {
  constructor(provider: ProviderName = aiProviderName()) {
    super(
      provider === "openai"
        ? "OPENAI_API_KEY is not set — add it to .env to enable AI generation."
        : "ANTHROPIC_API_KEY is not set — add it to .env.local to enable AI extraction.",
    );
    this.name = "AiNotConfiguredError";
  }
}

/**
 * Turns SDK errors into something a dashboard panel can show. Keys get revoked and rate limits get
 * hit in normal use — a raw 401 JSON blob in the UI helps nobody. The provider in use maps its own
 * errors; neither mapping ever echoes the key.
 */
export function describeAiError(error: unknown): string | null {
  if (error instanceof AiNotConfiguredError) return error.message;
  if (error instanceof AiBudgetExceededError) return error.message;
  return getProvider().describeError(error);
}

export interface ModelPrice { input: number; output: number; cacheRead: number; cacheWrite: number }

/**
 * List pricing, USD per million tokens.
 *
 * Anthropic: console.anthropic.com pricing page, as measured in this repo since 2026-09-10.
 * OpenAI: developers.openai.com/api/docs/pricing, read 2026-09-21 — gpt-6-astra 10/1/50,
 * gpt-5.6-sol 4/0.40/20, gpt-5.6-terra 2/0.20/12, gpt-5.6-luna 0.20/0.02/1.20, gpt-5-mini
 * 0.25/0.025/2, gpt-5-nano 0.05/0.005/0.40 (input / cached input / output).
 *
 * OpenAI bills a cache *write* at the plain input rate and reports those tokens inside
 * `input_tokens`, so `cacheWrite` mirrors `input` and the provider reports no separate write count.
 */
const PRICING: Record<string, ModelPrice> = {
  "claude-opus-5": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  "claude-sonnet-5": { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  "claude-haiku-4-5": { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
  "gpt-6-astra": { input: 10, output: 50, cacheRead: 1, cacheWrite: 10 },
  "gpt-5.6-sol": { input: 4, output: 20, cacheRead: 0.4, cacheWrite: 4 },
  "gpt-5.6-terra": { input: 2, output: 12, cacheRead: 0.2, cacheWrite: 2 },
  "gpt-5.6-luna": { input: 0.2, output: 1.2, cacheRead: 0.02, cacheWrite: 0.2 },
  "gpt-5-mini": { input: 0.25, output: 2, cacheRead: 0.025, cacheWrite: 0.25 },
  "gpt-5-nano": { input: 0.05, output: 0.4, cacheRead: 0.005, cacheWrite: 0.05 },
};

/**
 * An unknown model is priced as the most expensive one its provider sells. The daily ceiling then
 * over-estimates rather than under-estimates, which is the only safe direction for a kill switch.
 */
export function priceOf(model: string, provider: ProviderName = aiProviderName()): ModelPrice {
  return PRICING[model] ?? PRICING[provider === "openai" ? "gpt-6-astra" : "claude-opus-5"];
}

export interface UsageRecord {
  label: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
}

/** What one call cost, from token counts a provider already normalised. Pure, so it is unit-tested. */
export function usageCostUsd(usage: ProviderUsage, price: ModelPrice): number {
  return (
    usage.inputTokens * price.input +
    usage.outputTokens * price.output +
    usage.cacheReadTokens * price.cacheRead +
    usage.cacheWriteTokens * price.cacheWrite
  ) / 1_000_000;
}

export const ZERO_USAGE: ProviderUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };

/** Every model call reports what it cost, so tuning is based on measurements rather than guesses. */
export function recordUsage(label: string, usage: ProviderUsage | undefined, model = MODEL): UsageRecord {
  const tokens = usage ?? ZERO_USAGE;
  const costUsd = usageCostUsd(tokens, priceOf(model));

  const record = { label: `${label} (${model})`, ...tokens, costUsd };
  console.log(
    `[ai] ${label.padEnd(22)} in=${tokens.inputTokens} out=${tokens.outputTokens} cacheRead=${tokens.cacheReadTokens} → $${costUsd.toFixed(4)}`,
  );
  // The spend ceiling reads these rows; a failed write must not lose the model's answer.
  try {
    recordAiSpend({
      label,
      model,
      inputTokens: tokens.inputTokens + tokens.cacheReadTokens + tokens.cacheWriteTokens,
      outputTokens: tokens.outputTokens,
      costUsd,
    });
  } catch (error) {
    console.warn("[ai] could not record spend:", error instanceof Error ? error.message : error);
  }
  return record;
}
