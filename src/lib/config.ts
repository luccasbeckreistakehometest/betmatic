import fs from "node:fs";
import path from "node:path";

/** Named sites have bespoke handling; any other string is an extraSources key. */
export type SiteKey = string;

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
  /**
   * What this source actually publishes. Books and prop tools post player lines; analysis sites
   * post recommendations. Running the wrong extractor wastes a call and returns nothing usable.
   */
  kind?: "props" | "picks";
  /** Free sources read fine without a saved session; paid tools do not. */
  requiresLogin: boolean;
  loginUrl: string;
  /** Page holding the data. `{team}`, `{opponent}`, `{date}` and `{gameId}` are substituted. */
  targetUrl: string;
  /**
   * Per-sport pages. When present, a sport missing from this map is treated as unsupported and the
   * source is skipped — scraping an NBA page for a soccer game costs an extraction to learn nothing.
   */
  sportUrls?: Record<string, string>;
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
  /** Open-ended: add a key here and it is gathered with no code change. */
  extraSources?: Record<string, ScrapeSourceConfig>;
}

export function listExtraSources(cfg: SourcesConfig): { key: string; config: ScrapeSourceConfig }[] {
  return Object.entries(cfg.extraSources ?? {})
    .filter(([, config]) => config.enabled)
    .map(([key, config]) => ({ key, config }));
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

/** Returns null when the source does not cover this sport. */
export function resolveTargetUrl(cfg: ScrapeSourceConfig, sportKey: string): string | null {
  if (!cfg.sportUrls) return cfg.targetUrl;
  return cfg.sportUrls[sportKey] ?? null;
}

export function fillTemplate(
  template: string,
  vars: Record<string, string | undefined>,
): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) =>
    encodeURIComponent(vars[key] ?? ""),
  );
}
