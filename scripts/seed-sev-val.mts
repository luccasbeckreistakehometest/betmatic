/**
 * Sevilha FC x Valencia — LaLiga, 11/09/2026. Betano event 88312157. Player-prop slate.
 *
 * Everything here is priced against measured game logs (2025-26 + 2026-27), not against the
 * bookmaker's own ladder, which is what the first two versions of this file did. Three checks
 * shaped it:
 *
 * - ESPN's per-player fouls sum exactly to the official team total (16=16, 20=20, 13=13 across
 *   Sevilla's three away logs). The player data is complete, so no calibration factor is applied.
 *   An earlier version invented a 1.50x factor on the assumption that six measured players carry
 *   six elevenths of a team's fouls; that assumption was false and it manufactured fake edges.
 * - Cross-player legs multiply honestly. Agoumé 2+ fouls (1.52) with Danjuma 2+ shots (1.40) is
 *   quoted at 2.12 in the bet builder against a 2.128 product. Correlated legs do not: "Sevilha
 *   vence" (1.95) with "Sevilha mais de 1.5" (2.15) multiplies to 4.19 and is quoted at 2.45.
 *   These tickets are all cross-player, so their prices are real.
 * - Only confirmed starters are used. The football minutes gate was dead code: it reads MIN from
 *   the game log and ESPN publishes none for football, so it returned null silently for every
 *   football prop. Starts-versus-substitute-appearances replaces it.
 */
import { formatAmerican, impliedProbability } from "@/lib/odds";
import { savePrediction } from "@/lib/server/predictions";
import type { BetLeg, BetSlate, BetSuggestion, Settlement } from "@/lib/types";

const GAME_ID = "401882878", SPORT = "soccer-esp", DATE_KEY = "20260911";
const MATCHUP = "Valencia @ Sevilla", STARTS_AT = "2026-09-11T19:00:00Z";

const pois = (k: number, l: number): number => { let s = 0, t = Math.exp(-l); for (let i = 0; i < k; i++) { s += t; t *= l / (i + 1); } return 1 - s; };

/** Measured per-appearance rates, 2026-27 at full weight and 2025-26 at half. Games in brackets. */
const RATE = {
  agoumeFouls: { lam: 1.81, games: 39, book: 2.49 },
  danjumaShots: { lam: 1.24, games: 41, book: 2.67 },
  danjumaSog: { lam: 0.49, games: 41, book: 1.27 },
  danjumaOffside: { lam: 0.20, games: 41, book: 0.45 },
  sierraFouled: { lam: 0.74, games: 19, book: 2.05 },
  sierraSog: { lam: 0.30, games: 19, book: 1.20 },
  guerraSog: { lam: 0.26, games: 42, book: 0.77 },
};

interface Spec { sel: string; market: string; odd: number; k: number; rate: { lam: number; games: number; book: number }; player: string; stat: string }

const L = {
  ag1: { sel: "Lucien Agoumé — 1+ falta cometida", market: "Faltas cometidas", odd: 1.09, k: 1, rate: RATE.agoumeFouls, player: "Lucien Agoumé", stat: "foulsCommitted" },
  ag2: { sel: "Lucien Agoumé — 2+ faltas cometidas", market: "Faltas cometidas", odd: 1.52, k: 2, rate: RATE.agoumeFouls, player: "Lucien Agoumé", stat: "foulsCommitted" },
  ag3: { sel: "Lucien Agoumé — 3+ faltas cometidas", market: "Faltas cometidas", odd: 2.55, k: 3, rate: RATE.agoumeFouls, player: "Lucien Agoumé", stat: "foulsCommitted" },
  dj2: { sel: "Arnaut Danjuma — 2+ finalizações", market: "Finalizações", odd: 1.40, k: 2, rate: RATE.danjumaShots, player: "Arnaut Danjuma", stat: "shots" },
  dj3: { sel: "Arnaut Danjuma — 3+ finalizações", market: "Finalizações", odd: 2.22, k: 3, rate: RATE.danjumaShots, player: "Arnaut Danjuma", stat: "shots" },
  djg: { sel: "Arnaut Danjuma — 1+ finalização no gol", market: "Finalizações no gol", odd: 1.50, k: 1, rate: RATE.danjumaSog, player: "Arnaut Danjuma", stat: "shotsOnTarget" },
  si1: { sel: "Miguel Sierra — 1+ falta sofrida", market: "Faltas sofridas", odd: 1.14, k: 1, rate: RATE.sierraFouled, player: "Miguel Angel Sierra", stat: "foulsDrawn" },
  jgg: { sel: "Javi Guerra — 1+ finalização no gol", market: "Finalizações no gol", odd: 1.98, k: 1, rate: RATE.guerraSog, player: "Javi Guerra", stat: "shotsOnTarget" },
} satisfies Record<string, Spec>;

const fairOf = (s: Spec) => pois(s.k, s.rate.lam);

function mkLeg(s: Spec, pt: boolean): BetLeg {
  const fair = fairOf(s);
  const over = ((s.rate.book / s.rate.lam) - 1) * 100;
  return {
    selection: s.sel, market: s.market, odds: s.odd.toFixed(2), oddsDecimal: s.odd, book: "Betano",
    explanation: pt
      ? `Medido ${s.rate.lam.toFixed(2)} por jogo em ${s.rate.games} partidas: P(${s.k}+) = ${(fair * 100).toFixed(0)}%. O preço pede ${((1 / s.odd) * 100).toFixed(0)}%.`
      : `Measured ${s.rate.lam.toFixed(2)} per game over ${s.rate.games} matches: P(${s.k}+) = ${(fair * 100).toFixed(0)}%. The price asks ${((1 / s.odd) * 100).toFixed(0)}%.`,
    evidence: pt
      ? `Gamelog ESPN 2025-26 + 2026-27 (${s.rate.games} jogos). A escada da casa implica ${s.rate.book.toFixed(2)} por jogo — ${over.toFixed(0)}% acima do medido.`
      : `ESPN game logs 2025-26 + 2026-27 (${s.rate.games} games). The book's ladder implies ${s.rate.book.toFixed(2)} per game — ${over.toFixed(0)}% above measured.`,
    fairProbability: fair,
    settlement: { type: "player_prop", player: s.player, stat: s.stat, line: s.k - 0.5, side: "over", sourceBasis: "gamelog ESPN 2 temporadas" } as Settlement,
  };
}

function ticket(id: string, keys: (keyof typeof L)[], title: string, background: string, riskNote: string, notes: string[], alternativeFor?: string): BetSuggestion {
  const specs = keys.map((k) => L[k]);
  const legs = specs.map((s) => mkLeg(s, true));
  const odd = specs.reduce((a, s) => a * s.odd, 1);
  const fair = specs.reduce((a, s) => a * fairOf(s), 1);
  const band = odd < 2 ? "safe" : odd < 5 ? "value" : odd < 20 ? "mid" : odd < 100 ? "long" : "moonshot";
  return {
    id, kind: legs.length > 1 ? "parlay" : "single", bandKey: band, title, background, legs,
    combinedDecimal: Number(odd.toFixed(2)), combinedAmerican: formatAmerican(odd),
    impliedProbability: impliedProbability(odd), modelledProbability: fair,
    edgePct: (fair * odd - 1) * 100, riskNote, confidence: "low",
    evidenceScore: Math.max(0, 100 - Math.max(0, legs.length - 2) * 12), evidenceNotes: notes, alternativeFor,
  };
}

function slate(lang: "pt" | "en"): BetSlate {
  const pt = lang === "pt";
  const en = !pt;
  const T = (p: string, e: string) => (pt ? p : e);
  const s: BetSuggestion[] = [
    ticket("p0", ["ag1"],
      T("Agoumé comete falta", "Agoumé to commit a foul"),
      T("A linha de jogador menos cara da partida, e mesmo assim cara. Agoumé comete 1,81 faltas por jogo em 39 partidas medidas e é titular nos quatro jogos da temporada. A 1,09 o preço pede 92% e o histórico entrega 84%.",
        "The least expensive player leg in the fixture, and still expensive. Agoumé commits 1.81 fouls a game across 39 measured matches and has started all four this season. At 1.09 the price asks 92% and the history delivers 84%."),
      T("−8,8%: você paga 8,8 centavos de cada real pela margem da casa.", "−8.8%: you pay 8.8 cents on the real for the house margin."),
      [T("39 jogos medidos — a maior amostra do confronto", "39 measured games — the largest sample in this fixture"),
       T("titular em 4 de 4 jogos", "started 4 of 4")]),
    ticket("p1", ["ag2"],
      T("Alternativa: Agoumé em 2+ faltas", "Alternative: Agoumé for 2+ fouls"),
      T("Mesmo jogador, um degrau acima. A escada da casa embute 2,49 faltas por jogo; o histórico de 39 partidas diz 1,81. Essa diferença de 38% é a margem, e ela cresce a cada degrau que você sobe.",
        "Same player, one rung higher. The book's ladder implies 2.49 fouls a game; 39 matches of history say 1.81. That 38% gap is the margin, and it widens with every rung you climb."),
      T("−17,9%. O dobro do custo da linha anterior pelo mesmo jogador.", "−17.9%. Twice the cost of the previous leg, same player."),
      [T("a margem da escada cresce com o degrau: 9% no 1+, 18% no 2+, 30% no 3+", "ladder margin grows with the rung: 9% at 1+, 18% at 2+, 30% at 3+")], "p0"),
    ticket("p2", ["ag1", "djg"],
      T("Agoumé faz falta, Danjuma acerta o gol", "Agoumé fouls, Danjuma hits the target"),
      T("Dois jogadores diferentes, então a odd combinada é real: conferi no cupom que Agoumé + Danjuma sai pelo produto das linhas, não com desconto. O problema não é o preço da combinação, é o preço de cada linha.",
        "Two different players, so the combined price is real: I checked in the slip that Agoumé + Danjuma prices at the product of its legs, with no discount. The problem isn't the combination price, it's each leg's."),
      T("−47%. Danjuma acerta o gol 0,49 vez por jogo em 41 partidas; a 1,50 o preço pede 67%.", "−47%. Danjuma hits the target 0.49 times a game over 41 matches; at 1.50 the price asks 67%."),
      [T("odd combinada verificada no cupom, não multiplicada às cegas", "combined price verified in the slip, not multiplied blind")]),
    ticket("p3", ["ag1", "dj2"],
      T("Alternativa: volume de finalização no lugar do acerto", "Alternative: shot volume instead of accuracy"),
      T("Troca 'no gol' por 'finalização', que é o stat mais frequente e por isso a linha mais alcançável. Danjuma finaliza 1,24 vez por jogo medido, e a casa precifica como se fossem 2,67.",
        "Swaps on-target for total shots, the more frequent stat and so the more reachable line. Danjuma takes 1.24 shots a game measured; the book prices as if it were 2.67."),
      T("−55%. A casa está 115% acima do medido nessa escada.", "−55%. The book sits 115% above measured on that ladder."),
      [T("115% acima do medido — a maior distorção entre os titulares", "115% above measured — the widest gap among the starters")], "p2"),
    ticket("p4", ["ag2", "dj2", "djg"],
      T("Três linhas de jogador", "Three player legs"),
      T("Agoumé em 2+ faltas, Danjuma em 2+ finalizações e 1+ no gol. Onde as margens de cada linha se multiplicam em vez de se diluir.",
        "Agoumé for 2+ fouls, Danjuma for 2+ shots and 1+ on target. Where each leg's margin multiplies instead of diluting."),
      T("−76,5%. Chance medida de 7,4% contra 31,3% que o preço sugere.", "−76.5%. A measured 7.4% chance against the 31.3% the price implies."),
      [T("3 linhas — cada uma é mais um jeito de perder", "3 legs — each one is another way to lose")]),
    ticket("p5", ["ag2", "dj2", "djg", "si1"],
      T("Alternativa: quatro linhas", "Alternative: four legs"),
      T("Acrescenta Sierra sofrendo falta, que é titular nos quatro jogos mas mede 0,74 falta sofrida por partida contra os 2,05 que a escada embute.",
        "Adds Sierra being fouled — a four-of-four starter who measures 0.74 fouls drawn a game against the 2.05 the ladder implies."),
      T("−86%. Sierra é a linha com a pior distorção do bilhete: 177% acima do medido.", "−86%. Sierra is the worst-distorted leg here: 177% above measured."),
      [T("4 linhas — cada uma é mais um jeito de perder", "4 legs — each one is another way to lose")], "p4"),
    ticket("p6", ["ag3", "dj3", "djg", "jgg"],
      T("Quatro linhas em degraus altos", "Four legs on high rungs"),
      T("16,8x no produto, e o produto aqui é preço real porque são quatro jogadores distintos. Publico porque você pediu a faixa; publico o número junto porque ele é o ponto.",
        "16.8x on the product, and the product is a real price here because these are four distinct players. I'm publishing it because you asked for the band, and publishing the number with it because the number is the point."),
      T("−94,8%. Chance medida de 0,3%. Isso não é uma aposta, é uma doação.", "−94.8%. A measured 0.3% chance. This isn't a bet, it's a donation."),
      [T("a pior relação medida do slate inteiro", "the worst measured ratio in the slate")]),
  ];

  const note = pt ? [
    "Slate só de mercados de jogador, como você pediu — sem resultado e sem total de gols.",
    "",
    "O QUE EU MEDI: gamelog do ESPN de 2025-26 e 2026-27 para cada titular, cruzado com o total de faltas do time. Validei a escala antes de usar: a soma das faltas por jogador bate exatamente com o total oficial do Sevilha em três jogos (16=16, 20=20, 13=13). O dado é completo.",
    "",
    "O QUE ENCONTREI: as escadas de jogador da casa estão 38% a 177% acima do que o histórico entrega. Agoumé comete 1,81 faltas por jogo em 39 partidas e é precificado em 2,49. Danjuma finaliza 1,24 vez e é precificado em 2,67. Sierra sofre 0,74 falta e é precificado em 2,05.",
    "",
    "CONSEQUÊNCIA: a melhor linha de jogador da partida inteira é −8,8%, e as múltiplas descem até −95%. Não há uma única aposta de jogador com valor positivo neste jogo. Publiquei os bilhetes com o número real em cada um em vez de esconder.",
    "",
    "UMA BOA NOTÍCIA TÉCNICA: linhas de jogadores diferentes multiplicam honestamente. Conferi no cupom — Agoumé 2+ faltas (1,52) com Danjuma 2+ finalizações (1,40) sai a 2,12 contra 2,128 do produto. Então as odds acima são reais e você consegue montá-las. Já linhas correlacionadas do mesmo time levam desconto pesado: 'Sevilha vence' com 'Sevilha mais de 1,5' multiplica 4,19 e o cupom cota 2,45.",
    "",
    "SÓ TITULARES: Hugo Duro (1 de 4 jogos como titular) e Isaac Romero (1 de 3) foram cortados. O filtro de minutagem do projeto nunca tinha rodado para futebol — ele lê minutos do gamelog e o ESPN não publica minutos nesse esporte, então devolvia nulo em silêncio. Agora usa titularidades.",
    "",
    "Escalações não estavam confirmadas na leitura.",
  ].join("\n") : [
    "A player-market slate, as you asked — no match result, no goal totals.",
    "",
    "WHAT I MEASURED: ESPN game logs for 2025-26 and 2026-27 for every starter, cross-checked against team foul totals. I validated the scale before using it: per-player fouls sum exactly to Sevilla's official team total across three matches (16=16, 20=20, 13=13). The data is complete.",
    "",
    "WHAT I FOUND: the book's player ladders sit 38% to 177% above what the history delivers. Agoumé commits 1.81 fouls a game over 39 matches and is priced at 2.49. Danjuma takes 1.24 shots and is priced at 2.67. Sierra draws 0.74 fouls and is priced at 2.05.",
    "",
    "CONSEQUENCE: the best player leg in the whole fixture is −8.8%, and the parlays run down to −95%. There is no positive-value player bet in this match. I've published the tickets with the real number on each rather than burying it.",
    "",
    "ONE PIECE OF GOOD TECHNICAL NEWS: legs on different players multiply honestly. I checked in the slip — Agoumé 2+ fouls (1.52) with Danjuma 2+ shots (1.40) quotes 2.12 against a 2.128 product. So the prices above are real and you can actually build them. Correlated same-team legs are discounted hard: 'Sevilla to win' with 'Sevilla over 1.5' multiplies to 4.19 and the slip quotes 2.45.",
    "",
    "STARTERS ONLY: Hugo Duro (one start in four) and Isaac Romero (one in three) were cut. The project's minutes gate had never run for football — it reads minutes from the game log and ESPN publishes none for the sport, so it returned null silently. It now uses starts.",
    "",
    "Line-ups were unconfirmed at read time.",
  ].join("\n");
  void en;
  return { suggestions: s, dataNote: note };
}

for (const lang of ["pt", "en"] as const) {
  const sl = slate(lang);
  savePrediction({ scope: "game", sportKey: SPORT, gameId: GAME_ID, dateKey: DATE_KEY, lang, matchup: MATCHUP, startsAt: STARTS_AT, slate: sl, costUsd: 0 });
  console.log(`[${lang}] ${sl.suggestions.length} bilhetes`);
  for (const g of sl.suggestions)
    console.log(`   ${g.bandKey.padEnd(6)} ${g.combinedDecimal.toFixed(2).padStart(6)}x  medido ${(g.modelledProbability * 100).toFixed(1).padStart(5)}%  EV ${g.edgePct.toFixed(1).padStart(6)}%  ${g.title}`);
}
