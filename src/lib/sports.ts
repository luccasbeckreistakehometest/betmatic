/**
 * Sport registry. ESPN exposes every sport at /sports/{espnSport}/{espnLeague}, and the payload
 * shape is identical for team sports. Tennis is the exception: its events are tournaments holding
 * groupings of individual matches, so it gets its own mapper (see sources/espn.ts).
 */
export type SportKind = "team" | "tennis";

/** One bettable player market, tied to the exact ESPN gamelog labels it settles on. */
export interface MarketDef {
  key: string;
  label: { en: string; pt: string };
  /** Gamelog labels to sum. Verified against live ESPN payloads. */
  statLabels: string[];
  /** Yes/no markets settle at 0.5 rather than around a median. */
  binary?: boolean;
}

const BASKETBALL_MARKETS: MarketDef[] = [
  { key: "points", label: { en: "Points", pt: "Pontos" }, statLabels: ["PTS"] },
  { key: "rebounds", label: { en: "Rebounds", pt: "Rebotes" }, statLabels: ["REB"] },
  { key: "assists", label: { en: "Assists", pt: "Assistências" }, statLabels: ["AST"] },
  { key: "threes", label: { en: "3-Pointers Made", pt: "Bolas de 3" }, statLabels: ["3PT"] },
  { key: "steals", label: { en: "Steals", pt: "Roubos de bola" }, statLabels: ["STL"] },
  { key: "blocks", label: { en: "Blocks", pt: "Tocos" }, statLabels: ["BLK"] },
  { key: "turnovers", label: { en: "Turnovers", pt: "Erros" }, statLabels: ["TO"] },
  { key: "fouls", label: { en: "Personal Fouls", pt: "Faltas pessoais" }, statLabels: ["PF"] },
  { key: "minutes", label: { en: "Minutes", pt: "Minutos" }, statLabels: ["MIN"] },
  { key: "pra", label: { en: "Points + Rebounds + Assists", pt: "Pontos + Rebotes + Assistências" }, statLabels: ["PTS", "REB", "AST"] },
  { key: "pr", label: { en: "Points + Rebounds", pt: "Pontos + Rebotes" }, statLabels: ["PTS", "REB"] },
  { key: "pa", label: { en: "Points + Assists", pt: "Pontos + Assistências" }, statLabels: ["PTS", "AST"] },
  { key: "ra", label: { en: "Rebounds + Assists", pt: "Rebotes + Assistências" }, statLabels: ["REB", "AST"] },
  { key: "stocks", label: { en: "Steals + Blocks", pt: "Roubos + Tocos" }, statLabels: ["STL", "BLK"] },
];

// Labels verified against a live ESPN soccer gamelog: G,A,SHOT,SOG,FC,FA,OF,YC,RC.
const SOCCER_MARKETS: MarketDef[] = [
  { key: "goals", label: { en: "Goals", pt: "Gols" }, statLabels: ["G"] },
  { key: "assists", label: { en: "Assists", pt: "Assistências" }, statLabels: ["A"] },
  { key: "goal_involvement", label: { en: "Goals + Assists", pt: "Gols + Assistências" }, statLabels: ["G", "A"] },
  { key: "shots", label: { en: "Shots", pt: "Finalizações" }, statLabels: ["SHOT"] },
  { key: "shots_on_target", label: { en: "Shots on Target", pt: "Finalizações no alvo" }, statLabels: ["SOG"] },
  { key: "fouls_committed", label: { en: "Fouls Committed", pt: "Faltas cometidas" }, statLabels: ["FC"] },
  { key: "fouls_suffered", label: { en: "Fouls Suffered", pt: "Faltas sofridas" }, statLabels: ["FA"] },
  { key: "offsides", label: { en: "Offsides", pt: "Impedimentos" }, statLabels: ["OF"] },
  { key: "yellow_card", label: { en: "Yellow Card", pt: "Cartão amarelo" }, statLabels: ["YC"], binary: true },
  { key: "red_card", label: { en: "Red Card", pt: "Cartão vermelho" }, statLabels: ["RC"], binary: true },
  { key: "cards", label: { en: "Any Card", pt: "Qualquer cartão" }, statLabels: ["YC", "RC"], binary: true },
];

// ESPN publishes no per-match gamelog for tennis, so these are labels only — never measured.
const TENNIS_MARKETS: MarketDef[] = [
  { key: "aces", label: { en: "Aces", pt: "Aces" }, statLabels: [] },
  { key: "double_faults", label: { en: "Double Faults", pt: "Duplas faltas" }, statLabels: [] },
  { key: "sets", label: { en: "Total Sets", pt: "Total de sets" }, statLabels: [] },
  { key: "games", label: { en: "Total Games", pt: "Total de games" }, statLabels: [] },
];

export interface SportDef {
  key: string;
  espnSport: string;
  espnLeague: string;
  kind: SportKind;
  /** Group shown in the picker. */
  group: "basketball" | "soccer" | "tennis";
  label: { en: string; pt: string };
  /** Bettable player markets for this sport. */
  markets: MarketDef[];
  /** ESPN gamelog is only published for some leagues. */
  hasPlayerGamelog: boolean;
}

export const SPORTS: SportDef[] = [
  {
    key: "nba",
    espnSport: "basketball",
    espnLeague: "nba",
    kind: "team",
    group: "basketball",
    label: { en: "NBA", pt: "NBA" },
    markets: BASKETBALL_MARKETS,
    hasPlayerGamelog: true,
  },
  {
    key: "wnba",
    espnSport: "basketball",
    espnLeague: "wnba",
    kind: "team",
    group: "basketball",
    label: { en: "WNBA", pt: "WNBA" },
    markets: BASKETBALL_MARKETS,
    hasPlayerGamelog: true,
  },
  {
    key: "soccer-bra",
    espnSport: "soccer",
    espnLeague: "bra.1",
    kind: "team",
    group: "soccer",
    label: { en: "Brasileirão Série A", pt: "Brasileirão Série A" },
    markets: SOCCER_MARKETS,
    hasPlayerGamelog: true,
  },
  {
    key: "soccer-eng",
    espnSport: "soccer",
    espnLeague: "eng.1",
    kind: "team",
    group: "soccer",
    label: { en: "Premier League", pt: "Premier League" },
    markets: SOCCER_MARKETS,
    hasPlayerGamelog: true,
  },
  {
    key: "soccer-esp",
    espnSport: "soccer",
    espnLeague: "esp.1",
    kind: "team",
    group: "soccer",
    label: { en: "La Liga", pt: "La Liga" },
    markets: SOCCER_MARKETS,
    hasPlayerGamelog: true,
  },
  {
    key: "soccer-ucl",
    espnSport: "soccer",
    espnLeague: "uefa.champions",
    kind: "team",
    group: "soccer",
    label: { en: "Champions League", pt: "Liga dos Campeões" },
    markets: SOCCER_MARKETS,
    hasPlayerGamelog: true,
  },
  {
    key: "soccer-lib",
    espnSport: "soccer",
    espnLeague: "conmebol.libertadores",
    kind: "team",
    group: "soccer",
    label: { en: "Copa Libertadores", pt: "Libertadores" },
    markets: SOCCER_MARKETS,
    hasPlayerGamelog: true,
  },
  {
    key: "tennis-atp",
    espnSport: "tennis",
    espnLeague: "atp",
    kind: "tennis",
    group: "tennis",
    label: { en: "ATP", pt: "ATP" },
    // ESPN publishes no per-match gamelog for tennis; history comes from the match feed itself.
    markets: TENNIS_MARKETS,
    hasPlayerGamelog: false,
  },
  {
    key: "tennis-wta",
    espnSport: "tennis",
    espnLeague: "wta",
    kind: "tennis",
    group: "tennis",
    label: { en: "WTA", pt: "WTA" },
    markets: TENNIS_MARKETS,
    hasPlayerGamelog: false,
  },
];

export const DEFAULT_SPORT = "nba";

export function getSport(key: string | undefined): SportDef {
  return SPORTS.find((s) => s.key === key) ?? SPORTS.find((s) => s.key === DEFAULT_SPORT)!;
}

export function sportsByGroup(): Record<string, SportDef[]> {
  return SPORTS.reduce<Record<string, SportDef[]>>((acc, sport) => {
    (acc[sport.group] ??= []).push(sport);
    return acc;
  }, {});
}

/** Flattened catalogue for the market-name resolver. */
/** Markets for one sport, used to disambiguate names that collide across sports. */
export function marketsFor(sportKey: string | undefined): MarketDef[] {
  if (!sportKey) return [];
  return SPORTS.find((s) => s.key === sportKey)?.markets ?? [];
}

export function allMarkets(): MarketDef[] {
  const seen = new Map<string, MarketDef>();
  for (const sport of SPORTS) for (const m of sport.markets) if (!seen.has(m.key)) seen.set(m.key, m);
  return [...seen.values()];
}

export function marketCatalogue(sport: SportDef, lang: "pt" | "en"): string {
  return sport.markets
    .map((m) => `- ${m.label[lang]}${m.binary ? " (yes/no)" : ""}${m.statLabels.length ? "" : " [no measurable history]"}`)
    .join("\n");
}
