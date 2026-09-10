import { allMarkets, marketsFor, type MarketDef } from "@/lib/sports";
import type { HitRate, PlayerGame, PlayerHistory, PropRow } from "@/lib/types";

/**
 * Maps the loose market names these tools print onto ESPN gamelog stat labels.
 * Values are either a single label or a list to sum (PRA = points + rebounds + assists).
 */
const MARKET_MAP: { pattern: RegExp; labels: string[] }[] = [
  { pattern: /^(pts|points|pontos)$/i, labels: ["PTS"] },
  { pattern: /^(reb|rebounds|rebotes)$/i, labels: ["REB"] },
  { pattern: /^(ast|assists|assist[eê]ncias)$/i, labels: ["AST"] },
  { pattern: /(pra|p\+r\+a|points.*rebounds.*assists)/i, labels: ["PTS", "REB", "AST"] },
  { pattern: /(pr\b|points.*rebounds)/i, labels: ["PTS", "REB"] },
  { pattern: /(pa\b|points.*assists)/i, labels: ["PTS", "AST"] },
  { pattern: /(ra\b|rebounds.*assists)/i, labels: ["REB", "AST"] },
  { pattern: /(3pm|3-?point|three|triplos)/i, labels: ["3PT"] },
  { pattern: /^(stl|steals|roubos)$/i, labels: ["STL"] },
  { pattern: /^(blk|blocks|tocos)$/i, labels: ["BLK"] },
  { pattern: /(stocks|steals.*blocks)/i, labels: ["STL", "BLK"] },
  { pattern: /^(to|turnovers|erros)$/i, labels: ["TO"] },
  { pattern: /^(min|minutes|minutos)$/i, labels: ["MIN"] },
  { pattern: /^(g|goals|gols)$/i, labels: ["G"] },
  { pattern: /^(a|assists)$/i, labels: ["A"] },
  { pattern: /(shots on target|no alvo|sog)/i, labels: ["SOG"] },
  { pattern: /(shots|finaliza|chutes)/i, labels: ["SHOT"] },
  { pattern: /(fouls committed|faltas cometidas)/i, labels: ["FC"] },
  { pattern: /(fouls suffered|faltas sofridas)/i, labels: ["FA"] },
  { pattern: /(offside|impedimento)/i, labels: ["OF"] },
  { pattern: /(yellow|amarelo)/i, labels: ["YC"] },
  { pattern: /(red card|vermelho)/i, labels: ["RC"] },
  { pattern: /(any card|qualquer cart|cards|cart[õo]es)/i, labels: ["YC", "RC"] },
  { pattern: /(personal foul|faltas)/i, labels: ["PF"] },
];

function matchCatalogue(needle: string, markets: MarketDef[]): string[] | null {
  for (const m of markets) {
    if (!m.statLabels.length) continue;
    if (m.key === needle || m.label.en.toLowerCase() === needle || m.label.pt.toLowerCase() === needle) {
      return m.statLabels;
    }
  }
  return null;
}

/**
 * Market names collide across sports — "Assists" is AST in basketball but A in soccer, and both
 * sports have a fouls market. Resolution is therefore scoped to the sport whenever one is known;
 * the global catalogue and the regex list are only fallbacks.
 */
export function resolveStatLabels(market: string, sportKey?: string): string[] | null {
  const clean = market.trim();
  const needle = clean.toLowerCase();

  const scoped = matchCatalogue(needle, marketsFor(sportKey));
  if (scoped) return scoped;

  if (sportKey) {
    // A sport was named but the market is not in its catalogue: do not borrow another sport's stat.
    const sportMarkets = marketsFor(sportKey);
    if (sportMarkets.length) {
      for (const entry of MARKET_MAP) {
        if (!entry.pattern.test(clean)) continue;
        const belongs = sportMarkets.some(
          (m) => JSON.stringify(m.statLabels) === JSON.stringify(entry.labels),
        );
        if (belongs) return entry.labels;
      }
      return null;
    }
  }

  const global = matchCatalogue(needle, allMarkets());
  if (global) return global;
  for (const entry of MARKET_MAP) {
    if (entry.pattern.test(clean)) return entry.labels;
  }
  return null;
}

/** ESPN prints made-attempted pairs like "4-7"; the made half is the one a prop settles on. */
function statValue(game: PlayerGame, label: string): number {
  const raw = game.stats[label];
  if (raw === undefined) return NaN;
  if (typeof raw === "number") return raw;
  const made = String(raw).match(/^(\d+(?:\.\d+)?)-/);
  if (made) return Number(made[1]);
  const num = Number(raw);
  return Number.isFinite(num) ? num : NaN;
}

function total(game: PlayerGame, labels: string[]): number {
  let sum = 0;
  for (const label of labels) {
    const value = statValue(game, label);
    if (!Number.isFinite(value)) return NaN;
    sum += value;
  }
  return sum;
}

function median(values: number[]): number {
  if (!values.length) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function tally(values: number[], line: number, side: "over" | "under") {
  // A push (exactly on the line) counts as neither hit nor miss; whole-number lines can push.
  const decided = values.filter((v) => v !== line);
  const hits = decided.filter((v) => (side === "over" ? v > line : v < line)).length;
  return { hits, of: decided.length };
}

/**
 * Measures a prop line against real game logs. This is deliberately independent of whatever hit
 * rate the source tool advertised — if the two disagree, that disagreement is itself a signal.
 */
export function measureProp(
  history: PlayerHistory,
  market: string,
  line: number,
  side: "over" | "under" = "over",
  sportKey?: string,
): HitRate | null {
  const labels = resolveStatLabels(market, sportKey);
  if (!labels || !Number.isFinite(line)) return null;

  const values = history.games
    .map((g) => total(g, labels))
    .filter((v) => Number.isFinite(v));
  if (values.length < 3) return null;

  const last5 = tally(values.slice(0, 5), line, side);
  const last10 = tally(values.slice(0, 10), line, side);
  const season = tally(values, line, side);
  const average = values.reduce((a, b) => a + b, 0) / values.length;

  // Season rate is the widest sample, so it is the fair-probability input for pricing.
  const impliedFair = season.of > 0 ? season.hits / season.of : NaN;
  const pushes = values.length - season.of;

  return {
    stat: labels.join("+"),
    line,
    side,
    last5,
    last10,
    season,
    average: Number(average.toFixed(2)),
    median: median(values),
    impliedFair,
    sampleNote: [
      `${values.length} games logged`,
      pushes > 0 ? `${pushes} push${pushes === 1 ? "" : "es"} excluded` : "",
      values.length < 10 ? "small sample — treat the rate as weak evidence" : "",
    ]
      .filter(Boolean)
      .join(" · "),
  };
}

function normalise(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z\s]/g, "")
    .trim();
}

/** Tolerates "P. Banchero" / "Paolo Banchero" / casing differences between sources. */
export function matchAthlete(
  player: string,
  athletes: { name: string; id: string }[],
): { name: string; id: string } | null {
  const target = normalise(player);
  if (!target) return null;

  const exact = athletes.find((a) => normalise(a.name) === target);
  if (exact) return exact;

  const targetParts = target.split(/\s+/);
  const lastName = targetParts[targetParts.length - 1];
  const firstInitial = targetParts[0]?.[0];

  const candidates = athletes.filter((a) => {
    const parts = normalise(a.name).split(/\s+/);
    return parts[parts.length - 1] === lastName;
  });
  if (candidates.length === 1) return candidates[0];
  if (candidates.length > 1 && firstInitial) {
    const byInitial = candidates.filter((a) => normalise(a.name)[0] === firstInitial);
    if (byInitial.length === 1) return byInitial[0];
  }
  return null;
}

export function attachMeasurement(
  row: PropRow,
  history: PlayerHistory | null,
  sportKey?: string,
): PropRow {
  if (!history || row.line === undefined) return { ...row, measured: null };
  const side = row.side === "under" ? "under" : "over";
  return { ...row, measured: measureProp(history, row.market, row.line, side, sportKey) };
}
