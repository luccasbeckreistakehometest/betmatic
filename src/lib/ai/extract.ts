import type { z } from "zod";
import { AiNotConfiguredError, EXTRACTION_MODEL, MODEL, ZERO_USAGE, aiConfigured, aiMockActive, recordUsage } from "@/lib/ai/client";
import { getProvider } from "@/lib/ai/providers";
import { logEvent } from "@/lib/server/ops-log";
import { effortOf } from "@/lib/ai/providers/anthropic";
import type { ProviderImage } from "@/lib/ai/provider";
import { assertAiBudget } from "@/lib/server/ai-budget";
import type { ScrapeCapture } from "@/lib/types";

const LIMITS = { api: 130_000, tables: 60_000, text: 80_000 };

function clip(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max)}\n…[truncated ${value.length - max} chars]`;
}

function registrableHost(url: string): string {
  try {
    return new URL(url).hostname.split(".").slice(-2).join(".");
  } catch {
    return "";
  }
}

/** First-party responses hold the real data; spend the token budget on them first. */
function rankPayloads(capture: ScrapeCapture): { url: string; body: string }[] {
  const pageHost = registrableHost(capture.finalUrl);
  return [...capture.apiPayloads].sort((a, b) => {
    const score = (url: string) =>
      (registrableHost(url) === pageHost ? 2 : 0) + (/\/(api|v\d)\//.test(url) ? 1 : 0);
    return score(b.url) - score(a.url);
  });
}

/**
 * Turns a raw page capture into the prompt body. The captured XHR JSON goes first because it is
 * the closest thing to a real API these sites have — rendered text is the fallback signal.
 */
export function renderCapture(capture: ScrapeCapture): string {
  const parts: string[] = [
    `PAGE TITLE: ${capture.title}`,
    `FINAL URL: ${capture.finalUrl}`,
    `SESSION LOOKS LOGGED IN: ${capture.loggedIn ? "yes" : "no"}`,
  ];

  if (capture.apiPayloads.length) {
    let budget = LIMITS.api;
    const blocks: string[] = [];
    for (const payload of rankPayloads(capture)) {
      if (budget <= 0) break;
      const body = clip(payload.body, Math.min(budget, 40_000));
      budget -= body.length;
      blocks.push(`--- ${payload.url}\n${body}`);
    }
    parts.push(`\n## NETWORK JSON (${capture.apiPayloads.length} responses captured)\n${blocks.join("\n\n")}`);
  }

  if (capture.tables.length) {
    parts.push(`\n## TABLES (tab-separated)\n${clip(capture.tables.join("\n\n---\n\n"), LIMITS.tables)}`);
  }

  parts.push(`\n## RENDERED PAGE TEXT\n${clip(capture.text, LIMITS.text)}`);
  return parts.join("\n");
}

const SYSTEM = `You extract structured betting data from scraped pages of subscription sports-betting tools.

Rules:
- Report only what the page actually contains. Never invent players, lines, projections, edges, or prices.
- The page's own numbers are authoritative. Do not recompute or "correct" them.
- Prefer the NETWORK JSON when it disagrees with the rendered text — it is the page's own data feed.
- When the page is filtered to a matchup, keep rows for that matchup; drop unrelated games.
- If the capture shows a login wall, a paywall, or no data, return an empty result rather than guessing.
- Copy player names exactly as written on the page.`;

/** Set by the most recent model call so callers can attach cost to a source result. */
export let lastUsage: ReturnType<typeof recordUsage> | null = null;

export interface ExtractArgs<T extends z.ZodType> {
  schema: T;
  capture: ScrapeCapture;
  /** What this source is and what to pull from it. */
  instructions: string;
  /** Matchup context so the model can filter to the right game. */
  context: string;
  useVision?: boolean;
  maxTokens?: number;
}

export async function extractFromCapture<T extends z.ZodType>(
  args: ExtractArgs<T>,
): Promise<z.infer<T>> {
  if (!aiConfigured()) throw new AiNotConfiguredError();
  assertAiBudget();
  const { schema, capture, instructions, context, useVision = false, maxTokens = 16000 } = args;

  const images: ProviderImage[] = useVision && capture.screenshotBase64
    ? [{ data: capture.screenshotBase64, mediaType: "image/jpeg" }]
    : [];

  const response = await getProvider().parse({
    model: EXTRACTION_MODEL,
    system: SYSTEM,
    prompt: [
      `## TASK\n${instructions}`,
      `\n## MATCHUP CONTEXT\n${context}`,
      `\n## CAPTURED PAGE\n${renderCapture(capture)}`,
    ].join("\n"),
    schema,
    schemaName: "page_extraction",
    maxTokens,
    images,
  });

  lastUsage = recordUsage(`extract:${capture.finalUrl.slice(8, 30)}`, response.usage, EXTRACTION_MODEL);

  if (response.stop === "refusal") {
    throw new Error(`Model declined to extract: ${response.refusal ?? "no explanation"}`);
  }
  if (response.parsed != null) return response.parsed as z.infer<T>;
  try {
    return schema.parse(JSON.parse(response.text)) as z.infer<T>;
  } catch {
    throw new Error("Model returned no parseable structured output.");
  }
}

export interface StructuredImage {
  /** Base64 without the data: prefix. */
  data: string;
  mediaType: "image/jpeg" | "image/png" | "image/webp";
}

export interface StructuredArgs<T extends z.ZodType> {
  schema: T;
  system: string;
  prompt: string;
  maxTokens?: number;
  /** Defaults to the judgement model; localisation and other mechanical passes pass a cheaper one. */
  model?: string;
  /** Names the call in ai_usage and picks its fixture under AI_MOCK. */
  label?: string;
  /** Vision input, sent before the text. Processed in memory only. */
  images?: StructuredImage[];
  /** Thinking effort for this call (Anthropic); unset means the configured default. */
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  /** The deterministic answer used under AI_MOCK. A call without one fails in mock mode. */
  mock?: () => z.infer<T>;
}

export interface StructuredResult<T> { data: T; costUsd: number; model: string }

/**
 * Structured generation that also reports what this very call cost, so concurrent calls never read
 * each other's usage (the module-level `lastUsage` only suits sequential jobs).
 */
export async function generateStructuredWithUsage<T extends z.ZodType>(args: StructuredArgs<T>): Promise<StructuredResult<z.infer<T>>> {
  if (!aiConfigured()) throw new AiNotConfiguredError();
  assertAiBudget();
  const model = args.model ?? MODEL;
  const label = args.label ?? "generate";

  if (aiMockActive()) {
    if (!args.mock) throw new Error(`AI_MOCK: no fixture for "${label}"`);
    const data = args.schema.parse(args.mock()) as z.infer<T>;
    lastUsage = recordUsage(`mock:${label}`, ZERO_USAGE, model);
    return { data, costUsd: 0, model };
  }

  // The auto-adjust policy. A read cut by its output cap is almost always thinking that ate the
  // budget; it is retried at once with less of it — twice at most — and only then given up. An
  // operator cannot watch every quarter of every game, and a lost live read is gone for good.
  let effort = args.effort ?? effortOf();
  let attempt = 0;
  for (;;) {
    try {
      return await callModel({ ...args, effort }, model, attempt ? `${label}:retry${attempt}` : label);
    } catch (error) {
      if (error instanceof Error && TRUNCATED.test(error.message) && attempt < MAX_ADJUSTS) {
        const next = LOWER_EFFORT[effort];
        if (next) {
          logEvent("ai.auto_adjust", { label, model, from: effort, to: next, attempt: attempt + 1 });
          effort = next;
          attempt += 1;
          continue;
        }
      }
      // A cheap model that rejects the structured-output format falls back once to the extraction model.
      if (model !== EXTRACTION_MODEL && error instanceof Error && /output_config|output format|json_schema|response_format|text\.format/i.test(error.message)) {
        return callModel({ ...args, effort }, EXTRACTION_MODEL, `${label}:fallback`);
      }
      throw error;
    }
  }
}

const TRUNCATED = /Output hit the \d+-token cap/;
const MAX_ADJUSTS = 2;
type Effort = NonNullable<StructuredArgs<z.ZodType>["effort"]>;
const LOWER_EFFORT: Record<Effort, Effort | null> = { max: "xhigh", xhigh: "high", high: "medium", medium: "low", low: null };

async function callModel<T extends z.ZodType>(args: StructuredArgs<T>, model: string, label: string): Promise<StructuredResult<z.infer<T>>> {
  const maxTokens = args.maxTokens ?? 16000;
  // The system prompt is the same ~3k tokens for every game in a run, so it is marked cacheable:
  // sequential calls inside the five-minute window pay a tenth of the price for it.
  const response = await getProvider().generate({
    model,
    system: args.system,
    prompt: args.prompt,
    schema: args.schema,
    schemaName: label,
    maxTokens,
    images: args.images,
    cacheSystem: true,
    effort: args.effort,
  });
  // Recorded before the checks below: a refused or truncated answer was still billed.
  const usage = recordUsage(`${label}[${response.stop}]`, response.usage, model);
  lastUsage = usage;

  if (response.stop === "refusal") {
    throw new Error(`Model declined: ${response.refusal ?? "no explanation"}`);
  }
  if (response.stop === "max_tokens") {
    // The JSON is cut mid-string; a parse error here would hide the real cause.
    throw new Error(
      `Output hit the ${maxTokens}-token cap and was truncated. Ask for fewer tickets, or raise maxTokens.`,
    );
  }

  try {
    const data = args.schema.parse(response.parsed ?? JSON.parse(response.text)) as z.infer<T>;
    return { data, costUsd: usage.costUsd, model };
  } catch (error) {
    throw new Error(
      `Could not parse structured output (stop=${response.stop}, ${response.text.length} chars): ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

/** Structured generation without a page capture (relevance filtering, synthesis briefs). */
export async function generateStructured<T extends z.ZodType>(args: StructuredArgs<T>): Promise<z.infer<T>> {
  return (await generateStructuredWithUsage(args)).data;
}
