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
  /**
   * What surrounds the ticket in this sport: the watch before kickoff, the backups, the live read,
   * the grading afterwards. `href` is where the thing actually is — a path under /app goes through
   * signup for a visitor who is not signed in.
   */
  stackTitle: { pt: string; en: string };
  stackSub: { pt: string; en: string };
  stack: { pt: StackItem[]; en: StackItem[] };
  leagues: string[];
  cta: { pt: string; en: string };
  meta: { pt: string; en: string };
}

export interface StackItem {
  title: string;
  body: string;
  href: string;
  cta: string;
}

export const SPORT_LANDINGS: SportLanding[] = [
  {
    slug: { pt: "basquete", en: "basketball" },
    sportKeys: ["nba", "wnba"],
    name: { pt: "Basquete", en: "Basketball" },
    title: {
      pt: "Odd e minutagem em cada linha de jogador.",
      en: "A real price and real minutes behind every player leg.",
    },
    sub: {
      pt: "Na NBA e na WNBA, cada linha de jogador sai com o número e o preço que a casa publicou e, do lado, quantas vezes ele passou dele. Quem joga pouco nem entra. E no raio-x do jogador você vê como ele rende com e sem o companheiro.",
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
          body: "Matchup bom não vale nada pra quem fica 12 minutos em quadra. Antes de qualquer linha, a gente confere minutos e papel no time; quem joga pouco sai da lista.",
        },
        {
          title: "Com e sem o companheiro",
          body: "Escolha um companheiro de time e veja como o jogador rende quando ele joga e quando não joga, com o tamanho da amostra do lado. Amostra pequena vem avisada.",
        },
        {
          title: "A chance de cada linha, calculada",
          body: "Produção por minuto vezes os minutos que a gente projeta pra hoje — com desfalques, tendência e risco de blowout — vira a chance de cada linha da escada, ao lado da contagem de acertos. Quando as duas discordam, isso é informação.",
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
        {
          title: "Every line's chance, computed",
          body: "Production per minute times the minutes we project for tonight — absences, trend and blowout risk included — becomes the chance of every rung on the ladder, next to the hit count. When the two disagree, that is information.",
        },
      ],
    },
    marketsTitle: { pt: "Números que entram na análise", en: "Numbers that feed the analysis" },
    markets: {
      pt: ["Pontos", "Rebotes", "Assistências", "Bolas de 3", "Roubos", "Tocos", "Erros", "Faltas", "Minutos", "Pts+Reb+Ass", "Roubos+Tocos"],
      en: ["Points", "Rebounds", "Assists", "3PM", "Steals", "Blocks", "Turnovers", "Fouls", "Minutes", "PRA", "Steals+Blocks"],
    },
    stackTitle: { pt: "O que vem junto com o bilhete", en: "What ships around the ticket" },
    stackSub: {
      pt: "O palpite é o começo. O resto acontece antes da bola subir, com o jogo rolando e depois do apito final.",
      en: "The pick is the start. The rest happens before tip-off, during the game and after the final buzzer.",
    },
    stack: {
      pt: [
        {
          title: "Vigia de lesão nas suas linhas",
          body: "No basquete não sai escalação publicada, então a gente acompanha o boletim de lesões: quem está numa linha sua virou dúvida ou foi descartado, a linha ganha selo vermelho e quem salvou o bilhete recebe o aviso na sua lista de avisos.",
          href: "/app/alerts",
          cta: "Como funcionam os avisos",
        },
        {
          title: "Até duas alternativas por bilhete",
          body: "Quando os dados sustentam, o bilhete já vem com até duas alternativas com a mesma ideia — outra linha do mesmo jogador, outro nome com o mesmo papel. Quando não sustentam, não vem nenhuma.",
          href: "/app",
          cta: "Ver os jogos de hoje",
        },
        {
          title: "Manda o print, a gente lê",
          body: "Apostou na casa? Manda o print: a gente lê as linhas e as odds, confere se elas multiplicam no total que está ali, e o bilhete é liquidado sozinho quando o jogo acaba. A imagem não fica guardada.",
          href: "/app/bankroll",
          cta: "Ver a banca",
        },
        {
          title: "Raio-x do grupo de NBA",
          body: "Antes de pagar aquele grupo VIP, cola as mensagens dele e veja o acerto real contra o placar oficial — inclusive os greens postados depois que o jogo já tinha começado. O nome do tipster não aparece em lugar nenhum.",
          href: "/raio-x-tipster",
          cta: "Passar um tipster no raio-x",
        },
        {
          title: "Linha de fechamento (CLV)",
          body: "No apito inicial a gente guarda a odd de fechamento de cada linha, tira a margem da casa e compara com o preço do bilhete. O número sai por mercado na prova pública, a partir de 30 linhas com fechamento.",
          href: "/prova",
          cta: "Ver o CLV medido",
        },
        {
          title: "Com o jogo rolando",
          body: "Cada linha mostra se já bateu, se caiu ou quanta chance ainda tem, misturando o ritmo da partida com o histórico do jogador. É estimativa, e vem escrito que é. Nos planos Pro e Max entra também a leitura no intervalo: bilhetes novos, montados só com o que já aconteceu, registrados e conferidos numa conta separada.",
          href: "/planos",
          cta: "Ver os planos",
        },
        {
          title: "Em qual casa paga mais",
          body: "Oito casas brasileiras lidas a cada 15 minutos. Em cada linha do bilhete, quem paga mais e quanto a mais que a pior; no bilhete, onde ele inteiro rende mais; e as linhas de jogador em que uma casa está fora do passo das outras.",
          href: "/signup",
          cta: "Ver num jogo",
        },
        {
          title: "Raio-x do jogador",
          body: "Últimos 5, 10 e temporada naquela linha, minutagem e papel no time, o que o adversário concede pra posição dele e o rendimento com e sem cada companheiro. Tudo do boletim dos jogos, sem palpite de IA.",
          href: "/app",
          cta: "Abrir um jogador",
        },
        {
          title: "Destaques do dia",
          body: "Algumas vezes por dia o sistema escolhe jogos que começam entre 2 e 30 horas — os times e ligas mais seguidos por aqui entram primeiro, e a WNBA está na lista — e monta os bilhetes antes de qualquer pessoa abrir. É o que mantém o histórico público cheio.",
          href: "/prova",
          cta: "Ver o histórico público",
        },
      ],
      en: [
        {
          title: "An injury watch on your legs",
          body: "Basketball publishes no starting five, so we follow the injury report instead: when a player on your leg turns doubtful or is ruled out, the leg gets a red badge and whoever saved the ticket hears about it in the notice list.",
          href: "/app/alerts",
          cta: "How the notices work",
        },
        {
          title: "Up to two backups per ticket",
          body: "When the data supports it, a ticket already carries up to two alternatives with the same idea — another line on the same player, another name in the same role. When it doesn't, it carries none.",
          href: "/app",
          cta: "See today's games",
        },
        {
          title: "Snap your slip, we read it",
          body: "Bet at the book? Send the screenshot: we read the legs and the odds, check they multiply into the total printed on it, and the slip grades itself when the game ends. The image is never kept.",
          href: "/app/bankroll",
          cta: "See the bankroll",
        },
        {
          title: "Audit that NBA group",
          body: "Before paying for a VIP group, paste its messages and see the real record against the official box score — including the wins posted after tip-off. The tipster's name shows up nowhere.",
          href: "/tipster-audit",
          cta: "Audit a tipster",
        },
        {
          title: "Closing line value (CLV)",
          body: "At tip-off we store each leg's closing price, strip the book's margin and compare it with what the ticket paid. It is broken down by market on the public record, once 30 legs have a close.",
          href: "/prova",
          cta: "See the measured CLV",
        },
        {
          title: "While the game runs",
          body: "Every leg shows whether it has cleared, busted or how much chance is left, blending the game's pace with the player's own rate. It is an estimate and says so. Pro and Max also get the half-time read: fresh tickets built only on what has already happened, logged and graded on a record of their own.",
          href: "/planos",
          cta: "See the plans",
        },
        {
          title: "Which book pays the most",
          body: "Eight Brazilian books read every 15 minutes. On every leg, who pays the most and by how much over the worst; on the ticket, where the whole thing pays best; and the player lines where one book is out of step with the rest.",
          href: "/signup",
          cta: "See it on a game",
        },
        {
          title: "Player deep dive",
          body: "Last 5, last 10 and the season at that line, minutes and role, what tonight's opponent concedes to his position, and how he does with and without each teammate. All from box scores, no AI guesswork.",
          href: "/app",
          cta: "Open a player",
        },
        {
          title: "Featured games of the day",
          body: "A few times a day the system picks games starting 2 to 30 hours out — the teams and leagues most followed here come first, and the WNBA is on that list — and builds their tickets before anyone opens them. That is what keeps the public record full.",
          href: "/prova",
          cta: "See the public record",
        },
      ],
    },
    leagues: ["NBA", "WNBA"],
    cta: { pt: "Ver os jogos de hoje", en: "See today's games" },
    meta: {
      pt: "Palpites de NBA e WNBA com odd publicada em cada linha de jogador, histórico nesse número, minutagem e o \"com e sem\" o companheiro, e a chance estimada ao lado.",
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
      pt: "Finalizações, faltas e impedimentos de cada jogador entram no bilhete com a odd que a casa publicou. Uma hora antes do jogo a gente confere a escalação: se quem está numa linha sua ficar no banco, você fica sabendo e, quando existe, a alternativa sem ele aparece do lado.",
      en: "Each player's shots, fouls and offsides go on the ticket at the price the book posted. An hour before kickoff we check the lineup: if the player on your leg is benched, you hear about it and, when there is one, the backup without him shows up beside it.",
    },
    angle: {
      pt: [
        {
          title: "Vigia de escalação",
          body: "Quando os times saem, a gente cruza com cada bilhete salvo. Jogador no banco ou fora da lista vira um selo vermelho na linha e um aviso pra quem salvou.",
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
          body: "Muito atacante finaliza bastante e acerta pouco. Cada linha de finalização sai com a odd publicada e quantas vezes ele passou dela.",
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
    stackTitle: { pt: "O que vem junto com o bilhete", en: "What ships around the ticket" },
    stackSub: {
      pt: "O palpite é o começo. O resto acontece antes da bola rolar, com o jogo em andamento e depois do apito final.",
      en: "The pick is the start. The rest happens before kickoff, while the match runs and after the final whistle.",
    },
    stack: {
      pt: [
        {
          title: "O aviso de escalação chega onde você está",
          body: "Quando os onze saem, a gente cruza com cada bilhete salvo. Titular no banco ou fora da lista vira selo vermelho na linha e um aviso pra quem salvou, na sua lista de avisos.",
          href: "/app/alerts",
          cta: "Como funcionam os avisos",
        },
        {
          title: "Até duas alternativas por bilhete",
          body: "Quando os dados sustentam, o bilhete já vem com até duas alternativas com a mesma ideia — outra linha do mesmo jogador, outro nome com o mesmo papel. Se o titular cair, a opção sem ele fica destacada.",
          href: "/app",
          cta: "Ver os jogos de hoje",
        },
        {
          title: "Manda o print, a gente lê",
          body: "Apostou na casa? Manda o print: a gente lê as linhas e as odds, confere se elas multiplicam no total que está ali, e o bilhete é liquidado sozinho quando o jogo acaba. A imagem não fica guardada.",
          href: "/app/bankroll",
          cta: "Ver a banca",
        },
        {
          title: "Raio-x do grupo de futebol",
          body: "Antes de pagar aquele grupo VIP, cola as mensagens dele e veja o acerto real contra o placar oficial — inclusive os greens postados depois que a bola já tinha rolado. O nome do tipster não aparece em lugar nenhum.",
          href: "/raio-x-tipster",
          cta: "Passar um tipster no raio-x",
        },
        {
          title: "Linha de fechamento (CLV)",
          body: "No apito inicial a gente guarda a odd de fechamento de cada linha, tira a margem da casa e compara com o preço do bilhete. O número sai por mercado na prova pública, a partir de 30 linhas com fechamento.",
          href: "/prova",
          cta: "Ver o CLV medido",
        },
        {
          title: "Com a bola rolando",
          body: "Cada linha mostra se já bateu, se caiu ou quanta chance ainda tem no tempo que falta. É estimativa, e vem escrito que é. Nos planos Pro e Max entra também a leitura no intervalo: bilhetes novos, montados só com o que já aconteceu, registrados e conferidos numa conta separada.",
          href: "/planos",
          cta: "Ver os planos",
        },
        {
          title: "Em qual casa paga mais",
          body: "As casas brasileiras que publicam odds abertas são lidas a cada 15 minutos. Em cada linha do bilhete, quem paga mais e quanto a mais que a pior; no bilhete, onde ele inteiro rende mais.",
          href: "/signup",
          cta: "Ver num jogo",
        },
        {
          title: "Raio-x do jogador",
          body: "Finalizações, faltas e cartões partida a partida, quantas vezes ele passou de cada linha nos últimos 5, 10 e na temporada, minutagem e as linhas que a casa publicou pro jogo de hoje.",
          href: "/app",
          cta: "Abrir um jogador",
        },
        {
          title: "Destaques do dia",
          body: "Algumas vezes por dia o sistema escolhe jogos que começam entre 2 e 30 horas — Brasileirão, Premier League, Champions e Libertadores estão na lista — e monta os bilhetes antes de qualquer pessoa abrir. É o que mantém o histórico público cheio.",
          href: "/prova",
          cta: "Ver o histórico público",
        },
      ],
      en: [
        {
          title: "The lineup notice finds you",
          body: "When the elevens are out, we cross them with every saved ticket. A starter on the bench or missing from the squad turns into a red badge on the leg and a notice to whoever saved it, in the notice list.",
          href: "/app/alerts",
          cta: "How the notices work",
        },
        {
          title: "Up to two backups per ticket",
          body: "When the data supports it, a ticket already carries up to two alternatives with the same idea — another line on the same player, another name in the same role. If the starter drops out, the one without him is highlighted.",
          href: "/app",
          cta: "See today's matches",
        },
        {
          title: "Snap your slip, we read it",
          body: "Bet at the book? Send the screenshot: we read the legs and the odds, check they multiply into the total printed on it, and the slip grades itself when the match ends. The image is never kept.",
          href: "/app/bankroll",
          cta: "See the bankroll",
        },
        {
          title: "Audit that soccer group",
          body: "Before paying for a VIP group, paste its messages and see the real record against the official result — including the wins posted after kickoff. The tipster's name shows up nowhere.",
          href: "/tipster-audit",
          cta: "Audit a tipster",
        },
        {
          title: "Closing line value (CLV)",
          body: "At kickoff we store each leg's closing price, strip the book's margin and compare it with what the ticket paid. It is broken down by market on the public record, once 30 legs have a close.",
          href: "/prova",
          cta: "See the measured CLV",
        },
        {
          title: "While the match runs",
          body: "Every leg shows whether it has landed, busted or how much chance is left in the time remaining. It is an estimate and says so. Pro and Max also get the half-time read: fresh tickets built only on what has already happened, logged and graded on a record of their own.",
          href: "/planos",
          cta: "See the plans",
        },
        {
          title: "Which book pays the most",
          body: "The Brazilian books that publish open odds are read every 15 minutes. On every leg, who pays the most and by how much over the worst; on the ticket, where the whole thing pays best.",
          href: "/signup",
          cta: "See it on a game",
        },
        {
          title: "Player deep dive",
          body: "Shots, fouls and cards match by match, how often he cleared each line over the last 5, the last 10 and the season, his minutes, and the lines the book posted for today's match.",
          href: "/app",
          cta: "Open a player",
        },
        {
          title: "Featured matches of the day",
          body: "A few times a day the system picks games starting 2 to 30 hours out — the Brasileirão, the Premier League, the Champions League and the Libertadores are on that list — and builds their tickets before anyone opens them. That is what keeps the public record full.",
          href: "/prova",
          cta: "See the public record",
        },
      ],
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
