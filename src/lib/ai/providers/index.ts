import { aiProviderName, type AiProvider, type ProviderName } from "@/lib/ai/provider";
import { anthropicProvider } from "@/lib/ai/providers/anthropic";
import { openaiProvider } from "@/lib/ai/providers/openai";

const PROVIDERS: Record<ProviderName, AiProvider> = {
  anthropic: anthropicProvider,
  openai: openaiProvider,
};

/** The provider `AI_PROVIDER` selects, read fresh so a test can flip it between cases. */
export function getProvider(env: Record<string, string | undefined> = process.env): AiProvider {
  return PROVIDERS[aiProviderName(env)];
}

export { anthropicProvider, openaiProvider };
