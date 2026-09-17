import type { Lang } from "@/lib/i18n";

/**
 * One funnel per sport. A basketball bettor and a soccer bettor are not the same person: the first
 * lives on player numbers, the second on cards and fouls. Generic copy converts neither.
 * Every leg on a ticket carries a published price. Player legs are priced from the book's posted
 * player lines (measured at that exact line); a player with no posted line stays in the analysis.
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
      pt: "Odd e minutagem em cada perna de jogador.",
      en: "A real price and real minutes behind every player leg.",
    },
    sub: {
      pt: "Na NBA e na WNBA, cada perna de jogador sai com a linha e o preço que a casa publicou e, do lado, quantas vezes ele passou dessa linha. Quem joga pouco nem entra. E no raio-x do jogador você vê como ele rende com e sem o companheiro.",
      en: "Across the NBA and WNBA, every player leg comes with the line and price the book posted and, next to it, how often he cleared that line. Players who barely play never make it. And the player deep dive shows how he does with and without a teammate.",
    },
    angle: {
      pt: [
        {
          title: "Últimos 5, últimos 10, temporada",
          body: "Não é média. É a contagem de quantos jogos passaram da linha, com o tamanho da amostra ao lado. Quando os últimos 10 discordam da temporada, isso aparece.",
        },
        {
          title: "Minutagem antes de tudo",
          body: "Matchup bom não vale nada pra quem fica 12 minutos em quadra. Antes de qualquer perna, a gente confere minutos e papel no time; quem joga pouco sai da lista.",
        },
        {
          title: "Com e sem o companheiro",
          body: "Escolha um companheiro de time e veja como o jogador rende quando ele joga e quando não joga, com o tamanho da amostra do lado. Amostra pequena vem avisada.",
        },
      ],
      en: [
        {
          title: "Last 5, last 10, full season",
          body: "Not an average — a count of how many games cleared the line, with the sample size beside it. When the last 10 disagree with the season, you see that.",
        },
        {
          title: "Minutes come first",
          body: "A soft matchup is worth nothing to a player who logs 12 minutes. Before any leg, we check minutes and role; players who barely play are dropped.",
        },
        {
          title: "With and without a teammate",
          body: "Pick a teammate and see how the player does when he plays and when he sits, with the sample size beside it. Small samples are flagged as such.",
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
      pt: "Palpites de NBA e WNBA com odd publicada em cada perna de jogador, histórico nessa linha, minutagem e o \"com e sem\" o companheiro, e a chance estimada ao lado.",
      en: "NBA and WNBA picks with a posted price on every player leg, the record at that line, minutes, and with/without-teammate splits, each with the estimated chance.",
    },
  },
  {
    slug: { pt: "futebol", en: "soccer" },
    sportKeys: ["soccer-bra", "soccer-eng", "soccer-esp", "soccer-ucl", "soccer-lib"],
    name: { pt: "Futebol", en: "Soccer" },
    title: {
      pt: "Escalação confirmada muda tudo: seu bilhete fica sabendo antes de você.",
      en: "A confirmed lineup changes everything, and your slip hears about it first.",
    },
    sub: {
      pt: "Finalizações, faltas e impedimentos de cada jogador entram no bilhete com a odd que a casa publicou. Uma hora antes do jogo a gente confere a escalação: se quem está na sua perna ficar no banco, você fica sabendo e, quando existe, a alternativa sem ele aparece do lado.",
      en: "Each player's shots, fouls and offsides go on the ticket at the price the book posted. An hour before kickoff we check the lineup: if the player on your leg is benched, you hear about it and, when there is one, the backup without him shows up beside it.",
    },
    angle: {
      pt: [
        {
          title: "Vigia de escalação",
          body: "Quando os times saem, a gente cruza com cada bilhete salvo. Jogador no banco ou fora da lista vira um selo vermelho na perna e um aviso pra quem salvou.",
        },
        {
          title: "Cartão é onde a casa menos presta atenção",
          body: "Volante que comete cinco faltas por jogo não leva cartão por azar. A gente mede faltas e cartões partida a partida e mostra a chance real do lado, porque é nesse mercado que o preço costuma escapar.",
        },
        {
          title: "Brasileirão, Premier League, Libertadores",
          body: "Cobrimos as ligas que você acompanha, com o mesmo rigor. Sem tratar campeonato brasileiro como categoria de segunda.",
        },
        {
          title: "Finalização com preço e histórico",
          body: "Muito atacante finaliza bastante e acerta pouco. Cada perna de finalização sai com a odd publicada e quantas vezes ele passou dessa linha.",
        },
      ],
      en: [
        {
          title: "A lineup watch on every saved slip",
          body: "When the teams are out, we cross them with every saved ticket. A benched or missing player turns into a red badge on the leg and a notice to whoever saved it.",
        },
        {
          title: "Cards are where books pay least attention",
          body: "A midfielder committing five fouls a game is not booked by luck. We measure fouls and cards match by match and put the real chance beside the price, because that is where prices tend to slip.",
        },
        {
          title: "Premier League, La Liga, Champions, Brasileirão",
          body: "The leagues you actually follow, all held to the same standard.",
        },
        {
          title: "Shots with a price and a record",
          body: "Plenty of forwards shoot a lot and hit the target little. Every shots leg carries the posted price and how often the player cleared that line.",
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
      pt: "Palpites de futebol com escalação conferida antes do jogo, finalizações e faltas com odd publicada e histórico medido no Brasileirão, Premier League e Libertadores.",
      en: "Soccer picks with the lineup checked before kickoff, shots and fouls at posted prices, and measured records across the Premier League, La Liga and Champions League.",
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
