import OpenAI, {
  APIConnectionError,
  APIError,
  AuthenticationError,
  NotFoundError,
  PermissionDeniedError,
  RateLimitError,
} from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import type { ResponseCreateParamsNonStreaming, ResponseInputContent } from "openai/resources/responses/responses";
import type { ReasoningEffort } from "openai/resources/shared";
import { envValue } from "@/lib/env";
import { redactKeys, type AiProvider, type ProviderRequest, type ProviderResponse, type ProviderStop, type ProviderUsage } from "@/lib/ai/provider";

let client: OpenAI | null = null;

/** The SDK reads OPENAI_API_KEY itself; OPENAI_BASE_URL covers a gateway or an Azure-style proxy. */
function getClient(): OpenAI {
  if (!client) client = new OpenAI();
  return client;
}

/** Test seam: a new key or a stub takes effect on the next call. */
export function resetOpenaiClient(): void {
  client = null;
}

const EFFORTS = new Set(["none", "minimal", "low", "medium", "high", "xhigh", "max"]);

/**
 * `max_output_tokens` counts reasoning tokens, so a chatty reasoner can burn a 1 500-token cap
 * before it writes a single character of JSON — and reasoning tokens bill at the output rate.
 * "low" keeps both problems small. `OPENAI_REASONING_EFFORT=off` drops the field entirely, which
 * is what a non-reasoning model needs.
 */
export function reasoningEffort(env: Record<string, string | undefined> = process.env): ReasoningEffort | null {
  const raw = envValue("OPENAI_REASONING_EFFORT", env).toLowerCase();
  if (raw === "off") return null;
  if (!raw) return "low";
  return EFFORTS.has(raw) ? (raw as ReasoningEffort) : "low";
}

/** OpenAI's schema names are `[A-Za-z0-9_-]`; the call labels are not. */
export function schemaName(raw: string): string {
  const cleaned = raw.replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60);
  return cleaned || "structured_output";
}

/**
 * OpenAI counts cached tokens inside `input_tokens`; Anthropic reports them alongside. Subtracting
 * here is what keeps `recordUsage` from billing the cached part twice — once at the full input
 * rate and again at the cached rate. Tokens newly written to the cache bill at the plain input
 * rate and are already inside `input_tokens`, so they are not reported separately.
 */
export function normaliseUsage(usage: {
  input_tokens?: number;
  output_tokens?: number;
  input_tokens_details?: { cached_tokens?: number } | null;
} | null | undefined): ProviderUsage {
  const cacheRead = usage?.input_tokens_details?.cached_tokens ?? 0;
  const input = usage?.input_tokens ?? 0;
  return {
    inputTokens: Math.max(0, input - cacheRead),
    outputTokens: usage?.output_tokens ?? 0,
    cacheReadTokens: cacheRead,
    cacheWriteTokens: 0,
  };
}

interface RefusalPart { type: string; refusal?: string | null }
interface OutputItem { type?: string; content?: RefusalPart[] | null }

/** The refusal arrives as a content part inside the message, not as a stop reason. */
export function readRefusal(output: unknown): string | null {
  if (!Array.isArray(output)) return null;
  for (const item of output as OutputItem[]) {
    for (const part of item?.content ?? []) {
      if (part?.type === "refusal") return part.refusal || "no explanation";
    }
  }
  return null;
}

export function readStop(response: { status?: string | null; incomplete_details?: { reason?: string } | null }, refusal: string | null): ProviderStop {
  if (response.incomplete_details?.reason === "max_output_tokens") return "max_tokens";
  if (refusal !== null || response.incomplete_details?.reason === "content_filter") return "refusal";
  return "end";
}

/** The request body both provider methods send. Exported so a test can assert its shape. */
export function buildRequest(request: ProviderRequest): ResponseCreateParamsNonStreaming {
  const content: ResponseInputContent[] = [
    ...(request.images ?? []).map((img): ResponseInputContent => ({
      type: "input_image",
      detail: "auto",
      image_url: `data:${img.mediaType};base64,${img.data}`,
    })),
    { type: "input_text", text: request.prompt },
  ];
  const effort = reasoningEffort();
  return {
    model: request.model,
    instructions: request.system,
    input: [{ role: "user", content }],
    max_output_tokens: request.maxTokens,
    text: { format: zodTextFormat(request.schema, schemaName(request.schemaName)) },
    ...(effort ? { reasoning: { effort } } : {}),
    // Nothing the user sends is worth keeping on someone else's server for 30 days.
    store: false,
  };
}

async function call(request: ProviderRequest): Promise<ProviderResponse> {
  const response = await getClient().responses.parse(buildRequest(request));
  const refusal = readRefusal(response.output);
  return {
    text: response.output_text ?? "",
    parsed: response.output_parsed ?? null,
    stop: readStop(response, refusal),
    refusal,
    usage: normaliseUsage(response.usage),
  };
}

/**
 * OpenAI behind the same interface. `responses.parse` is one shot for both methods: the SDK has no
 * streaming parse helper, and the Responses API holds the connection open for long generations by
 * itself, so the Anthropic reason for streaming does not apply.
 */
export const openaiProvider: AiProvider = {
  name: "openai",
  generate: call,
  parse: call,

  configured(): boolean {
    const key = envValue("OPENAI_API_KEY");
    // The .env.example placeholder would otherwise read as configured and fail with a 401.
    return key.length > 20 && !key.includes("...");
  },

  /**
   * The five failures an operator actually meets. The key is never echoed: OpenAI does not put it
   * in the message, and anything that reaches the fallback branch is redacted anyway.
   */
  describeError(error: unknown): string | null {
    const message = error instanceof Error ? error.message : String(error ?? "");
    const code = error instanceof APIError ? (error.code ?? "") : "";

    // Checked before the 429 branch: OpenAI reports "no credit" as a rate-limit status.
    if (code === "insufficient_quota" || /insufficient_quota|exceeded your current quota|billing/i.test(message)) {
      return "The OpenAI account has no credit left. Top it up at platform.openai.com → Billing — the key itself is valid.";
    }
    if (code === "invalid_api_key" || error instanceof AuthenticationError) {
      return "OpenAI rejected the API key (401). Replace OPENAI_API_KEY in .env with a valid key from platform.openai.com, then restart the server.";
    }
    if (code === "model_not_found" || error instanceof NotFoundError || error instanceof PermissionDeniedError) {
      return "The API key is valid but not allowed to use this model, or the model id does not exist. Check OPENAI_MODEL / OPENAI_CHEAP_MODEL / OPENAI_EXTRACTION_MODEL / OPENAI_LIVE_MODEL against platform.openai.com → Models.";
    }
    if (error instanceof RateLimitError || /rate.?limit/i.test(message)) {
      return "Rate limited by the OpenAI API. Wait a moment and retry.";
    }
    if (error instanceof APIConnectionError) {
      return "Could not reach the OpenAI API. Check the network and retry.";
    }
    // Least specific last: APIError carries the status for everything not matched above.
    if (error instanceof APIError) {
      return redactKeys(`OpenAI API error ${error.status ?? "?"}: ${error.message}`);
    }
    return null;
  },

  async listModels(): Promise<string[] | null> {
    try {
      const ids: string[] = [];
      for await (const model of await getClient().models.list()) ids.push(model.id);
      return ids;
    } catch {
      return null;
    }
  },
};
