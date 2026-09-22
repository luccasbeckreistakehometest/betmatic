import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { envValue } from "@/lib/env";
import { redactKeys, type AiProvider, type ProviderRequest, type ProviderResponse, type ProviderStop } from "@/lib/ai/provider";

/** Haiku 4.5 rejects adaptive thinking; it runs without a thinking block here. */
export const supportsAdaptiveThinking = (model: string): boolean => !/haiku/i.test(model);

/**
 * How hard the model may think. Adaptive thinking on Opus 5 spent the whole 16k output budget
 * thinking about one slate and, at 32k, still cut the JSON short (22/09/2026, six reads, no
 * ticket); the numbers the read leans on are computed in code, so bounded effort loses little.
 * ANTHROPIC_EFFORT: low | medium | high | xhigh | max. Unset means high.
 */
export function effortOf(env: Record<string, string | undefined> = process.env): "low" | "medium" | "high" | "xhigh" | "max" {
  const v = (env.ANTHROPIC_EFFORT ?? "").trim().toLowerCase();
  return v === "low" || v === "medium" || v === "high" || v === "xhigh" || v === "max" ? v : "high";
}

/** The text of a message, whole or as far as it got. */
const textOf = (content: { type: string; text?: string }[]) => content.filter((b) => b.type === "text").map((b) => b.text ?? "").join("");

let client: Anthropic | null = null;

/** The SDK reads ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN itself. */
function getClient(): Anthropic {
  // A key created at the organisation level is not scoped to a workspace, and Anthropic then refuses
  // every request that does not name one. ANTHROPIC_WORKSPACE_ID names it; a workspace-scoped key
  // needs nothing.
  if (!client) {
    const workspace = (process.env.ANTHROPIC_WORKSPACE_ID ?? "").trim();
    client = new Anthropic(workspace ? { defaultHeaders: { "anthropic-workspace-id": workspace } } : {});
  }
  return client;
}

/** Test seam: inject a stubbed client, or pass nothing to pick a new key up on the next call. */
export function resetAnthropicClient(next: Anthropic | null = null): void {
  client = next;
}

const stopOf = (reason: string | null | undefined): ProviderStop =>
  reason === "refusal" ? "refusal" : reason === "max_tokens" ? "max_tokens" : "end";

const usageOf = (usage: Anthropic.Usage | undefined) => ({
  inputTokens: usage?.input_tokens ?? 0,
  outputTokens: usage?.output_tokens ?? 0,
  cacheReadTokens: usage?.cache_read_input_tokens ?? 0,
  cacheWriteTokens: usage?.cache_creation_input_tokens ?? 0,
});

function contentOf(request: ProviderRequest): Anthropic.ContentBlockParam[] {
  return [
    ...(request.images ?? []).map((img): Anthropic.ContentBlockParam => ({
      type: "image",
      source: { type: "base64", media_type: img.mediaType, data: img.data },
    })),
    { type: "text", text: request.prompt },
  ];
}

export const anthropicProvider: AiProvider = {
  name: "anthropic",

  /**
   * Streaming is required for large max_tokens and avoids HTTP timeouts on long generations.
   * The system prompt is the same ~3k tokens for every game in a run, so it is marked cacheable:
   * sequential calls inside the five-minute window pay a tenth of the price for it.
   */
  async generate(request: ProviderRequest): Promise<ProviderResponse> {
    const stream = getClient().messages.stream({
      model: request.model,
      max_tokens: request.maxTokens,
      system: request.cacheSystem
        ? [{ type: "text", text: request.system, cache_control: { type: "ephemeral" } }]
        : request.system,
      ...(supportsAdaptiveThinking(request.model) ? { thinking: { type: "adaptive" as const }, output_config: { format: zodOutputFormat(request.schema), effort: effortOf() } } : { output_config: { format: zodOutputFormat(request.schema) } }),
      messages: [{ role: "user", content: contentOf(request) }],
    });
    let response: Anthropic.Message;
    try {
      response = await stream.finalMessage();
    } catch (error) {
      // The SDK parses the structured output the moment the stream ends, whatever the stop reason,
      // so a JSON cut by max_tokens surfaces as a parse error and hides both the cause and the bill.
      // The accumulated message still carries its stop reason and usage: hand those back and let the
      // caller name the truncation.
      const snapshot = stream.currentMessage;
      if (!snapshot?.stop_reason) throw error;
      return {
        text: textOf(snapshot.content),
        parsed: null,
        stop: stopOf(snapshot.stop_reason),
        refusal: snapshot.stop_details?.explanation ?? null,
        usage: usageOf(snapshot.usage),
      };
    }
    return {
      text: textOf(response.content),
      parsed: null,
      stop: stopOf(response.stop_reason),
      refusal: response.stop_details?.explanation ?? null,
      usage: usageOf(response.usage),
    };
  },

  /** The page extractor: one shot, no streaming, and the SDK hands back the parsed object. */
  async parse(request: ProviderRequest): Promise<ProviderResponse> {
    const response = await getClient().messages.parse({
      model: request.model,
      max_tokens: request.maxTokens,
      system: request.system,
      ...(supportsAdaptiveThinking(request.model) ? { thinking: { type: "adaptive" as const } } : {}),
      output_config: { format: zodOutputFormat(request.schema) },
      messages: [{ role: "user", content: contentOf(request) }],
    });
    return {
      text: response.content.filter((b) => b.type === "text").map((b) => b.text).join(""),
      parsed: response.parsed_output ?? null,
      stop: stopOf(response.stop_reason),
      refusal: response.stop_details?.explanation ?? null,
      usage: usageOf(response.usage),
    };
  },

  configured(): boolean {
    const key = envValue("ANTHROPIC_API_KEY") || envValue("ANTHROPIC_AUTH_TOKEN");
    // The .env.local.example placeholder would otherwise read as configured and fail with a 401.
    return key.length > 20 && !key.includes("...");
  },

  /**
   * Turns SDK errors into something a dashboard panel can show. Keys get revoked and rate limits get
   * hit in normal use — a raw 401 JSON blob in the UI helps nobody.
   */
  describeError(error: unknown): string | null {
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
      return redactKeys(`Anthropic API error ${error.status ?? "?"}: ${error.message}`);
    }
    return null;
  },

  async listModels(): Promise<string[] | null> {
    try {
      const ids: string[] = [];
      for await (const model of getClient().models.list({ limit: 100 })) ids.push(model.id);
      return ids;
    } catch {
      return null;
    }
  },
};
