import type { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type Anthropic from "@anthropic-ai/sdk";
import { AiNotConfiguredError, EXTRACTION_MODEL, MODEL, aiConfigured, getClient, recordUsage } from "@/lib/ai/client";
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
  const { schema, capture, instructions, context, useVision = false, maxTokens = 16000 } = args;

  const content: Anthropic.ContentBlockParam[] = [];
  if (useVision && capture.screenshotBase64) {
    content.push({
      type: "image",
      source: { type: "base64", media_type: "image/jpeg", data: capture.screenshotBase64 },
    });
  }
  content.push({
    type: "text",
    text: [
      `## TASK\n${instructions}`,
      `\n## MATCHUP CONTEXT\n${context}`,
      `\n## CAPTURED PAGE\n${renderCapture(capture)}`,
    ].join("\n"),
  });

  const response = await getClient().messages.parse({
    model: EXTRACTION_MODEL,
    max_tokens: maxTokens,
    system: SYSTEM,
    thinking: { type: "adaptive" },
    output_config: { format: zodOutputFormat(schema) },
    messages: [{ role: "user", content }],
  });

  lastUsage = recordUsage(`extract:${capture.finalUrl.slice(8, 30)}`, response.usage, EXTRACTION_MODEL);

  if (response.stop_reason === "refusal") {
    throw new Error(`Model declined to extract: ${response.stop_details?.explanation ?? "no explanation"}`);
  }
  if (!response.parsed_output) {
    throw new Error("Model returned no parseable structured output.");
  }
  return response.parsed_output as z.infer<T>;
}

/** Structured generation without a page capture (relevance filtering, synthesis briefs). */
export async function generateStructured<T extends z.ZodType>(args: {
  schema: T;
  system: string;
  prompt: string;
  maxTokens?: number;
  /** Defaults to the judgement model; localisation and other mechanical passes pass the cheaper one. */
  model?: string;
}): Promise<z.infer<T>> {
  if (!aiConfigured()) throw new AiNotConfiguredError();
  const maxTokens = args.maxTokens ?? 16000;
  const model = args.model ?? MODEL;

  // Streaming is required for large max_tokens and avoids HTTP timeouts on long generations.
  // The system prompt is the same ~3k tokens for every game in a run, so it is marked cacheable:
  // sequential calls inside the five-minute window pay a tenth of the price for it.
  const stream = getClient().messages.stream({
    model,
    max_tokens: maxTokens,
    system: [{ type: "text", text: args.system, cache_control: { type: "ephemeral" } }],
    thinking: { type: "adaptive" },
    output_config: { format: zodOutputFormat(args.schema) },
    messages: [{ role: "user", content: args.prompt }],
  });
  const response = await stream.finalMessage();
  lastUsage = recordUsage(`generate[${response.stop_reason}]`, response.usage, model);

  if (response.stop_reason === "refusal") {
    throw new Error(`Model declined: ${response.stop_details?.explanation ?? "no explanation"}`);
  }
  if (response.stop_reason === "max_tokens") {
    // The JSON is cut mid-string; a parse error here would hide the real cause.
    throw new Error(
      `Output hit the ${maxTokens}-token cap and was truncated. Ask for fewer tickets, or raise maxTokens.`,
    );
  }

  const text = response.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  try {
    return args.schema.parse(JSON.parse(text)) as z.infer<T>;
  } catch (error) {
    throw new Error(
      `Could not parse structured output (stop_reason=${response.stop_reason}, ${text.length} chars): ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}
