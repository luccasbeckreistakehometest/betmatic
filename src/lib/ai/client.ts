import Anthropic from "@anthropic-ai/sdk";


export const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-opus-5";

let client: Anthropic | null = null;

export function aiConfigured(): boolean {
  const key = process.env.ANTHROPIC_API_KEY ?? process.env.ANTHROPIC_AUTH_TOKEN ?? "";
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
