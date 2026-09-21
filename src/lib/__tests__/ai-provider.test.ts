import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";

const DIR = path.join(process.cwd(), "data", "unit-ai-provider");
process.env.DATA_DIR = DIR;
process.env.AUTH_SECRET = "test-secret-that-is-long-enough";
fs.rmSync(DIR, { recursive: true, force: true });

const OpenAI = (await import("openai")).default;
const { APIConnectionError, APIError } = await import("openai");
const Anthropic = (await import("@anthropic-ai/sdk")).default;
const { aiProviderName, redactKeys } = await import("@/lib/ai/provider");
const { getProvider } = await import("@/lib/ai/providers");
const { buildRequest, normaliseUsage, openaiProvider, readRefusal, readStop, reasoningEffort, resetOpenaiClient, schemaName } =
  await import("@/lib/ai/providers/openai");
const { anthropicProvider } = await import("@/lib/ai/providers/anthropic");
const {
  ANTHROPIC_DEFAULT_MODELS, OPENAI_DEFAULT_MODELS, ZERO_USAGE,
  aiConfigured, aiModels, describeAiError, priceOf, recordUsage, usageCostUsd,
} = await import("@/lib/ai/client");
const { generateStructuredWithUsage } = await import("@/lib/ai/extract");
const { aiSpendToday } = await import("@/lib/server/ai-budget");
const { unknownModels } = await import("@/lib/ai/model-check");
const { SlateSchema } = await import("@/lib/bets/builder");
const { ScanSchema } = await import("@/lib/bets/slip-scan");
const { LossReviewSchema } = await import("@/lib/ledger/review");
const { TipsterSchema } = await import("@/lib/tipster/audit");

const Answer = z.object({ answer: z.string(), score: z.number() });

const KEY = "sk-test-0123456789abcdefghijklmnop";
const envBackup = { ...process.env };
afterEach(() => {
  for (const key of ["AI_PROVIDER", "OPENAI_API_KEY", "OPENAI_MODEL", "OPENAI_CHEAP_MODEL", "OPENAI_EXTRACTION_MODEL", "OPENAI_LIVE_MODEL", "OPENAI_REASONING_EFFORT", "ANTHROPIC_API_KEY"]) {
    if (envBackup[key] === undefined) delete process.env[key];
    else process.env[key] = envBackup[key];
  }
  resetOpenaiClient();
});

describe("provider selection", () => {
  it("stays on Anthropic until the env says otherwise", () => {
    expect(aiProviderName({})).toBe("anthropic");
    expect(aiProviderName({ AI_PROVIDER: "" })).toBe("anthropic");
    expect(aiProviderName({ AI_PROVIDER: "anthropic" })).toBe("anthropic");
    expect(aiProviderName({ AI_PROVIDER: "gemini" })).toBe("anthropic");
    // docker compose keeps a trailing comment as the value; that is not "openai".
    expect(aiProviderName({ AI_PROVIDER: "# openai" })).toBe("anthropic");
  });

  it("switches on AI_PROVIDER=openai, whatever the case", () => {
    expect(aiProviderName({ AI_PROVIDER: "openai" })).toBe("openai");
    expect(aiProviderName({ AI_PROVIDER: "OpenAI" })).toBe("openai");
    expect(getProvider({ AI_PROVIDER: "openai" }).name).toBe("openai");
    expect(getProvider({}).name).toBe("anthropic");
  });

  it("asks the provider in use whether a key is configured", () => {
    process.env.AI_PROVIDER = "openai";
    delete process.env.OPENAI_API_KEY;
    expect(aiConfigured()).toBe(false);
    process.env.OPENAI_API_KEY = "sk-proj-...";
    expect(aiConfigured()).toBe(false);
    process.env.OPENAI_API_KEY = KEY;
    expect(aiConfigured()).toBe(true);
  });
});

describe("model ids", () => {
  it("keeps the Anthropic defaults and overrides", () => {
    expect(aiModels({})).toEqual(ANTHROPIC_DEFAULT_MODELS);
    expect(aiModels({ ANTHROPIC_MODEL: "claude-x", ANTHROPIC_CHEAP_MODEL: "claude-y" }))
      .toMatchObject({ judgement: "claude-x", cheap: "claude-y", extraction: "claude-sonnet-5" });
  });

  it("uses the cheap OpenAI tier by default and takes four overrides", () => {
    expect(aiModels({ AI_PROVIDER: "openai" })).toEqual(OPENAI_DEFAULT_MODELS);
    expect(OPENAI_DEFAULT_MODELS.extraction).toBe(OPENAI_DEFAULT_MODELS.cheap);
    expect(aiModels({
      AI_PROVIDER: "openai", OPENAI_MODEL: "a", OPENAI_EXTRACTION_MODEL: "b", OPENAI_CHEAP_MODEL: "c", OPENAI_LIVE_MODEL: "d",
    })).toEqual({ judgement: "a", extraction: "b", cheap: "c", live: "d" });
  });

  it("names the models the account does not list, snapshots included", () => {
    expect(unknownModels(["gpt-5.6-luna", "gpt-5.6-terra"], ["gpt-5.6-luna-2026-08-01", "gpt-5.6-terra"])).toEqual([]);
    expect(unknownModels(["gpt-5.6-luna-2026-08-01"], ["gpt-5.6-luna"])).toEqual([]);
    expect(unknownModels(["gpt-9-imaginary", "gpt-5.6-luna"], ["gpt-5.6-luna"])).toEqual(["gpt-9-imaginary"]);
    // A provider that could not answer must not accuse every model of being missing.
    expect(unknownModels(["gpt-9-imaginary"], [])).toEqual([]);
  });
});

describe("the OpenAI request shape", () => {
  it("sends the system prompt, the images before the text, a strict schema and an output cap", () => {
    const body = buildRequest({
      model: "gpt-5.6-luna", system: "SYS", prompt: "USER", schema: Answer, schemaName: "slip_scan",
      maxTokens: 1500, images: [{ data: "AAAA", mediaType: "image/jpeg" }],
    }) as Record<string, unknown>;

    expect(body.model).toBe("gpt-5.6-luna");
    expect(body.instructions).toBe("SYS");
    expect(body.max_output_tokens).toBe(1500);
    expect(body.store).toBe(false);
    expect(body.reasoning).toEqual({ effort: "low" });

    const input = body.input as { role: string; content: Record<string, string>[] }[];
    expect(input[0].role).toBe("user");
    expect(input[0].content[0]).toMatchObject({ type: "input_image", image_url: "data:image/jpeg;base64,AAAA" });
    expect(input[0].content[1]).toEqual({ type: "input_text", text: "USER" });

    const format = (body.text as { format: Record<string, unknown> }).format;
    expect(format.type).toBe("json_schema");
    expect(format.name).toBe("slip_scan");
    expect(format.strict).toBe(true);
    const schema = format.schema as { properties: Record<string, unknown>; additionalProperties: boolean; required: string[] };
    expect(Object.keys(schema.properties)).toEqual(["answer", "score"]);
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual(["answer", "score"]);
  });

  it("omits the image block when there is none, and the reasoning block when switched off", () => {
    const body = buildRequest({ model: "m", system: "S", prompt: "P", schema: Answer, schemaName: "x", maxTokens: 10 }) as Record<string, unknown>;
    const input = body.input as { content: unknown[] }[];
    expect(input[0].content).toHaveLength(1);

    process.env.OPENAI_REASONING_EFFORT = "off";
    expect(buildRequest({ model: "m", system: "S", prompt: "P", schema: Answer, schemaName: "x", maxTokens: 10 })).not.toHaveProperty("reasoning");
  });

  it("defaults the reasoning effort to low and refuses nonsense", () => {
    expect(reasoningEffort({})).toBe("low");
    expect(reasoningEffort({ OPENAI_REASONING_EFFORT: "high" })).toBe("high");
    expect(reasoningEffort({ OPENAI_REASONING_EFFORT: "banana" })).toBe("low");
    expect(reasoningEffort({ OPENAI_REASONING_EFFORT: "off" })).toBeNull();
  });

  it("makes a legal schema name out of any call label", () => {
    expect(schemaName("extract:propscash.com")).toBe("extract_propscash_com");
    expect(schemaName("slate:fallback")).toBe("slate_fallback");
    expect(schemaName("!!!")).toBe("structured_output");
  });
});

/** The SDK is real; only the socket is fake. Nothing in this file may reach the network. */
function stubbedClient(payload: unknown, captured: { body?: Record<string, unknown> } = {}) {
  const client = new OpenAI({
    apiKey: KEY,
    maxRetries: 0,
    fetch: async (_url: RequestInfo | URL, init?: RequestInit) => {
      captured.body = JSON.parse(String(init?.body ?? "{}"));
      return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
    },
  });
  resetOpenaiClient(client);
  return captured;
}

const response = (over: Record<string, unknown> = {}) => ({
  id: "resp_1", object: "response", created_at: 1, model: "gpt-5.6-luna", status: "completed",
  incomplete_details: null, error: null, instructions: null, metadata: {}, tools: [], tool_choice: "auto",
  parallel_tool_calls: false, temperature: 1, top_p: 1,
  output: [{
    id: "msg_1", type: "message", role: "assistant", status: "completed",
    content: [{ type: "output_text", text: JSON.stringify({ answer: "ok", score: 7 }), annotations: [] }],
  }],
  usage: {
    input_tokens: 1000, output_tokens: 200, total_tokens: 1200,
    input_tokens_details: { cached_tokens: 400, cache_write_tokens: 0 },
    output_tokens_details: { reasoning_tokens: 40 },
  },
  ...over,
});

describe("the OpenAI provider against a stubbed SDK", () => {
  it("returns the parsed answer, the raw text and normalised usage", async () => {
    const captured = stubbedClient(response());
    const result = await openaiProvider.generate({
      model: "gpt-5.6-luna", system: "SYS", prompt: "USER", schema: Answer, schemaName: "answer", maxTokens: 900,
    });
    expect(captured.body).toMatchObject({ model: "gpt-5.6-luna", instructions: "SYS", max_output_tokens: 900, store: false });
    expect(result.stop).toBe("end");
    expect(result.parsed).toEqual({ answer: "ok", score: 7 });
    expect(JSON.parse(result.text)).toEqual({ answer: "ok", score: 7 });
    // input_tokens includes the cached part; the cached part must be counted once, at its own rate.
    expect(result.usage).toEqual({ inputTokens: 600, outputTokens: 200, cacheReadTokens: 400, cacheWriteTokens: 0 });
  });

  it("reports a truncated answer as max_tokens rather than as broken JSON", async () => {
    stubbedClient(response({ status: "incomplete", incomplete_details: { reason: "max_output_tokens" } }));
    const result = await openaiProvider.generate({ model: "m", system: "S", prompt: "P", schema: Answer, schemaName: "a", maxTokens: 10 });
    expect(result.stop).toBe("max_tokens");
  });

  it("reports a refusal with its explanation", async () => {
    stubbedClient(response({
      output: [{ id: "msg_1", type: "message", role: "assistant", status: "completed", content: [{ type: "refusal", refusal: "not doing that" }] }],
    }));
    const result = await openaiProvider.parse({ model: "m", system: "S", prompt: "P", schema: Answer, schemaName: "a", maxTokens: 10 });
    expect(result.stop).toBe("refusal");
    expect(result.refusal).toBe("not doing that");
  });

  it("reads a missing usage block as zero instead of throwing", () => {
    expect(normaliseUsage(undefined)).toEqual(ZERO_USAGE);
    expect(normaliseUsage({ input_tokens: 10, output_tokens: 2 })).toEqual({ inputTokens: 10, outputTokens: 2, cacheReadTokens: 0, cacheWriteTokens: 0 });
    expect(readRefusal(null)).toBeNull();
    expect(readStop({ status: "completed" }, null)).toBe("end");
    expect(readStop({ incomplete_details: { reason: "content_filter" } }, null)).toBe("refusal");
  });
});

describe("error mapping", () => {
  const apiError = (status: number, body: Record<string, unknown>) =>
    APIError.generate(status, { error: body }, undefined, new Headers());

  beforeEach(() => { process.env.AI_PROVIDER = "openai"; });

  it("names the five failures an operator meets", () => {
    expect(describeAiError(apiError(401, { message: "Incorrect API key provided", code: "invalid_api_key" }))).toMatch(/rejected the API key/);
    expect(describeAiError(apiError(429, { message: "You exceeded your current quota", code: "insufficient_quota" }))).toMatch(/no credit left/);
    expect(describeAiError(apiError(429, { message: "Rate limit reached", code: "rate_limit_exceeded" }))).toMatch(/Rate limited/);
    expect(describeAiError(apiError(404, { message: "The model does not exist", code: "model_not_found" }))).toMatch(/not allowed to use this model/);
    expect(describeAiError(apiError(403, { message: "Project does not have access", code: null }))).toMatch(/not allowed to use this model/);
    expect(describeAiError(new APIConnectionError({ message: "socket hang up" }))).toMatch(/Could not reach the OpenAI API/);
    expect(describeAiError(new Error("something else entirely"))).toBeNull();
  });

  it("keeps the Anthropic mapping when the provider is Anthropic", () => {
    process.env.AI_PROVIDER = "anthropic";
    expect(describeAiError(new Error("Your credit balance is too low"))).toMatch(/Anthropic account has no credit/);
    expect(describeAiError(new Anthropic.AuthenticationError(401, {}, "nope", new Headers()))).toMatch(/Anthropic rejected the API key/);
    expect(anthropicProvider.describeError(new Error("nothing known"))).toBeNull();
  });

  it("never lets a key reach the message", () => {
    expect(redactKeys(`boom with sk-proj-${"a".repeat(40)} inside`)).not.toMatch(/aaaa/);
    const leaky = describeAiError(apiError(400, { message: `bad request for key ${KEY}`, code: "bad" }));
    expect(leaky).toBeTruthy();
    expect(leaky).not.toContain(KEY);
    expect(leaky).toContain("sk-***");
  });
});

describe("pricing", () => {
  it("bills input, output and cached input at their own rates", () => {
    const luna = priceOf("gpt-5.6-luna", "openai");
    expect(luna).toEqual({ input: 0.2, output: 1.2, cacheRead: 0.02, cacheWrite: 0.2 });
    // 600 × $0.20 + 200 × $1.20 + 400 × $0.02, per million.
    expect(usageCostUsd({ inputTokens: 600, outputTokens: 200, cacheReadTokens: 400, cacheWriteTokens: 0 }, luna))
      .toBeCloseTo((600 * 0.2 + 200 * 1.2 + 400 * 0.02) / 1_000_000, 12);
  });

  it("prices an unknown model as the dearest one its provider sells, never the other provider's", () => {
    expect(priceOf("gpt-not-real", "openai")).toEqual(priceOf("gpt-6-astra", "openai"));
    expect(priceOf("claude-not-real", "anthropic")).toEqual(priceOf("claude-opus-5", "anthropic"));
  });

  it("keeps the Anthropic numbers untouched", () => {
    expect(priceOf("claude-opus-5", "anthropic")).toEqual({ input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 });
    expect(usageCostUsd({ inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }, priceOf("claude-sonnet-5", "anthropic"))).toBe(2);
  });
});

describe("what a failed call costs", () => {
  beforeEach(() => {
    process.env.AI_PROVIDER = "openai";
    process.env.OPENAI_API_KEY = KEY;
  });

  it("records the spend of a refused call and still reports the failure", async () => {
    stubbedClient(response({
      output: [{ id: "m", type: "message", role: "assistant", status: "completed", content: [{ type: "refusal", refusal: "no" }] }],
    }));
    const before = aiSpendToday();
    await expect(generateStructuredWithUsage({
      schema: Answer, system: "S", prompt: "P", label: "refused_call", model: "gpt-5.6-luna", maxTokens: 500,
    })).rejects.toThrow(/Model declined/);
    // The provider billed the tokens it burned, so the ceiling has to know about them.
    expect(aiSpendToday()).toBeGreaterThan(before);
  });

  it("records nothing when the provider never answered", async () => {
    resetOpenaiClient(new OpenAI({
      apiKey: KEY, maxRetries: 0,
      fetch: async () => new Response(JSON.stringify({ error: { message: "Incorrect API key", code: "invalid_api_key" } }), { status: 401, headers: { "content-type": "application/json" } }),
    }));
    const before = aiSpendToday();
    await expect(generateStructuredWithUsage({ schema: Answer, system: "S", prompt: "P", label: "dead_key", model: "gpt-5.6-luna" }))
      .rejects.toThrow();
    expect(aiSpendToday()).toBe(before);
  });

  it("costs nothing under AI_MOCK", () => {
    const record = recordUsage("mock:x", ZERO_USAGE, "gpt-5.6-luna");
    expect(record.costUsd).toBe(0);
  });
});

/**
 * OpenAI's strict mode refuses schemas Anthropic accepts — an optional field, a bare record, a
 * default. The four schemas below are the ones the product actually sends (the ticket slate is the
 * deepest by far); if one stops converting, every ticket stops being built.
 */
describe("the product's own schemas in OpenAI strict mode", () => {
  it.each([
    ["slate", SlateSchema],
    ["slip_scan", ScanSchema],
    ["loss_review", LossReviewSchema],
    ["tipster", TipsterSchema],
  ])("%s converts to a strict json_schema", (name, schema) => {
    const format = buildRequest({ model: "m", system: "S", prompt: "P", schema, schemaName: name, maxTokens: 100 }).text?.format as
      { type: string; name: string; strict: boolean; schema: { additionalProperties: boolean } };
    expect(format.type).toBe("json_schema");
    expect(format.strict).toBe(true);
    expect(format.name).toBe(name);
    expect(format.schema.additionalProperties).toBe(false);
  });
});
