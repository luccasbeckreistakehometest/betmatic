import type { z } from "zod";
import { envValue } from "@/lib/env";

/**
 * The seam between the app and whoever runs the model. Every feature keeps calling
 * `generateStructuredWithUsage`; only this interface knows whether the answer came from Anthropic
 * or from OpenAI. `AI_PROVIDER` picks one, and the default keeps the Anthropic behaviour the app
 * shipped with.
 */
export type ProviderName = "anthropic" | "openai";

export interface ProviderImage {
  /** Base64 without the data: prefix. */
  data: string;
  mediaType: "image/jpeg" | "image/png" | "image/webp";
}

export interface ProviderRequest {
  model: string;
  system: string;
  prompt: string;
  schema: z.ZodType;
  /** Model-visible name of the strict JSON schema; OpenAI requires one, Anthropic ignores it. */
  schemaName: string;
  maxTokens: number;
  images?: ProviderImage[];
  /** Mark the system prompt cacheable. Anthropic needs the hint; OpenAI caches long prefixes itself. */
  cacheSystem?: boolean;
  /** How hard the model may think on this call; a mechanical pass (localisation) asks for `low`. Anthropic only. */
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
}

/**
 * Token counts in one shape, whatever the provider reports. `inputTokens` is always the part that
 * is billed at the full input rate — the cached part is `cacheReadTokens` and never counted twice.
 */
export interface ProviderUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

/** Why the model stopped. Anything not listed reads as a clean finish. */
export type ProviderStop = "end" | "max_tokens" | "refusal";

export interface ProviderResponse {
  /** The structured answer as raw JSON text. */
  text: string;
  /** The provider's own parsed answer when it gives one; the caller still validates the schema. */
  parsed: unknown;
  stop: ProviderStop;
  /** What the provider said about a refusal. Never carries the key. */
  refusal: string | null;
  usage: ProviderUsage;
}

export interface AiProvider {
  readonly name: ProviderName;
  /** Long structured generations: briefs, ticket slates, write-ups. */
  generate(request: ProviderRequest): Promise<ProviderResponse>;
  /** One-shot structured read of a scraped page capture. */
  parse(request: ProviderRequest): Promise<ProviderResponse>;
  /** A key that is present and is not the placeholder from .env.example. */
  configured(): boolean;
  /** Operator-facing message for a known failure, or null. Must never contain the key. */
  describeError(error: unknown): string | null;
  /** Model ids this account may use, for the startup check. null = the question could not be asked. */
  listModels(): Promise<string[] | null>;
}

/** `anthropic` unless the env says otherwise, so nothing changes until someone flips it. */
export function aiProviderName(env: Record<string, string | undefined> = process.env): ProviderName {
  return envValue("AI_PROVIDER", env).toLowerCase() === "openai" ? "openai" : "anthropic";
}

/**
 * A key can end up inside an error message from a proxy or a mis-set base URL. Nothing this
 * function has touched is safe to print without it.
 */
export function redactKeys(text: string): string {
  return text
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, "sk-***")
    .replace(/\b[A-Za-z0-9_-]{0,12}(?:ant|proj)-[A-Za-z0-9_-]{16,}/g, "***");
}
