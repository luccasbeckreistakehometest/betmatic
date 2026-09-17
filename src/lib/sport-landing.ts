import type { Lang } from "@/lib/i18n";

/**
 * One funnel per sport. A basketball bettor and a soccer bettor are not the same person: the first
 * lives on player props, the second on cards and fouls. Generic copy converts neither.
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
      pt: "O jogo com mais linha de jogador do mundo.",
      en: "The deepest player-prop board in sport.",
    },
    sub: {
      pt: "Cada partida da NBA e da WNBA tem dezenas de linhas por atleta. A gente calcula, jogo a jogo, quantas vezes cada uma bateu — e mostra antes de você apostar.",
      en: "Every NBA and WNBA game posts dozens of lines per player. We compute, game by game, how often each has hit — and show it before you bet.",
    },
    angle: {
      pt: [
        {
          title: "Últimos 5, últimos 10, temporada",
          body: "Não é média. É a contagem de quantos jogos passaram da linha, com o tamanho da amostra ao lado. Quando os últimos 10 discordam da temporada, isso aparece.",
        },
        {
          title: "Combinações que esticam o bilhete",
          body: "Pontos+Rebotes+Assistências, Roubos+Tocos, e as duplas. São elas que levam uma múltipla de 2x para 20x sem precisar de zebra.",
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
          title: "Combos that lengthen a slip",
          body: "PRA, steals+blocks, and the two-way pairs. These take a parlay from 2x to 20x without needing an upset.",
        },
        {
          title: "Injuries move it, and fast",
          body: "One centre out reshuffles rebounds and paint touches for the whole team. The injury report feeds the maths, not just the headline.",
        },
      ],
    },
    marketsTitle: { pt: "Mercados medidos", en: "Measured markets" },
    markets: {
      pt: ["Pontos", "Rebotes", "Assistências", "Bolas de 3", "Roubos", "Tocos", "Erros", "Faltas", "Minutos", "Pts+Reb+Ass", "Roubos+Tocos"],
      en: ["Points", "Rebounds", "Assists", "3PM", "Steals", "Blocks", "Turnovers", "Fouls", "Minutes", "PRA", "Steals+Blocks"],
    },
    leagues: ["NBA", "WNBA"],
    cta: { pt: "Ver os jogos de hoje", en: "See today's games" },
    meta: {
      pt: "Palpites de NBA e WNBA com histórico medido jogo a jogo. Pontos, rebotes, assistências e combinações, com a chance real de cada linha.",
      en: "NBA and WNBA picks with history measured game by game. Points, rebounds, assists and combos, each with its real probability.",
    },
  },
  {
    slug: { pt: "futebol", en: "soccer" },
    sportKeys: ["soccer-bra", "soccer-eng", "soccer-esp", "soccer-ucl", "soccer-lib"],
    name: { pt: "Futebol", en: "Soccer" },
    title: {
      pt: "O dinheiro não está no resultado. Está no cartão.",
      en: "The value is not in the result. It is in the card.",
    },
    sub: {
      pt: "Resultado de jogo paga pouco e todo mundo aposta. Falta, cartão, impedimento e finalização no alvo pagam bem — e quase ninguém checa o histórico do jogador nesses mercados. A gente checa.",
      en: "Match result pays little and everyone plays it. Fouls, cards, offsides and shots on target pay properly — and almost nobody checks the player's history there. We do.",
    },
    angle: {
      pt: [
        {
          title: "Cartão tem padrão, e o padrão é medível",
          body: "Volante que comete cinco faltas por jogo não leva cartão por azar. Puxamos o histórico de faltas e cartões partida a partida e mostramos a frequência real.",
        },
        {
          title: "Brasileirão, Premier League, Libertadores",
          body: "Cobrimos as ligas que você acompanha, com o mesmo rigor. Sem tratar campeonato brasileiro como categoria de segunda.",
        },
        {
          title: "Finalização no alvo separa quem chuta de quem acerta",
          body: "Muito atacante bate na linha de finalizações e não chega perto da linha de no alvo. São mercados diferentes e a gente mede os dois.",
        },
      ],
      en: [
        {
          title: "Cards follow a pattern, and patterns are measurable",
          body: "A midfielder committing five fouls a game is not booked by luck. We pull fouls and cards match by match and show the real frequency.",
        },
        {
          title: "Premier League, La Liga, Champions, Brasileirão",
          body: "The leagues you actually follow, all held to the same standard.",
        },
        {
          title: "Shots on target separates shooters from finishers",
          body: "Plenty of forwards clear the shots line and never come close to the on-target line. Different markets, and we measure both.",
        },
      ],
    },
    marketsTitle: { pt: "Mercados medidos", en: "Measured markets" },
    markets: {
      pt: ["Gols", "Assistências", "Gols+Assistências", "Finalizações", "No alvo", "Faltas cometidas", "Faltas sofridas", "Impedimentos", "Cartão amarelo", "Cartão vermelho"],
      en: ["Goals", "Assists", "Goals+Assists", "Shots", "On target", "Fouls committed", "Fouls suffered", "Offsides", "Yellow card", "Red card"],
    },
    leagues: ["Brasileirão", "Premier League", "La Liga", "Champions", "Libertadores"],
    cta: { pt: "Ver os jogos de hoje", en: "See today's matches" },
    meta: {
      pt: "Palpites de futebol com histórico medido: cartões, faltas, finalizações no alvo e impedimentos no Brasileirão, Premier League e Libertadores.",
      en: "Soccer picks with measured history: cards, fouls, shots on target and offsides across the Premier League, La Liga and Champions League.",
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
