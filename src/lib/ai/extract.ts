import type { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type Anthropic from "@anthropic-ai/sdk";
import { AiNotConfiguredError, MODEL, aiConfigured, getClient } from "@/lib/ai/client";
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
    model: MODEL,
    max_tokens: maxTokens,
    system: SYSTEM,
    thinking: { type: "adaptive" },
    output_config: { format: zodOutputFormat(schema) },
    messages: [{ role: "user", content }],
  });

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
}): Promise<z.infer<T>> {
  if (!aiConfigured()) throw new AiNotConfiguredError();
  const response = await getClient().messages.parse({
    model: MODEL,
    max_tokens: args.maxTokens ?? 16000,
    system: args.system,
    thinking: { type: "adaptive" },
    output_config: { format: zodOutputFormat(args.schema) },
    messages: [{ role: "user", content: args.prompt }],
  });
  if (response.stop_reason === "refusal") {
    throw new Error(`Model declined: ${response.stop_details?.explanation ?? "no explanation"}`);
  }
  if (!response.parsed_output) throw new Error("Model returned no parseable structured output.");
  return response.parsed_output as z.infer<T>;
}
