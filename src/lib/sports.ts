/**
 * Sport registry. ESPN exposes every sport at /sports/{espnSport}/{espnLeague}, and the payload
 * shape is identical for team sports. Tennis is the exception: its events are tournaments holding
 * groupings of individual matches, so it gets its own mapper (see sources/espn.ts).
 */
export type SportKind = "team" | "tennis";

export interface SportDef {
  key: string;
  espnSport: string;
  espnLeague: string;
  kind: SportKind;
  /** Group shown in the picker. */
  group: "basketball" | "soccer" | "tennis";
  label: { en: string; pt: string };
  /** Stat keys worth checking player history against for props. */
  propStats: string[];
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
    propStats: ["PTS", "REB", "AST", "3PT", "STL", "BLK", "TO", "MIN"],
    hasPlayerGamelog: true,
  },
  {
    key: "wnba",
    espnSport: "basketball",
    espnLeague: "wnba",
    kind: "team",
    group: "basketball",
    label: { en: "WNBA", pt: "WNBA" },
    propStats: ["PTS", "REB", "AST", "3PT", "STL", "BLK"],
    hasPlayerGamelog: true,
  },
  {
    key: "soccer-bra",
    espnSport: "soccer",
    espnLeague: "bra.1",
    kind: "team",
    group: "soccer",
    label: { en: "Brasileirão Série A", pt: "Brasileirão Série A" },
    propStats: ["G", "A", "SH", "ST", "FC", "YC"],
    hasPlayerGamelog: true,
  },
  {
    key: "soccer-eng",
    espnSport: "soccer",
    espnLeague: "eng.1",
    kind: "team",
    group: "soccer",
    label: { en: "Premier League", pt: "Premier League" },
    propStats: ["G", "A", "SH", "ST", "FC", "YC"],
    hasPlayerGamelog: true,
  },
  {
    key: "soccer-esp",
    espnSport: "soccer",
    espnLeague: "esp.1",
    kind: "team",
    group: "soccer",
    label: { en: "La Liga", pt: "La Liga" },
    propStats: ["G", "A", "SH", "ST", "FC", "YC"],
    hasPlayerGamelog: true,
  },
  {
    key: "soccer-ucl",
    espnSport: "soccer",
    espnLeague: "uefa.champions",
    kind: "team",
    group: "soccer",
    label: { en: "Champions League", pt: "Liga dos Campeões" },
    propStats: ["G", "A", "SH", "ST", "FC", "YC"],
    hasPlayerGamelog: true,
  },
  {
    key: "soccer-lib",
    espnSport: "soccer",
    espnLeague: "conmebol.libertadores",
    kind: "team",
    group: "soccer",
    label: { en: "Copa Libertadores", pt: "Libertadores" },
    propStats: ["G", "A", "SH", "ST", "FC", "YC"],
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
    propStats: ["ACES", "DF", "1ST%", "BP"],
    hasPlayerGamelog: false,
  },
  {
    key: "tennis-wta",
    espnSport: "tennis",
    espnLeague: "wta",
    kind: "tennis",
    group: "tennis",
    label: { en: "WTA", pt: "WTA" },
    propStats: ["ACES", "DF", "1ST%", "BP"],
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
