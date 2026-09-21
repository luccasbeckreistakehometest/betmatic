import { aiModels, aiConfigured, aiMockActive } from "@/lib/ai/client";
import { aiProviderName } from "@/lib/ai/provider";
import { getProvider } from "@/lib/ai/providers";

/**
 * A configured id matches an account's id exactly, or is the family of a dated snapshot
 * (`gpt-5.6-luna` ↔ `gpt-5.6-luna-2026-08-01`), in either direction.
 */
function known(configured: string, available: string): boolean {
  return configured === available || available.startsWith(`${configured}-`) || configured.startsWith(`${available}-`);
}

/** Configured ids the account does not list. Pure, so the matching rule is unit-tested. */
export function unknownModels(configured: string[], available: string[]): string[] {
  if (!available.length) return [];
  const seen = new Set<string>();
  return configured.filter((id) => {
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return !available.some((a) => known(id, a));
  });
}

export function modelWarning(provider: string, missing: string[]): string {
  return `AI_PROVIDER=${provider}: the account does not list ${missing.join(", ")}. ` +
    `Set the model ids to something GET /v1/models returns, or generation will fail with "model not found".`;
}

/**
 * Startup check: asks the provider what the account may run and shouts when a configured id is not
 * on the list. Never throws and never blocks the boot — a provider that cannot answer (no key, no
 * network) simply leaves the question open.
 */
export async function warnAboutUnknownModels(log: (message: string) => void = console.error): Promise<string[]> {
  if (aiMockActive() || !aiConfigured()) return [];
  const available = await getProvider().listModels();
  if (!available) return [];
  const models = aiModels();
  const missing = unknownModels([models.judgement, models.extraction, models.cheap, models.live], available);
  if (missing.length) {
    log(JSON.stringify({ ts: new Date().toISOString(), level: "error", scope: "ai.models", message: modelWarning(aiProviderName(), missing) }));
  }
  return missing;
}
