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

  /** The two things that run without anyone asking: the day's featured games and the closing line. */
  dailyTitle: string;
  dailySub: string;
  daily: { title: string; body: string; href: string; cta: string }[];

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

  /**
   * The five plates. `alt` is what a screen reader is told is in the picture — the images carry no
   * product claim, but a reader who cannot see them should still know what the page is showing.
   * Only the method plate takes a caption, and it exists to stop a falling line being read as our
   * own record: a caption describes the picture, never a result.
   */
  plates: {
    hero: { alt: string };
    daily: { alt: string };
    honesty: { alt: string };
    how: { alt: string; caption: string };
    closing: { alt: string };
  };

  /** Who builds it: a real person beside the product, in the first person and promising nothing. */
  closingEyebrow: string;
  closingTitle: string;
  closingLine: string;
  closingCta: string;
  closingSecondary: string;
  closingCtaSub: string;
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
    "Quanto maior o retorno, menor a chance — e a margem da casa cresce a cada linha. Numa múltipla de 6 linhas a −110, ela fica com 24% contra 4,5% numa simples. A gente mostra isso porque é o que separa aposta de loteria.",

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
        "No basquete, a chance de cada linha é calculada — produção por minuto vezes os minutos projetados pra hoje — e a contagem de acertos fica do lado. Toda múltipla mostra a probabilidade implícita e a estimada; se o preço da casa for pior que a chance, o número aparece negativo. A gente não esconde bilhete ruim.",
    },
  ],

  edgeTitle: "O que só o Betmatic tem",
  edgeSub: "Quem vende palpite esconde o histórico e some quando erra. A gente construiu o contrário: cada bilhete conferido, vigiado e comparado com o mercado.",
  edges: [
    { title: "Em qual casa o seu bilhete paga mais", body: "A cada 15 minutos a gente lê as odds abertas de oito casas brasileiras. Em cada linha do bilhete aparece quem paga mais e quanto a mais que a pior; embaixo do bilhete, onde ele inteiro rende mais — e as linhas de jogador em que uma casa está fora do passo das outras.", href: "/signup" },
    { title: "Leitura no intervalo, com histórico separado", body: "Com o jogo rolando, uma leitura nova é montada só em cima do que já aconteceu em quadra: placar, minutos que faltam e o ritmo de cada jogador hoje. Cada leitura fica registrada e é conferida como qualquer bilhete, numa conta à parte da pré-jogo.", href: "/prova" },
    { title: "Se a escalação mudar, seu bilhete avisa", body: "Uma hora antes do jogo a gente confere quem entrou em campo. Jogador no banco? A linha fica marcada em vermelho e, quando existe, a alternativa sem ele aparece do lado.", href: "/futebol" },
    { title: "Plano B embaixo do bilhete", body: "Quando os dados sustentam, o bilhete vem com até duas alternativas que mantêm a mesma ideia. Mudou a linha ou caiu um titular, você já sabe pra onde ir.", href: "/signup" },
    { title: "Manda o print, a gente confere", body: "Fez o bilhete na casa? Manda o print. Ele entra na sua banca e é liquidado sozinho quando o jogo acaba. A imagem não fica guardada.", href: "/signup" },
    { title: "Antes de pagar grupo VIP, passa ele no raio-x", body: "Cola as mensagens do tipster e veja quanto ele acertou de verdade, inclusive os \"greens\" postados depois que o jogo já tinha começado. É privado: o nome nunca aparece.", href: "/raio-x-tipster" },
    { title: "Prova pública: o mercado concordou com a gente?", body: "Cada linha do bilhete com odd de fechamento disponível é comparada com ela. Pegar preço melhor que o fechamento com frequência é o sinal mais honesto de que a análise presta, e está na página de prova, pra todo mundo ver.", href: "/prova" },
    { title: "Odd de verdade em cada linha de jogador", body: "O número e o preço publicados e, do lado, quantas vezes o jogador passou dele nos últimos 5, 10 e na temporada. Quem joga pouco nem entra na lista.", href: "/basquete" },
  ],

  dailyTitle: "Duas coisas acontecem sem ninguém pedir",
  dailySub:
    "Não dá pra conferir um histórico que só existe quando alguém abre um jogo. Por isso o sistema trabalha sozinho nas duas pontas: antes da bola rolar e depois do apito inicial.",
  daily: [
    {
      title: "Destaques do dia",
      body:
        "Algumas vezes por dia o sistema olha a rodada e escolhe alguns jogos — dá preferência aos times e ligas que mais gente segue por aqui, entre 2 e 30 horas do apito — e monta os bilhetes deles antes de qualquer pessoa abrir. São os destaques do dia: entram no histórico público do mesmo jeito que os outros e costumam ser o bilhete do dia aqui em cima.",
      href: "/prova",
      cta: "Ver o histórico público",
    },
    {
      title: "Linha de fechamento (CLV)",
      body:
        "Quando a bola rola, a gente guarda a odd de fechamento de cada linha, tira a margem da casa e compara com o preço que estava no bilhete. Bater o fechamento com frequência diz mais sobre a análise do que uma sequência curta de greens. O número só aparece a partir de 30 linhas com fechamento — antes disso seria sorte.",
      href: "/prova",
      cta: "Ver o CLV medido",
    },
  ],

  howTitle: "Como funciona",
  howSteps: [
    {
      n: "01",
      title: "Você abre o jogo, a gente monta",
      body:
        "Na primeira vez que uma partida é aberta, o sistema lê as odds publicadas, o quadro de lesões e o histórico de cada jogador naquele momento, tira quem joga pouco e monta os bilhetes em cerca de um minuto. Quem abre depois lê o mesmo bilhete na hora.",
    },
    {
      n: "02",
      title: "Cada bilhete vem com a chance real e, quando dá, um plano B",
      body:
        "Do seguro ao ousado, cada linha vem com o motivo, o preço e o histórico naquele número. Embaixo, até duas alternativas com a mesma ideia. Se os dados não sustentam um bilhete, a gente não inventa um.",
    },
    {
      n: "03",
      title: "Até o apito final, a gente vigia",
      body:
        "Uma hora antes, a escalação: se alguém de uma linha sua ficar no banco, você fica sabendo. Com a bola rolando, cada linha mostra se já bateu, se caiu ou quanto de chance ainda tem. No intervalo, quem é Pro ou Max pede uma leitura nova, feita só com o que já aconteceu em quadra.",
    },
    {
      n: "04",
      title: "Depois do jogo, tudo é conferido em público",
      body:
        "Cada bilhete é liquidado contra o placar oficial e cada linha com odd de fechamento disponível é comparada com ela. Acerto, retorno e CLV ficam na página de prova, bons ou ruins.",
    },
  ],

  sportsTitle: "O que a gente cobre",
  sportsSub: "Cada esporte tem a sua análise — não é a mesma régua pra tudo.",
  sports: [
    {
      key: "basketball",
      name: "Basquete",
      hook: "NBA e WNBA, temporada inteira",
      detail:
        "Jogo a jogo, a gente mede quanto cada jogador produz, com a minutagem e o papel no time, e cruza com lesões. Aposta de jogador só entra quando a casa publicou a linha e o preço. Pra cada linha, a chance calculada e a casa brasileira que paga mais.",
      markets: "No bilhete: Resultado · Total de pontos · Pontos, rebotes, assistências e bolas de 3 com odd publicada — Na análise: o \"com e sem\" o companheiro",
    },
    {
      key: "soccer",
      name: "Futebol",
      hook: "Brasileirão, Premier League, Libertadores e mais",
      detail:
        "A análise desce ao detalhe: faltas, cartões e finalizações de cada jogador, partida a partida. Quando a escalação sai, a gente confere se quem está no seu bilhete vai começar jogando.",
      markets: "No bilhete: Resultado · Total de gols · Finalizações, faltas e impedimentos com odd publicada — Na análise: cartões e escalação confirmada",
    },
  ],

  pricingTitle: "Escolha o seu",
  pricingSub: "Planos pré-pagos, sem renovação automática: você paga o período e usa até o fim. Valores em reais.",
  pricingPeriod: "Pague por mais tempo e economize",
  pricingCoins: "Coins para o que é só seu",
  pricingCoinsSub:
    "Coins pagam o que é feito só pra você: análise do seu bilhete (8), análise profunda (14; no Max sai por 8), múltipla sob medida (12), leitura do analista no raio-x do jogador (5, e grátis pra quem abrir depois no mesmo dia) e raio-x de tipster além do limite do plano (6). O que o plano já inclui não custa nada a mais.",
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
      q: "As odds são de quais casas?",
      a: "Das casas brasileiras que publicam odds abertas: Superbet, KTO, EstrelaBet, Aposta Ganha, BetPix365, LotoGreen, Vaidebet e Betnacional, lidas a cada 15 minutos. Em cada linha do bilhete a gente mostra a melhor e a pior. Casa que bloqueia leitura automática fica de fora — a gente não contorna bloqueio.",
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
      q: "O print do meu bilhete fica guardado?",
      a: "Não. A imagem é lida na hora e descartada. Só o texto do bilhete (jogo, seleção, odd e valor) fica na sua banca, e só se você mandar salvar.",
    },
    {
      q: "Como funciona o raio-x do tipster?",
      a: "Você cola as mensagens do grupo e a gente confere cada palpite contra o placar oficial. O relatório é só seu, pode ser apagado, e o nome do tipster nunca aparece em lugar nenhum. O texto colado é descartado depois da leitura.",
    },
    {
      q: "O Betmatic aceita apostas?",
      a: "Não. É uma ferramenta de pesquisa: mostra números e bilhetes, e a aposta, se você quiser fazer, é na casa de sua escolha. Proibido para menores de 18 anos.",
    },
  ],

  finalTitle: "Comece pelo grátis",
  finalSub: "Um jogo por dia, sem cartão. Se o número te convencer, você escolhe um plano.",
  finalCta: "Criar conta",

  plates: {
    hero: { alt: "Foto de uma mão segurando um celular. Do meio para a direita a foto vira o desenho técnico da mesma mão e do mesmo aparelho, com linhas de cota e medidas ao redor." },
    daily: { alt: "Celular deitado numa mesa escura, visto de cima em ângulo. Metade do aparelho é a foto e metade é a planta técnica dele, com linhas de construção passando por cima da tela." },
    honesty: { alt: "Uma tira de papel perfurado curvando sobre fundo escuro. A metade da esquerda é papel fotografado; na da direita o papel vira o desenho em linha da mesma tira." },
    how: {
      alt: "Esquema: dezenas de marcas verticais verdes e vermelhas sobre uma linha de base, uma por bilhete liquidado, e acima delas a linha do acumulado, que desce da esquerda para a direita.",
      caption: "Ilustração do método: cada marca é um bilhete já liquidado, verde ou vermelho, e a linha de cima é o acumulado. Não é o nosso histórico — o nosso fica na prova pública.",
    },
    closing: { alt: "Pessoa de camisa branca sentada atrás de um notebook, com a luz de uma janela ao lado, olhando para a câmera." },
  },

  closingEyebrow: "Sem grupo, sem palpite",
  closingTitle: "Você vê o número feio também",
  closingLine:
    "Grupo de aposta posta o green e apaga o resto. Aqui é o contrário: todo bilhete que o sistema monta fica registrado na hora e é conferido depois do jogo, tenha dado certo ou não. Quando o número estiver ruim, ele vai estar na página de prova do mesmo jeito.",
  closingCta: "Criar conta grátis",
  closingSecondary: "Ver a prova pública",
  closingCtaSub: "Sem cartão. Um jogo por dia, você escolhe.",
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
        "In basketball the chance of every line is computed — production per minute times the minutes we project for tonight — with the hit count beside it. Every parlay shows implied and modelled probability; when the price is worse than the chance, the number reads negative. We do not hide a bad ticket.",
    },
  ],

  edgeTitle: "What only Betmatic does",
  edgeSub: "Pick sellers hide their record and vanish when they miss. We built the opposite: every ticket graded, watched and held up against the market.",
  edges: [
    { title: "Which book pays the most for your ticket", body: "Every 15 minutes we read the open odds of eight Brazilian books. Each leg shows who pays the most and by how much over the worst; under the ticket, where the whole thing pays best — and the player lines where one book is out of step with the rest.", href: "/signup" },
    { title: "A half-time read, on its own record", body: "While the game runs, a fresh read is built only on what has already happened on the floor: the score, the minutes left and each player's pace tonight. Every read is logged and graded like any ticket, on a record kept apart from the pre-game one.", href: "/prova" },
    { title: "Your slip watches the lineup for you", body: "An hour before kickoff we check who actually starts. A player on the bench? That leg turns red and, when there is one, the backup without him shows up right beside it.", href: "/soccer" },
    { title: "A plan B under the ticket", body: "When the data supports it, a ticket ships with up to two alternatives that keep the same idea. If a line moves or a starter drops out, you already know where to go.", href: "/signup" },
    { title: "Snap your slip, we grade it", body: "Placed a bet at the book? Send the screenshot. It lands in your bankroll and grades itself when the game ends. The image is never kept.", href: "/signup" },
    { title: "Audit that VIP group before you pay", body: "Paste the tipster's messages and see what they really hit, including the \"wins\" posted after the game had already started. Private: the name never shows anywhere.", href: "/tipster-audit" },
    { title: "Public record: did the market agree with us?", body: "Every leg with a closing line available is compared with it. Beating the close often is the most honest sign the analysis is any good, and it sits on the public record for anyone to check.", href: "/prova" },
    { title: "Real prices on every player leg", body: "The posted line and price, and next to it how often the player cleared that line over the last 5, the last 10 and the season. Players who barely play never make the list.", href: "/basketball" },
  ],

  dailyTitle: "Two things happen with nobody asking",
  dailySub:
    "A record that only exists when somebody opens a game is not a record. So the system works on its own at both ends: before kickoff, and after the opening whistle.",
  daily: [
    {
      title: "Featured games of the day",
      body:
        "A few times a day the system reads the slate and picks a few games — favouring the teams and leagues most followed here, kicking off between 2 and 30 hours out — and builds their tickets before anyone opens them. Those are the day's featured games: they enter the public record like any other, and they are usually the ticket of the day above.",
      href: "/prova",
      cta: "See the public record",
    },
    {
      title: "Closing line value (CLV)",
      body:
        "At kickoff we store each leg's closing line, strip the book's margin and compare it with the price that was on the ticket. Beating the closing line often says more about the analysis than a short run of winners. The number only appears once 30 legs have a close — before that it would be luck.",
      href: "/prova",
      cta: "See the measured CLV",
    },
  ],

  howTitle: "How it works",
  howSteps: [
    {
      n: "01",
      title: "You open a game, we build it",
      body:
        "The first time a game is opened, the system reads the posted prices, the injury report and each player's game log at that moment, drops the players who barely play, and builds the tickets in about a minute. Everyone who opens it after reads the same tickets instantly.",
    },
    {
      n: "02",
      title: "Every ticket ships with the real chance and, when it can, a plan B",
      body:
        "From short to ambitious, every leg carries the reason, the price and the record at that line. Underneath, up to two alternatives with the same idea. When the data doesn't support a ticket, we don't invent one.",
    },
    {
      n: "03",
      title: "Until the final whistle, we keep watch",
      body:
        "An hour out, the lineup: if a player on your leg is benched, you hear about it. Once the game is on, every leg shows whether it has landed, busted, or how much chance it still has. At half-time, Pro and Max can ask for a fresh read built only on what has already happened on the floor.",
    },
    {
      n: "04",
      title: "After the game, everything is graded in public",
      body:
        "Each ticket is settled against the official score and each leg with a closing price available is compared with it. Hit rate, return and CLV sit on the public record, good or bad.",
    },
  ],

  sportsTitle: "What we cover",
  sportsSub: "Each sport gets its own analysis, not one template stretched over all of them.",
  sports: [
    {
      key: "basketball",
      name: "Basketball",
      hook: "NBA and WNBA, all season",
      detail:
        "Game by game, we measure what each player produces, with minutes and role, and cross it with injuries. A player leg only makes a ticket when the book has posted the line and the price. For every line, the computed chance and the Brazilian book that pays the most.",
      markets: "On the ticket: Moneyline · Totals · Points, rebounds, assists and threes at posted prices — In the analysis: with and without a teammate",
    },
    {
      key: "soccer",
      name: "Soccer",
      hook: "Premier League, La Liga, Champions League, Brasileirão",
      detail:
        "The analysis goes down to the detail: each player's fouls, cards and shots, match by match. When the lineup is out, we check whether the players on your ticket actually start.",
      markets: "On the ticket: Result · Goal totals · Shots, fouls and offsides at posted prices — In the analysis: cards and confirmed lineups",
    },
  ],

  pricingTitle: "Pick your tier",
  pricingSub: "Prepaid plans with no auto-renewal: pay for the period and use it to the end. Prices are in Brazilian reais (BRL).",
  pricingPeriod: "Commit longer, pay less",
  pricingCoins: "Coins for what is yours alone",
  pricingCoinsSub:
    "Coins pay for work done just for you: a slip analysis (8), a deep analysis (14; 8 on Max), a custom parlay (12), the analyst read on a player deep dive (5, and free for anyone who opens it later that day) and a tipster audit past your plan's allowance (6). Everything your plan already includes costs nothing extra.",
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
      q: "Which books do the odds come from?",
      a: "The Brazilian books that publish open odds: Superbet, KTO, EstrelaBet, Aposta Ganha, BetPix365, LotoGreen, Vaidebet and Betnacional, read every 15 minutes. Each leg shows the best and the worst. A book that blocks automated reading stays out — we do not work around a block.",
    },
    {
      q: "Do I need to bet big?",
      a: "No. The bands run from short returns to long parlays precisely so you choose the risk. Only stake what you can afford to lose.",
    },
    { q: "Does it renew automatically?", a: "No. You pay once for the period you pick (1, 3, 6 or 12 months) and access runs to its end. Changed your mind within 7 days of buying? We refund it." },
    { q: "Do you keep my slip screenshot?", a: "No. The image is read on the spot and discarded. Only the slip's text (game, selection, odds and stake) goes into your bankroll, and only if you choose to save it." },
    { q: "How does the tipster audit work?", a: "You paste the group's messages and we check each pick against the official score. The report is yours alone, can be deleted, and the tipster's name never shows anywhere. The pasted text is discarded after reading." },
    { q: "Does Betmatic take bets?", a: "No. It is a research tool: it shows numbers and tickets, and any bet you choose to place happens at a sportsbook of your choice. 18+ only." },
  ],

  finalTitle: "Start on the free tier",
  finalSub: "One game a day, no card. If the numbers convince you, pick a plan.",
  finalCta: "Create account",

  plates: {
    hero: { alt: "A photograph of a hand holding a phone. From the middle rightwards the photograph turns into a technical drawing of the same hand and the same handset, ringed with dimension lines and measurements." },
    daily: { alt: "A phone lying on a dark desk, seen from above at an angle. Half the handset is the photograph and half is its technical plan, with construction lines running across the screen." },
    honesty: { alt: "A strip of punched paper curving over a dark background. The left half is photographed paper; on the right the paper becomes a line drawing of the same strip." },
    how: {
      alt: "A schematic: dozens of green and red vertical marks along a baseline, one per settled ticket, and above them the running-total line, falling from left to right.",
      caption: "An illustration of the method: each mark is a ticket already settled, green or red, and the line above is the running total. It is not our record — ours is on the track-record page.",
    },
    closing: { alt: "A person in a white shirt sitting behind a laptop, window light to one side, looking at the camera." },
  },

  closingEyebrow: "No tipster, no hunch",
  closingTitle: "You see the ugly number too",
  closingLine:
    "Tipster groups post the winners and delete the rest. This is the opposite: every ticket the system builds is logged the moment it is built and graded once the game ends, right or wrong. When the numbers look bad, they stay on the track-record page all the same.",
  closingCta: "Create a free account",
  closingSecondary: "See the public record",
  closingCtaSub: "No card. One game a day, your pick.",
};

export function landingCopy(lang: Lang): LandingCopy {
  return lang === "en" ? EN : PT;
}

/** The payout ladder. Chances are the honest implied probabilities of those decimal odds. */
export const LADDER = [
  { legs: 1, decimal: 1.91, label: { pt: "1 linha", en: "1 leg" } },
  { legs: 2, decimal: 3.64, label: { pt: "2 linhas", en: "2 legs" } },
  { legs: 4, decimal: 18.2, label: { pt: "4 linhas", en: "4 legs" } },
  { legs: 6, decimal: 113.4, label: { pt: "6 linhas", en: "6 legs" } },
  { legs: 8, decimal: 540, label: { pt: "8 linhas", en: "8 legs" } },
];
