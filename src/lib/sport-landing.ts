import type { Lang } from "@/lib/i18n";

/**
 * One funnel per sport. A basketball bettor and a soccer bettor are not the same person: the first
 * lives on player numbers, the second on cards and fouls. Generic copy converts neither.
 * Tickets only carry markets with a published price (result, handicap, totals); player history is
 * sold as analysis, never as a priced leg, until a player-market price source is wired in.
 */
export interface SportLanding {
  slug: { pt: string; en: string };
  sportKeys: string[];
  name: { pt: string; en: string };
  title: { pt: string; en: string };
  sub: { pt: string; en: string };
  angle: { pt: { title: string; body: string }[]; en: { title: string; body: string }[] };
  marketsTitle: { pt: string; en: string };
  markets: { pt: string[]; en: string[] };
  leagues: string[];
  cta: { pt: string; en: string };
  meta: { pt: string; en: string };
}

export const SPORT_LANDINGS: SportLanding[] = [
  {
    slug: { pt: "basquete", en: "basketball" },
    sportKeys: ["nba", "wnba"],
    name: { pt: "Basquete", en: "Basketball" },
    title: {
      pt: "Antes da linha, o histórico de quem vai jogar.",
      en: "Before the line, the record of who is playing.",
    },
    sub: {
      pt: "Na NBA e na WNBA, a gente mede jogo a jogo o que cada atleta produz e usa isso para montar bilhetes de resultado, handicap e total de pontos, só com odds publicadas.",
      en: "Across the NBA and WNBA we measure, game by game, what each player produces, and use it to build moneyline, spread and totals tickets, with published prices only.",
    },
    angle: {
      pt: [
        {
          title: "Últimos 5, últimos 10, temporada",
          body: "Não é média. É a contagem de quantos jogos passaram da linha, com o tamanho da amostra ao lado. Quando os últimos 10 discordam da temporada, isso aparece.",
        },
        {
          title: "Odd de verdade, não odd estimada",
          body: "Cada perna do bilhete tem uma odd publicada, e a odd combinada é conta feita no servidor, não chute do modelo. Se uma linha não tem preço, ela não entra.",
        },
        {
          title: "Lesão muda tudo, e muda rápido",
          body: "Um pivô fora reorganiza rebote e garrafão do time inteiro. O quadro de lesões entra no cálculo, não só na notícia.",
        },
      ],
      en: [
        {
          title: "Last 5, last 10, full season",
          body: "Not an average — a count of how many games cleared the line, with the sample size beside it. When the last 10 disagree with the season, you see that.",
        },
        {
          title: "Real prices, not estimated ones",
          body: "Every leg on a ticket has a published price, and the combined odds are computed on the server, not guessed by the model. A line without a price stays off the ticket.",
        },
        {
          title: "Injuries move it, and fast",
          body: "One centre out reshuffles rebounds and paint touches for the whole team. The injury report feeds the maths, not just the headline.",
        },
      ],
    },
    marketsTitle: { pt: "Números que entram na análise", en: "Numbers that feed the analysis" },
    markets: {
      pt: ["Pontos", "Rebotes", "Assistências", "Bolas de 3", "Roubos", "Tocos", "Erros", "Faltas", "Minutos", "Pts+Reb+Ass", "Roubos+Tocos"],
      en: ["Points", "Rebounds", "Assists", "3PM", "Steals", "Blocks", "Turnovers", "Fouls", "Minutes", "PRA", "Steals+Blocks"],
    },
    leagues: ["NBA", "WNBA"],
    cta: { pt: "Ver os jogos de hoje", en: "See today's games" },
    meta: {
      pt: "Palpites de NBA e WNBA com o histórico de cada jogador medido jogo a jogo e bilhetes só com odds publicadas, cada um com a chance estimada ao lado.",
      en: "NBA and WNBA picks built on each player's game-by-game history, with tickets that use published prices only and show the estimated chance of each.",
    },
  },
  {
    slug: { pt: "futebol", en: "soccer" },
    sportKeys: ["soccer-bra", "soccer-eng", "soccer-esp", "soccer-ucl", "soccer-lib"],
    name: { pt: "Futebol", en: "Soccer" },
    title: {
      pt: "Todo mundo olha o placar. A gente olha o detalhe.",
      en: "Everyone watches the score. We watch the detail.",
    },
    sub: {
      pt: "Faltas, cartões, impedimentos e finalizações de cada jogador, partida a partida, entram na leitura do jogo. O bilhete sai com resultado, handicap e total de gols, só com odds publicadas.",
      en: "Each player's fouls, cards, offsides and shots, match by match, feed the read of the game. Tickets come out on result, handicap and goal totals, with published prices only.",
    },
    angle: {
      pt: [
        {
          title: "Cartão tem padrão, e o padrão é medível",
          body: "Volante que comete cinco faltas por jogo não leva cartão por azar. Puxamos o histórico de faltas e cartões partida a partida e usamos a frequência real para ler o jogo.",
        },
        {
          title: "Brasileirão, Premier League, Libertadores",
          body: "Cobrimos as ligas que você acompanha, com o mesmo rigor. Sem tratar campeonato brasileiro como categoria de segunda.",
        },
        {
          title: "Finalização no alvo separa quem chuta de quem acerta",
          body: "Muito atacante finaliza bastante e acerta pouco. São números diferentes, e a gente mede os dois antes de montar o bilhete.",
        },
      ],
      en: [
        {
          title: "Cards follow a pattern, and patterns are measurable",
          body: "A midfielder committing five fouls a game is not booked by luck. We pull fouls and cards match by match and use the real frequency to read the game.",
        },
        {
          title: "Premier League, La Liga, Champions, Brasileirão",
          body: "The leagues you actually follow, all held to the same standard.",
        },
        {
          title: "Shots on target separates shooters from finishers",
          body: "Plenty of forwards shoot a lot and hit the target little. Different numbers, and we measure both before building a ticket.",
        },
      ],
    },
    marketsTitle: { pt: "Números que entram na análise", en: "Numbers that feed the analysis" },
    markets: {
      pt: ["Gols", "Assistências", "Gols+Assistências", "Finalizações", "No alvo", "Faltas cometidas", "Faltas sofridas", "Impedimentos", "Cartão amarelo", "Cartão vermelho"],
      en: ["Goals", "Assists", "Goals+Assists", "Shots", "On target", "Fouls committed", "Fouls suffered", "Offsides", "Yellow card", "Red card"],
    },
    leagues: ["Brasileirão", "Premier League", "La Liga", "Champions", "Libertadores"],
    cta: { pt: "Ver os jogos de hoje", en: "See today's matches" },
    meta: {
      pt: "Palpites de futebol com histórico medido de cartões, faltas e finalizações no Brasileirão, Premier League e Libertadores, e bilhetes só com odds publicadas.",
      en: "Soccer picks built on measured cards, fouls and shots across the Premier League, La Liga and Champions League, with tickets that use published prices only.",
    },
  },
];

export function findSportLanding(slug: string): { landing: SportLanding; lang: Lang } | null {
  for (const landing of SPORT_LANDINGS) {
    if (landing.slug.pt === slug) return { landing, lang: "pt" };
    if (landing.slug.en === slug) return { landing, lang: "en" };
  }
  return null;
}
