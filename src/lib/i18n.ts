export type Lang = "pt" | "en";

export const LANGS: { key: Lang; label: string; flag: string }[] = [
  { key: "pt", label: "Português", flag: "BR" },
  { key: "en", label: "English", flag: "EN" },
];

export function normaliseLang(value: string | undefined | null): Lang {
  return value === "en" ? "en" : "pt";
}

const DICT = {
  slate: { pt: "Jogos", en: "Slate" },
  slateHint: {
    pt: "escolha um jogo para reunir notícias, props e picks.",
    en: "pick a game to gather insider reporting, props and picks.",
  },
  game: { pt: "jogo", en: "game" },
  games: { pt: "jogos", en: "games" },
  noGamesOn: { pt: "Sem jogos em", en: "No games on" },
  showingNearest: { pt: "mostrando a data mais próxima", en: "showing the nearest slate" },
  noGamesNearby: { pt: "Nenhum jogo encontrado perto desta data.", en: "No games found near this date." },
  backToSlate: { pt: "← Jogos", en: "← Slate" },
  spread: { pt: "Handicap", en: "Spread" },
  total: { pt: "Total", en: "Total" },
  moneyline: { pt: "Vencedor", en: "ML" },
  injuryReport: { pt: "Lesões", en: "Injury report" },
  market: { pt: "Mercado", en: "Market" },
  book: { pt: "Casa", en: "Book" },
  leaders: { pt: "Destaques", en: "Leaders" },
  teamStats: { pt: "Estatísticas", en: "Team stats" },
  seasonSeries: { pt: "Confrontos", en: "Season series" },
  noInjuries: { pt: "Nenhuma lesão listada.", en: "No injuries listed." },
  noLines: { pt: "Nenhuma linha publicada para este jogo ainda.", en: "No book lines published for this game yet." },
  againstSpread: { pt: "Contra o handicap", en: "Against the spread" },

  regatherAll: { pt: "Buscar tudo de novo", en: "Re-gather all sources" },
  gathering: { pt: "Buscando…", en: "Gathering…" },
  gatheringHint: {
    pt: "cada fonte abre um navegador real, isso leva um tempo",
    en: "scrapes launch a real browser per source, this takes a while",
  },
  refresh: { pt: "atualizar", en: "refresh" },

  synthesisBrief: { pt: "Resumo", en: "Synthesis brief" },
  insiderReporting: { pt: "Notícias · X", en: "Insider reporting · X" },
  playerProps: { pt: "Props de jogador · PropsCash", en: "Player props · PropsCash" },
  publishedPicks: { pt: "Picks · Mama Knows Bets", en: "Published picks · Mama Knows Bets" },
  modelProjections: { pt: "Projeções · Dimers", en: "Model projections · Dimers" },
  betBuilder: { pt: "Apostas sugeridas", en: "Suggested bets" },

  noBriefYet: { pt: "Ainda sem resumo.", en: "No brief yet." },
  waitingSources: { pt: "Aguardando as outras fontes…", en: "Waiting on the other sources…" },
  nothingFromX: { pt: "Nada relevante encontrado no X.", en: "Nothing relevant found on X." },
  noProps: { pt: "Nenhum prop para este confronto.", en: "No prop rows for this matchup." },
  noPicks: { pt: "Nenhum pick para este confronto.", en: "No picks for this matchup." },
  noProjections: { pt: "Nenhuma projeção para este confronto.", en: "No projections for this matchup." },
  noBets: { pt: "Nenhuma aposta pôde ser montada com os dados disponíveis.", en: "No tickets could be built from the available data." },

  injuryWatch: { pt: "Atenção a lesões", en: "Injury watch" },
  conflicts: { pt: "Fontes divergentes", en: "Source conflicts" },
  notCovered: { pt: "Não coberto", en: "Not covered" },

  player: { pt: "Jogador", en: "Player" },
  line: { pt: "Linha", en: "Line" },
  side: { pt: "Lado", en: "Side" },
  odds: { pt: "Odds", en: "Odds" },
  projection: { pt: "Proj", en: "Proj" },
  edge: { pt: "Edge", en: "Edge" },
  measured: { pt: "Medido (L5/L10/temp)", en: "Measured (L5/L10/season)" },
  season: { pt: "temp", en: "season" },
  noGamelog: { pt: "sem histórico", en: "no game log" },

  background: { pt: "Contexto", en: "Background" },
  legs: { pt: "Pernas", en: "Legs" },
  combined: { pt: "Combinada", en: "Combined" },
  impliedChance: { pt: "Chance implícita", en: "Implied chance" },
  modelledChance: { pt: "Chance estimada", en: "Modelled chance" },
  evLabel: { pt: "EV", en: "EV" },
  risk: { pt: "Risco", en: "Risk" },
  single: { pt: "Simples", en: "Single" },
  parlay: { pt: "Múltipla", en: "Parlay" },
  evidence: { pt: "Evidência", en: "Evidence" },

  oddsRange: { pt: "Faixa de odds", en: "Odds range" },
  sport: { pt: "Esporte", en: "Sport" },
  buildBets: { pt: "Montar apostas", en: "Build tickets" },

  loginNeeded: { pt: "precisa login", en: "login needed" },
  statusOk: { pt: "ok", en: "ok" },
  statusEmpty: { pt: "sem dados", en: "no data" },
  statusOff: { pt: "desligado", en: "off" },
  statusError: { pt: "erro", en: "error" },
  statusPending: { pt: "buscando…", en: "gathering…" },
  statusIdle: { pt: "parado", en: "idle" },

  disclaimer: {
    pt: "Ferramenta de pesquisa. Dados agregados podem estar errados, desatualizados ou em conflito — confirme a linha na sua casa antes de agir. Nada aqui é recomendação de aposta.",
    en: "Research tool. Aggregated data can be wrong, stale, or contradictory — verify a line at your book before acting on anything here. Nothing on this page is betting advice.",
  },
  responsible: {
    pt: "18+. Se apostar deixar de ser diversão, esse é o sinal de parar.",
    en: "21+ where applicable. If betting stops being fun, that's the signal to stop — 1-800-GAMBLER.",
  },
  longshotWarning: {
    pt: "Múltiplas longas são de baixa probabilidade e a margem da casa se acumula a cada perna. Os números abaixo mostram isso sem maquiagem.",
    en: "Long parlays are low-probability tickets and the book's margin compounds with every leg. The numbers below show that plainly.",
  },
} as const;

export type DictKey = keyof typeof DICT;

export function t(key: DictKey, lang: Lang): string {
  return DICT[key][lang];
}

export function makeT(lang: Lang) {
  return (key: DictKey) => t(key, lang);
}
