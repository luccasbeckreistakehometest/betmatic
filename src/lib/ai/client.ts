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
