import { z } from "zod";
import { fillTemplate, resolveTargetUrl, type ScrapeSourceConfig, type SiteKey } from "@/lib/config";
import { NeedsLoginError, capturePage } from "@/lib/browser/session";
import { extractFromCapture, lastUsage } from "@/lib/ai/extract";
import { AiNotConfiguredError, describeAiError } from "@/lib/ai/client";
import type { Game, PickRow, PropRow, SourceResult } from "@/lib/types";

const nullableString = () => z.string().nullable();
const nullableNumber = () => z.number().nullable();

const PropsSchema = z.object({
  dataFound: z.boolean().describe("False when the page showed a login wall, a paywall, or no prop rows."),
  blockedReason: nullableString().describe("Why nothing was extracted, when dataFound is false."),
  props: z.array(
    z.object({
      player: z.string(),
      team: nullableString(),
      market: z.string().describe("e.g. Points, Rebounds, Assists, PRA, 3PM, Steals+Blocks"),
      line: nullableNumber(),
      side: z.enum(["over", "under", "yes", "no", "unknown"]),
      odds: nullableString().describe("American price exactly as shown, e.g. -115"),
      book: nullableString(),
      projection: nullableNumber().describe("The tool's own projection. Null if the page shows none."),
      edgePct: nullableNumber().describe("The tool's edge/value/EV percentage as a number."),
      hitRate: nullableString().describe("Any hit-rate or L10/L5 split shown, verbatim."),
      note: nullableString(),
    }),
  ),
  notes: z.array(z.string()).describe("Page-level context worth surfacing: model version, timestamps, warnings."),
});

const PicksSchema = z.object({
  dataFound: z.boolean(),
  blockedReason: nullableString(),
  picks: z.array(
    z.object({
      label: z.string().describe("Short name for the pick, e.g. 'Lakers -4.5'"),
      market: z.string().describe("spread | total | moneyline | player prop | parlay | other"),
      selection: z.string().describe("The exact selection including its number."),
      odds: nullableString(),
      book: nullableString(),
      confidence: nullableString().describe("Stated confidence, units, or star rating — verbatim."),
      rationale: nullableString().describe("One line drawn from the page's own reasoning."),
    }),
  ),
  notes: z.array(z.string()),
});

function clean<T extends Record<string, unknown>>(row: T): T {
  // Strict structured outputs use null for "absent"; the UI expects undefined.
  return Object.fromEntries(Object.entries(row).map(([k, v]) => [k, v === null ? undefined : v])) as T;
}

function gameVars(game: Game): Record<string, string> {
  return {
    gameId: game.id,
    team: game.home.abbreviation,
    opponent: game.away.abbreviation,
    homeTeam: game.home.displayName,
    awayTeam: game.away.displayName,
    date: game.startsAt.slice(0, 10),
  };
}

function gameContext(game: Game): string {
  return [
    `Matchup: ${game.away.displayName} (${game.away.abbreviation}) at ${game.home.displayName} (${game.home.abbreviation})`,
    `Tipoff (UTC): ${game.startsAt}`,
    game.odds?.details ? `Market: ${game.odds.details}, total ${game.odds.overUnder ?? "n/a"}` : "",
    "Keep only rows tied to these two teams. If the page covers the full slate, filter to this matchup.",
  ]
    .filter(Boolean)
    .join("\n");
}

export class UnsupportedSportError extends Error {
  constructor(label: string, sportKey: string) {
    super(`${label} does not cover ${sportKey} — no page configured for this sport.`);
    this.name = "UnsupportedSportError";
  }
}

function nowIso() {
  return new Date().toISOString();
}

function toResult<T>(source: string, error: unknown): SourceResult<T> {
  if (error instanceof UnsupportedSportError) {
    return { source, status: "disabled", data: null, error: error.message, fetchedAt: nowIso() };
  }
  if (error instanceof NeedsLoginError) {
    return { source, status: "needs-login", data: null, error: error.message, fetchedAt: nowIso() };
  }
  if (error instanceof AiNotConfiguredError) {
    return { source, status: "error", data: null, error: error.message, fetchedAt: nowIso() };
  }
  return {
    source,
    status: "error",
    data: null,
    error: describeAiError(error) ?? (error instanceof Error ? error.message : String(error)),
    fetchedAt: nowIso(),
  };
}

async function captureFor(site: SiteKey, cfg: ScrapeSourceConfig, game: Game) {
  const options = {
    waitForSelector: cfg.waitForSelector,
    // An open source has no signed-out state to detect, so the check is skipped entirely.
    loggedOutSelector: cfg.requiresLogin ? cfg.loggedOutSelector : undefined,
    scrollPasses: cfg.scrollPasses,
    captureNetworkJson: cfg.captureNetworkJson,
    screenshot: cfg.useVision,
    requireSession: cfg.requiresLogin,
  };
  const target = resolveTargetUrl(cfg, game.sportKey);
  if (!target) throw new UnsupportedSportError(cfg.label, game.sportKey);
  const primary = fillTemplate(target, gameVars(game));
  const capture = await capturePage(site, primary, options);

  const thin = capture.text.trim().length < 400 && capture.apiPayloads.length === 0;
  if (thin && cfg.fallbackUrl) {
    return capturePage(site, fillTemplate(cfg.fallbackUrl, gameVars(game)), options);
  }
  return capture;
}

export async function fetchProps(
  site: SiteKey,
  cfg: ScrapeSourceConfig,
  game: Game,
): Promise<SourceResult<{ props: PropRow[]; notes: string[] }>> {
  const source = cfg.label;
  if (!cfg.enabled) {
    return { source, status: "disabled", data: null, fetchedAt: nowIso() };
  }
  try {
    const capture = await captureFor(site, cfg, game);
    if (!capture.loggedIn) {
      return {
        source,
        status: "needs-login",
        data: null,
        error: `The page rendered a signed-out view — the saved session expired. Run: pnpm login ${site}`,
        fetchedAt: nowIso(),
        meta: { finalUrl: capture.finalUrl },
      };
    }

    const extracted = await extractFromCapture({
      schema: PropsSchema,
      capture,
      instructions: cfg.extractionHint,
      context: gameContext(game),
      useVision: cfg.useVision,
    });

    if (!extracted.dataFound || extracted.props.length === 0) {
      return {
        source,
        status: "empty",
        data: { props: [], notes: extracted.notes },
        error: extracted.blockedReason ?? "No prop rows found for this matchup on the configured page.",
        fetchedAt: nowIso(),
        meta: { finalUrl: capture.finalUrl, jsonResponses: capture.apiPayloads.length },
      };
    }

    return {
      source,
      status: "ok",
      data: {
        props: extracted.props.map((p) => clean(p) as PropRow),
        notes: extracted.notes,
      },
      fetchedAt: nowIso(),
      meta: { finalUrl: capture.finalUrl, jsonResponses: capture.apiPayloads.length, usage: lastUsage },
    };
  } catch (error) {
    return toResult(source, error);
  }
}

export async function fetchPicks(
  site: SiteKey,
  cfg: ScrapeSourceConfig,
  game: Game,
): Promise<SourceResult<{ picks: PickRow[]; notes: string[] }>> {
  const source = cfg.label;
  if (!cfg.enabled) {
    return { source, status: "disabled", data: null, fetchedAt: nowIso() };
  }
  try {
    const capture = await captureFor(site, cfg, game);
    if (!capture.loggedIn) {
      return {
        source,
        status: "needs-login",
        data: null,
        error: `The page rendered a signed-out view — the saved session expired. Run: pnpm login ${site}`,
        fetchedAt: nowIso(),
        meta: { finalUrl: capture.finalUrl },
      };
    }

    const extracted = await extractFromCapture({
      schema: PicksSchema,
      capture,
      instructions: cfg.extractionHint,
      context: gameContext(game),
      useVision: cfg.useVision,
    });

    if (!extracted.dataFound || extracted.picks.length === 0) {
      return {
        source,
        status: "empty",
        data: { picks: [], notes: extracted.notes },
        error: extracted.blockedReason ?? "No picks found for this matchup on the configured page.",
        fetchedAt: nowIso(),
        meta: { finalUrl: capture.finalUrl, jsonResponses: capture.apiPayloads.length },
      };
    }

    return {
      source,
      status: "ok",
      data: { picks: extracted.picks.map((p) => clean(p) as PickRow), notes: extracted.notes },
      fetchedAt: nowIso(),
      meta: { finalUrl: capture.finalUrl, jsonResponses: capture.apiPayloads.length },
    };
  } catch (error) {
    return toResult(source, error);
  }
}

export { toResult as toSourceError };
