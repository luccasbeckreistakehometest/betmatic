import fs from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { envValue } from "@/lib/env";
import { AiBudgetExceededError, recordAiSpend } from "@/lib/server/ai-budget";

/** Judgement work: the synthesis brief. */
export const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-opus-5";
/** Bulk extraction from structured captures — mechanical, and ~60% cheaper per token. */
export const EXTRACTION_MODEL = process.env.ANTHROPIC_EXTRACTION_MODEL ?? "claude-sonnet-5";
/** Mechanical passes: short write-ups, parsing typed legs, reading a slip print. Has vision. */
export const CHEAP_MODEL = envValue("ANTHROPIC_CHEAP_MODEL") || "claude-haiku-4-5";
/** The in-play read: faster and cheaper than the judgement model, still good at numbers. */
export const LIVE_MODEL = envValue("ANTHROPIC_LIVE_MODEL") || "claude-sonnet-5";

/** Haiku 4.5 rejects adaptive thinking; it runs without a thinking block here. */
export const supportsAdaptiveThinking = (model: string): boolean => !/haiku/i.test(model);

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

let client: Anthropic | null = null;

export function aiConfigured(): boolean {
  if (aiMockActive()) return true;
  const key = envValue("ANTHROPIC_API_KEY") || envValue("ANTHROPIC_AUTH_TOKEN");
  // The .env.local.example placeholder would otherwise read as configured and fail with a 401.
  return key.length > 20 && !key.includes("...");
}

export function getClient(): Anthropic {
  if (!client) client = new Anthropic();
  return client;
}

export class AiNotConfiguredError extends Error {
  constructor() {
    super("ANTHROPIC_API_KEY is not set — add it to .env.local to enable AI extraction.");
    this.name = "AiNotConfiguredError";
  }
}

/**
 * Turns SDK errors into something a dashboard panel can show. Keys get revoked and rate limits get
 * hit in normal use — a raw 401 JSON blob in the UI helps nobody.
 */
export function describeAiError(error: unknown): string | null {
  if (error instanceof AiNotConfiguredError) return error.message;
  if (error instanceof AiBudgetExceededError) return error.message;

  // Check the message before the subclass: this arrives as a plain 400 through the streaming
  // helper, so an `instanceof BadRequestError` test misses it.
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (/credit balance is too low/i.test(message)) {
    return "The Anthropic account has no credit left. Top it up at console.anthropic.com → Billing — the key itself is valid.";
  }
  if (/rate.?limit/i.test(message) && !(error instanceof Anthropic.RateLimitError)) {
    return "Rate limited by the Anthropic API. Wait a moment and retry.";
  }

  if (error instanceof Anthropic.AuthenticationError) {
    return "Anthropic rejected the API key (401). Replace ANTHROPIC_API_KEY in .env.local with a valid key from console.anthropic.com, then restart the dev server.";
  }
  if (error instanceof Anthropic.PermissionDeniedError) {
    return "The API key is valid but not allowed to use this model. Check the key's workspace permissions.";
  }
  if (error instanceof Anthropic.RateLimitError) {
    return "Rate limited by the Anthropic API. Wait a moment and hit refresh.";
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return "Could not reach the Anthropic API. Check the network and retry.";
  }
  // Least specific last: APIError carries the status for everything not matched above.
  if (error instanceof Anthropic.APIError) {
    return `Anthropic API error ${error.status ?? "?"}: ${error.message}`;
  }
  return null;
}

// List pricing, USD per million tokens.
const PRICING: Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }> = {
  "claude-opus-5": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  "claude-sonnet-5": { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  "claude-haiku-4-5": { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
};

export interface UsageRecord {
  label: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
}

/** Every model call reports what it cost, so tuning is based on measurements rather than guesses. */
export function recordUsage(label: string, usage: Anthropic.Usage | undefined, model = MODEL): UsageRecord {
  const price = PRICING[model] ?? PRICING["claude-opus-5"];
  const input = usage?.input_tokens ?? 0;
  const output = usage?.output_tokens ?? 0;
  const cacheRead = usage?.cache_read_input_tokens ?? 0;
  const cacheWrite = usage?.cache_creation_input_tokens ?? 0;
  const costUsd =
    (input * price.input + output * price.output + cacheRead * price.cacheRead + cacheWrite * price.cacheWrite) /
    1_000_000;

  const record = { label: `${label} (${model})`, inputTokens: input, outputTokens: output, cacheReadTokens: cacheRead, cacheWriteTokens: cacheWrite, costUsd };
  console.log(
    `[ai] ${label.padEnd(22)} in=${input} out=${output} cacheRead=${cacheRead} → $${costUsd.toFixed(4)}`,
  );
  // The spend ceiling reads these rows; a failed write must not lose the model's answer.
  try {
    recordAiSpend({ label, model, inputTokens: input + cacheRead + cacheWrite, outputTokens: output, costUsd });
  } catch (error) {
    console.warn("[ai] could not record spend:", error instanceof Error ? error.message : error);
  }
  return record;
}
