import type { Lang } from "@/lib/i18n";

/**
 * Not a translation. The Brazilian bettor says "bilhete", "múltipla", "green" and thinks in R$;
 * the English-speaking one says "slip", "parlay", "edge" and thinks in $. Running one copy through
 * a translator produces text that reads foreign to both, so each language is written on its own.
 */
export interface LandingCopy {
  navPricing: string;
  navHow: string;
  navSports: string;
  navLogin: string;
  navStart: string;

  heroKicker: string;
  heroTitle: string[];
  heroSub: string;
  heroCta: string;
  heroCtaSub: string;
  heroSecondary: string;
  heroProof: string;

  ladderTitle: string;
  ladderSub: string;
  ladderStake: string;
  ladderReturns: string;
  ladderChance: string;
  ladderFootnote: string;

  honestyTitle: string;
  honestySub: string;
  honestyPoints: { title: string; body: string }[];

  edgeTitle: string;
  edgeSub: string;
  edges: { title: string; body: string; href: string }[];

  howTitle: string;
  howSteps: { n: string; title: string; body: string }[];

  sportsTitle: string;
  sportsSub: string;
  sports: { key: string; name: string; hook: string; detail: string; markets: string }[];

  pricingTitle: string;
  pricingSub: string;
  pricingPeriod: string;
  pricingCoins: string;
  pricingCoinsSub: string;
  perMonth: string;
  mostPopular: string;
  choosePlan: string;
  startFree: string;

  faqTitle: string;
  faq: { q: string; a: string }[];

  finalTitle: string;
  finalSub: string;
  finalCta: string;

  footerNote: string;
  footerResponsible: string;
}

const PT: LandingCopy = {
  navPricing: "Planos",
  navHow: "Como funciona",
  navSports: "Esportes",
  navLogin: "Entrar",
  navStart: "Começar de graça",

  heroKicker: "Basquete · Futebol",
  heroTitle: ["Toda odd esconde uma chance.", "A gente mostra qual."],
  heroSub:
    "A gente monta o bilhete e mostra, do lado, a chance real de ele bater. Sem promessa, sem guru, sem print de lucro. Só o número que a casa não coloca na tela.",
  heroCta: "Criar conta grátis",
  heroCtaSub: "Sem cartão. Um jogo por dia, você escolhe.",
  heroSecondary: "Ver os jogos de hoje",
  heroProof: "Todo palpite fica registrado e é conferido depois do jogo. O histórico é público.",

  ladderTitle: "O que R$ 10 pagam — e a chance real",
  ladderSub:
    "Múltiplas montadas com as linhas reais das casas. A coluna da direita é a que ninguém te mostra.",
  ladderStake: "Aposta",
  ladderReturns: "Retorno",
  ladderChance: "Chance real",
  ladderFootnote:
    "Quanto maior o retorno, menor a chance — e a margem da casa cresce a cada perna. Numa múltipla de 6 pernas a −110, ela fica com 24% contra 4,5% numa simples. A gente mostra isso porque é o que separa aposta de loteria.",

  honestyTitle: "Por que confiar nos nossos números",
  honestySub: "Três coisas que a gente faz e quase ninguém faz.",
  honestyPoints: [
    {
      title: "Histórico medido, não achismo",
      body:
        "Quando dizemos que um jogador passa de 22,5 pontos, mostramos em quantos dos últimos 5, 10 e de toda a temporada ele passou. O número vem do boletim de cada jogo, não de uma sensação.",
    },
    {
      title: "Todo palpite é conferido",
      body:
        "Cada bilhete fica salvo e, quando o jogo acaba, é liquidado contra o resultado. Acertou, errou, anulou. Dá pra ver onde a gente acerta mais e onde erra — inclusive quando erra.",
    },
    {
      title: "A chance real vem junto",
      body:
        "Toda múltipla mostra a probabilidade implícita e a estimada. Se o preço da casa for pior que a chance, o número aparece negativo. A gente não esconde bilhete ruim.",
    },
  ],

  edgeTitle: "O que só o Betmatic tem",
  edgeSub: "Quem vende palpite esconde o histórico e some quando erra. A gente construiu o contrário disso.",
  edges: [
    { title: "Prova pública, bilhete por bilhete", body: "Todo bilhete que geramos vai pra uma página aberta e é liquidado sozinho contra o placar real. Dá até pra baixar a planilha inteira. Se ficar feio, fica feio lá.", href: "/prova" },
    { title: "Bilhete na hora que você abre o jogo", body: "Sem esperar rodada de atualização: abriu uma partida sem bilhete, o sistema monta na hora — com as odds e escalações daquele momento.", href: "/signup" },
    { title: "Sua banca, liquidada sozinha", body: "Salva o bilhete com o valor que apostou e o resultado entra automático quando o jogo acaba. Lucro, ROI e o stake sugerido por Kelly em cada bilhete.", href: "/signup" },
    { title: "Aprende com o próprio erro", body: "Todo dia o sistema revisa o que ganhou e perdeu, escreve o post-mortem e propõe ajustes, que a gente revisa antes de valer. A taxa de acerto por mercado entra em toda geração seguinte.", href: "/prova" },
    { title: "Calculadoras grátis, sem cadastro", body: "Valor esperado, múltipla com a margem real da casa e conversor de odds — a mesma conta que roda em cada bilhete.", href: "/ferramentas" },
    { title: "Indique e ganhe", body: "Seu link traz um amigo; quando ele faz a primeira compra, os dois ganham coins para analisar bilhetes.", href: "/signup" },
  ],
  howTitle: "Como funciona",
  howSteps: [
    {
      n: "01",
      title: "Você abre o jogo, a gente monta",
      body:
        "Na primeira vez que uma partida é aberta, o sistema lê o quadro de lesões, as linhas publicadas e o histórico de cada jogador e monta os bilhetes em cerca de um minuto. Quem abre depois lê o mesmo bilhete na hora.",
    },
    {
      n: "02",
      title: "Várias faixas, cada perna explicada",
      body:
        "Do seguro ao ousado, cada perna vem com o motivo e o número que sustenta ela. Se os dados não sustentam um bilhete, a gente não inventa um.",
    },
    {
      n: "03",
      title: "Você decide, com o número na mão",
      body:
        "Monte o seu próprio bilhete e peça pra análise apontar o que está frágil e o que trocar. Aí sim é você no controle, mas sabendo o que está fazendo.",
    },
  ],

  sportsTitle: "O que a gente cobre",
  sportsSub: "Cada esporte tem os mercados que fazem sentido nele — não é a mesma régua pra tudo.",
  sports: [
    {
      key: "basketball",
      name: "Basquete",
      hook: "NBA e WNBA, temporada inteira",
      detail:
        "O esporte com mais props por jogo. Pontos, rebotes, assistências, triplos, e as combinações que valorizam o bilhete.",
      markets: "Pontos · Rebotes · Assistências · Bolas de 3 · Roubos + Tocos · Pontos+Reb+Ass",
    },
    {
      key: "soccer",
      name: "Futebol",
      hook: "Brasileirão, Premier League, Libertadores e mais",
      detail:
        "Aqui o dinheiro está no detalhe. Cartão, falta, impedimento e finalização no alvo pagam mais que resultado — e a gente mede o histórico de cada um.",
      markets: "Gols · Assistências · Finalizações · No alvo · Faltas · Cartões · Impedimentos",
    },
  ],

  pricingTitle: "Escolha o seu",
  pricingSub: "Planos pré-pagos, sem renovação automática: você paga o período e usa até o fim. Valores em reais.",
  pricingPeriod: "Pague por mais tempo e economize",
  pricingCoins: "Coins para o que é só seu",
  pricingCoinsSub:
    "Coins pagam a análise do bilhete que você montou (8 coins cada): a IA aponta a perna frágil e sugere troca. O que o plano já inclui não custa nada a mais.",
  perMonth: "/mês",
  mostPopular: "Mais escolhido",
  choosePlan: "Escolher",
  startFree: "Começar de graça",

  faqTitle: "Perguntas diretas",
  faq: [
    {
      q: "Vocês garantem lucro?",
      a: "Não, e desconfie de quem garante. O que a gente garante é que você vê a chance real antes de apostar, e que todo palpite nosso fica registrado e conferido depois.",
    },
    {
      q: "De onde vêm os números?",
      a: "Do boletim de cada partida, das linhas publicadas pelas casas e do quadro de lesões. O histórico de cada jogador é calculado jogo a jogo, não estimado.",
    },
    {
      q: "Preciso apostar valores altos?",
      a: "Não. As faixas vão de retorno curto a múltiplas longas justamente pra você escolher o risco. Aposte só o que não faz falta.",
    },
    {
      q: "Tem renovação automática?",
      a: "Não. O pagamento é único para o período escolhido (1, 3, 6 ou 12 meses) e o acesso vai até o fim dele. Desistiu em até 7 dias da compra? Devolvemos o valor.",
    },
    {
      q: "O Betmatic aceita apostas?",
      a: "Não. É uma ferramenta de pesquisa: mostra números e bilhetes, e a aposta, se você quiser fazer, é na casa de sua escolha. Proibido para menores de 18 anos.",
    },
  ],

  finalTitle: "Comece pelo grátis",
  finalSub: "Um jogo por dia, sem cartão. Se o número te convencer, você escolhe um plano.",
  finalCta: "Criar conta",

  footerNote:
    "Ferramenta de pesquisa. Dados agregados podem estar errados ou desatualizados — confirme a linha na sua casa antes de apostar. Nada aqui é recomendação.",
  footerResponsible:
    "18+. Aposta não é investimento: é entretenimento, não fonte de renda. Só aposte o que você pode perder sem que faça falta. Se deixar de ser diversão, esse é o sinal de parar.",
};

const EN: LandingCopy = {
  navPricing: "Pricing",
  navHow: "How it works",
  navSports: "Sports",
  navLogin: "Log in",
  navStart: "Start free",

  heroKicker: "Basketball · Soccer",
  heroTitle: ["Every price hides a probability.", "We show you which."],
  heroSub:
    "We build the slip and put the real probability right next to it. No guarantees, no gurus, no profit screenshots — just the number your sportsbook leaves off the screen.",
  heroCta: "Create a free account",
  heroCtaSub: "No card. One game a day, your pick.",
  heroSecondary: "See today's games",
  heroProof: "Every pick is logged and graded after the game. The track record is public.",

  ladderTitle: "What R$10 pays — and the real chance",
  ladderSub: "Parlays built from real posted lines. The right column is the one nobody shows you.",
  ladderStake: "Stake",
  ladderReturns: "Returns",
  ladderChance: "Real chance",
  ladderFootnote:
    "Bigger returns mean smaller chances, and the book's margin compounds with every leg — a six-leg parlay at −110 holds 24% against 4.5% on a single. We show it because that is the line between betting and a lottery ticket.",

  honestyTitle: "Why our numbers are worth reading",
  honestySub: "Three things we do that almost nobody does.",
  honestyPoints: [
    {
      title: "Measured history, not vibes",
      body:
        "When we say a player goes over 22.5 points, we show how many of his last 5, last 10 and full season did. It comes from the box score of every game, not a feeling.",
    },
    {
      title: "Every pick gets graded",
      body:
        "Slips are stored and settled against the real result once the game ends. Won, lost, void. You can see where we are accurate and where we are not — including where we are not.",
    },
    {
      title: "The real chance ships with it",
      body:
        "Every parlay shows implied and modelled probability. When the price is worse than the chance, the number reads negative. We do not hide a bad ticket.",
    },
  ],

  edgeTitle: "What only Betmatic does",
  edgeSub: "Pick sellers hide their record and vanish when they miss. We built the opposite.",
  edges: [
    { title: "A public record, ticket by ticket", body: "Every ticket we generate lands on an open page and settles itself against the real score. You can download the whole spreadsheet. When it looks bad, it looks bad there.", href: "/prova" },
    { title: "Tickets the moment you open a game", body: "No waiting for a refresh cycle: open a game with no ticket and the system builds one on the spot, from that moment's odds and line-ups.", href: "/signup" },
    { title: "Your bankroll, graded for you", body: "Save a ticket with your stake and the result lands automatically when the game ends. Profit, ROI, and a quarter-Kelly suggested stake on every ticket.", href: "/signup" },
    { title: "It learns from its own misses", body: "Every day the system reviews what won and lost, writes the post-mortem and proposes changes that we review before they apply. Hit rate by market feeds every next generation.", href: "/prova" },
    { title: "Free calculators, no signup", body: "Expected value, parlays with the book's real hold, and an odds converter — the same math that runs on every ticket.", href: "/ferramentas" },
    { title: "Invite and earn", body: "Your link brings a friend; when they make their first purchase, you both get coins for slip analyses.", href: "/signup" },
  ],
  howTitle: "How it works",
  howSteps: [
    {
      n: "01",
      title: "You open a game, we build it",
      body:
        "The first time a game is opened, the system reads the injury report, the posted lines and each player's game log and builds the tickets in about a minute. Everyone who opens it after reads the same tickets instantly.",
    },
    {
      n: "02",
      title: "Several bands, every leg explained",
      body:
        "From short to ambitious, every leg carries the reason and the number behind it. When the data doesn't support a ticket, we don't invent one.",
    },
    {
      n: "03",
      title: "You decide, holding the number",
      body:
        "Build your own slip and have the analysis flag what is weak and what to swap. You stay in control — with the maths in front of you.",
    },
  ],

  sportsTitle: "What we cover",
  sportsSub: "Each sport gets the markets that actually matter in it, not one template stretched over three.",
  sports: [
    {
      key: "basketball",
      name: "Basketball",
      hook: "NBA and WNBA, all season",
      detail:
        "The sport with the deepest prop board. Points, rebounds, assists, threes, and the combinations that lengthen a slip.",
      markets: "Points · Rebounds · Assists · 3PM · Steals + Blocks · PRA",
    },
    {
      key: "soccer",
      name: "Soccer",
      hook: "Premier League, La Liga, Champions League, Brasileirão",
      detail:
        "The value lives in the detail. Cards, fouls, offsides and shots on target price longer than the result — and we measure each player's history on all of them.",
      markets: "Goals · Assists · Shots · On target · Fouls · Cards · Offsides",
    },
  ],

  pricingTitle: "Pick your tier",
  pricingSub: "Prepaid plans with no auto-renewal: pay for the period and use it to the end. Prices are in Brazilian reais (BRL).",
  pricingPeriod: "Commit longer, pay less",
  pricingCoins: "Coins for what is yours alone",
  pricingCoinsSub:
    "Coins pay for the analysis of a slip you built (8 coins each): the AI flags the weak leg and suggests a swap. Everything your plan already includes costs nothing extra.",
  perMonth: "/mo",
  mostPopular: "Most popular",
  choosePlan: "Choose",
  startFree: "Start free",

  faqTitle: "Straight answers",
  faq: [
    {
      q: "Do you guarantee profit?",
      a: "No, and be suspicious of anyone who does. What we guarantee is that you see the real chance before you bet, and that every pick we make is logged and graded afterwards.",
    },
    {
      q: "Where do the numbers come from?",
      a: "Box scores, the lines sportsbooks publish, and injury reports. Each player's history is computed game by game, not estimated.",
    },
    {
      q: "Do I need to bet big?",
      a: "No. The bands run from short returns to long parlays precisely so you choose the risk. Only stake what you can afford to lose.",
    },
    { q: "Does it renew automatically?", a: "No. You pay once for the period you pick (1, 3, 6 or 12 months) and access runs to its end. Changed your mind within 7 days of buying? We refund it." },
    { q: "Does Betmatic take bets?", a: "No. It is a research tool: it shows numbers and tickets, and any bet you choose to place happens at a sportsbook of your choice. 18+ only." },
  ],

  finalTitle: "Start on the free tier",
  finalSub: "One game a day, no card. If the numbers convince you, pick a plan.",
  finalCta: "Create account",

  footerNote:
    "Research tool. Aggregated data can be wrong or stale — verify a line at your book before acting. Nothing here is advice.",
  footerResponsible:
    "21+ where applicable. Betting is not investing: it is entertainment, not income. Only stake what you can lose without missing it. If it stops being fun, that is the signal to stop.",
};

export function landingCopy(lang: Lang): LandingCopy {
  return lang === "en" ? EN : PT;
}

/** The payout ladder. Chances are the honest implied probabilities of those decimal odds. */
export const LADDER = [
  { legs: 1, decimal: 1.91, label: { pt: "1 perna", en: "1 leg" } },
  { legs: 2, decimal: 3.64, label: { pt: "2 pernas", en: "2 legs" } },
  { legs: 4, decimal: 18.2, label: { pt: "4 pernas", en: "4 legs" } },
  { legs: 6, decimal: 113.4, label: { pt: "6 pernas", en: "6 legs" } },
  { legs: 8, decimal: 540, label: { pt: "8 pernas", en: "8 legs" } },
];
