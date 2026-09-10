import fs from "node:fs";
import path from "node:path";

export type SiteKey = "x" | "propscash" | "mamaknowsbets" | "dimers";

export interface Insider {
  handle: string;
  label?: string;
  tier?: "tier1" | "tier2" | "beat" | "aggregator";
  enabled?: boolean;
}

export interface XConfig {
  enabled: boolean;
  loginUrl: string;
  searchUrl: string;
  insiders: Insider[];
  lookbackHours: number;
  handlesPerQuery: number;
  maxTweetsPerQuery: number;
}

export interface ScrapeSourceConfig {
  enabled: boolean;
  label: string;
  /** Free sources read fine without a saved session; paid tools do not. */
  requiresLogin: boolean;
  loginUrl: string;
  /** Page holding the data. `{team}`, `{opponent}`, `{date}` and `{gameId}` are substituted. */
  targetUrl: string;
  /** Optional second page checked when the first yields nothing. */
  fallbackUrl?: string;
  waitForSelector?: string;
  loggedOutSelector?: string;
  scrollPasses: number;
  captureNetworkJson: boolean;
  useVision: boolean;
  extractionHint: string;
}

export interface SourcesConfig {
  x: XConfig;
  propscash: ScrapeSourceConfig;
  mamaknowsbets: ScrapeSourceConfig;
  dimers: ScrapeSourceConfig;
}

let cachedConfig: SourcesConfig | null = null;

export function loadConfig(): SourcesConfig {
  if (cachedConfig) return cachedConfig;
  const file = path.join(process.cwd(), "config", "sources.json");
  cachedConfig = JSON.parse(fs.readFileSync(file, "utf8")) as SourcesConfig;
  return cachedConfig;
}

export function activeInsiders(cfg: XConfig): Insider[] {
  return cfg.insiders.filter((i) => i.enabled !== false);
}

/** Split handles into batches — X search queries have a practical length limit. */
export function batchHandles(insiders: Insider[], perQuery: number): Insider[][] {
  const batches: Insider[][] = [];
  for (let i = 0; i < insiders.length; i += perQuery) {
    batches.push(insiders.slice(i, i + perQuery));
  }
  return batches;
}

export function fillTemplate(
  template: string,
  vars: Record<string, string | undefined>,
): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) =>
    encodeURIComponent(vars[key] ?? ""),
  );
}
