/**
 * Sevilha FC x Valencia — LaLiga, 11/09/2026 16:00. Betano event 88312157.
 *
 * Every price here was read off Betano's own bet-builder pool (abas "Todos" + "Jogadores",
 * cada accordion aberto e cada "MOSTRAR TODOS" expandido): 27 mercados, 540 seleções.
 *
 * Written after the Flamengo post-mortem, which lost four of six tickets on a single over-4.5-cards
 * leg. Two rules came out of that and both bind here:
 *   1. A 4-game average is not a rate. Regress it to the league before believing it.
 *   2. If the model's answer swings on a baseline I have not measured, take no position.
 */
import { poissonAtLeast } from "@/lib/live/state";
import { bandFor, expectedValue, formatAmerican, impliedProbability, parlayDecimal } from "@/lib/odds";
import { savePrediction } from "@/lib/server/predictions";
import type { BetLeg, BetSlate, BetSuggestion, Settlement } from "@/lib/types";

const GAME_ID = "401882878";
const SPORT = "soccer-esp";
const DATE_KEY = "20260911";
const MATCHUP = "Valencia @ Sevilla";
const STARTS_AT = "2026-09-11T19:00:00Z";

/**
 * Overround measured on this page's two-sided markets (escanteios 8.5 at 1.87/1.87 = 6.95%).
 * Player ladders have no opposite side, so they cannot be de-vigged directly; each side of a
 * two-sided market carries about half the overround, which is the floor applied to them here.
 */
const MEASURED_OVERROUND = 1.0347;
const devig = (odd: number) => Math.min(0.995, 1 / odd / MEASURED_OVERROUND);

interface RawLeg {
  selection: string; market: string; odd: number;
  explanation: string; evidence: string; fair: number; settlement: Settlement;
}

const leg = (r: RawLeg): BetLeg => ({
  selection: r.selection, market: r.market, odds: r.odd.toFixed(2), oddsDecimal: r.odd,
  book: "Betano", explanation: r.explanation, evidence: r.evidence,
  fairProbability: Math.min(0.999, Math.max(0.001, r.fair)), settlement: r.settlement,
});

// A faixa vem da odd combinada que realmente saiu, não de onde eu achei que o bilhete cairia.
function build(id: string, _hint: string, title: string, background: string,
  riskNote: string, confidence: "high" | "medium" | "low",
  legs: BetLeg[], evidenceNotes: string[], alternativeFor?: string): BetSuggestion {
  const combined = parlayDecimal(legs.map((l) => l.oddsDecimal));
  const bandKey = bandFor(combined)?.key ?? _hint;
  const modelled = legs.reduce((a, l) => a * l.fairProbability, 1);
  const ev = expectedValue(legs.map((l) => l.oddsDecimal), legs.map((l) => l.fairProbability));
  let score = 100;
  if (legs.length > 4) score -= (legs.length - 4) * 6;
  return {
    id, kind: legs.length > 1 ? "parlay" : "single", bandKey, title, background, legs,
    combinedDecimal: combined, combinedAmerican: formatAmerican(combined),
    impliedProbability: impliedProbability(combined), modelledProbability: modelled,
    edgePct: Number.isFinite(ev) ? ev * 100 : NaN, riskNote, confidence,
    evidenceScore: Math.max(0, Math.min(100, Math.round(score))),
    evidenceNotes, alternativeFor,
  };
}

// λ ajustados à própria escada de odds da Betano, descartando os degraus travados no teto da casa
// (odd >= 10), que achatam a cauda e inflam o ajuste. Poisson encaixa bem depois disso: vig 0 a -6%.
const L = {
  agoumeFouls: 2.49, romeroFouls: 2.19, ureFouls: 2.00, dieng: 1.80,
  tarregaFouls: 1.93, gayaFouls: 1.85, duroFouls: 1.55,
  duroDrawn: 2.71, satoDrawn: 2.09, elliottDrawn: 1.92, duraDrawn: 1.92,
  agoumeTackles: 3.41, suazoTackles: 3.35, gayaTackles: 3.01,
  romeroShots: 3.45, ureShots: 3.29, sierraShots: 3.27,
};
const SEV_L = 1.50, VAL_L = 0.92;
const pois = (k: number, l: number) => Math.exp(-l) * l ** k / [1,1,2,6,24,120][k];
const gridProb = (pred: (i: number, j: number) => boolean) => {
  let s = 0;
  for (let i = 0; i <= 8; i++) for (let j = 0; j <= 8; j++) {
    const p = (Math.exp(-SEV_L) * SEV_L ** i / factorial(i)) * (Math.exp(-VAL_L) * VAL_L ** j / factorial(j));
    if (pred(i, j)) s += p;
  }
  return s;
};
function factorial(n: number): number { let r = 1; for (let i = 2; i <= n; i++) r *= i; return r; }

const P_SEV = gridProb((i, j) => i > j);
const P_SEV_OR_DRAW = gridProb((i, j) => i >= j);
const P_VAL_U15 = gridProb((_, j) => j <= 1);
const P_SEV_O05 = gridProb((i) => i >= 1);
const P_BTTS_NO = gridProb((i, j) => i === 0 || j === 0);
const P_U25 = gridProb((i, j) => i + j <= 2);

const EV_TEAM = "Sevilha 1,8 gols marcados e 1,5 sofridos por jogo; Valencia 0,2 e 2,2 (4 jogos cada, painel da própria Betano). xG 1,22 x 0,97 — o Valencia finaliza melhor do que o placar sugere, então o 0,2 é azar, não impotência. Blend usado: 1,50 x 0,92.";
const EV_FOULS_SEV = "Sevilha comete 16,8 faltas/jogo, Valencia 9,8. Regredido à liga (peso 4/10) fica 14,2 x 11,4 — a diferença encolhe mas sobrevive.";
const EV_LADDER = "λ ajustado à escada de odds da Betano descartando degraus travados no teto (odd ≥ 10).";

function slate(lang: "pt" | "en"): BetSlate {
  const pt = lang === "pt";
  const suggestions: BetSuggestion[] = [];

  // ---------- SAFE ----------
  suggestions.push(build("safe-0", "safe",
    pt ? "Agoumé comete falta" : "Agoumé to commit a foul",
    pt
      ? "O Sevilha comete 16,8 faltas por jogo e Agoumé é quem mais interrompe jogada no meio. A escada da Betano coloca ele em 2,49 faltas esperadas — o mais alto dos 11 jogadores precificados no confronto."
      : "Sevilla break up play 16.8 times a match, and Agoumé is the one doing most of it. Betano's own ladder prices him at 2.49 expected fouls, the highest of the eleven players quoted in this fixture.",
    pt ? "Se ele começar no banco, a aposta morre antes de começar. Escalações saem ~1h antes." : "If he starts on the bench this is dead before kickoff. Line-ups land about an hour out.",
    "high",
    [leg({
      selection: pt ? "Lucien Agoumé — 1+ falta cometida" : "Lucien Agoumé — 1+ foul committed",
      market: pt ? "Faltas cometidas" : "Fouls committed", odd: 1.09,
      explanation: pt
        ? "λ 2,49 pela escada da casa: P(1+) = 91,7%. A 1,09 o equilíbrio é 91,7% — está no preço justo, sem margem escondida."
        : "λ 2.49 from the book's own ladder puts P(1+) at 91.7%. At 1.09 breakeven is 91.7% — this one is priced at cost.",
      evidence: `${EV_FOULS_SEV} ${EV_LADDER}`,
      fair: poissonAtLeast(1, L.agoumeFouls) * 0.99,
      settlement: { type: "player_prop", player: "Lucien Agoumé", stat: "foulsCommitted", line: 0.5, side: "over", sourceBasis: "escada da Betano + faltas do time" },
    })],
    [pt ? "λ medido na escada da própria casa, não estimado" : "λ measured off the book's own ladder, not guessed"]));

  suggestions.push(build("safe-1", "safe",
    pt ? "Alternativa: Isaac Romero comete falta" : "Alternative: Isaac Romero to commit a foul",
    pt
      ? "Mesma tese, outro jogador, caso o mercado do Agoumé feche ou ele não seja escalado. Romero aparece em 2,19 faltas esperadas."
      : "Same thesis, different name, for when Agoumé's market closes or he doesn't start. Romero comes out at 2.19 expected fouls.",
    pt ? "Atacante comete menos falta que volante — a linha é mais frágil se o Sevilha dominar a posse." : "A forward fouls less than a holding midfielder — this weakens if Sevilla control possession.",
    "medium",
    [leg({
      selection: pt ? "Isaac Romero — 1+ falta cometida" : "Isaac Romero — 1+ foul committed",
      market: pt ? "Faltas cometidas" : "Fouls committed", odd: 1.11,
      explanation: pt ? "λ 2,19 pela escada: P(1+) = 88,8%, contra 90,1% de equilíbrio a 1,11." : "λ 2.19 off the ladder gives P(1+) = 88.8% against a 90.1% breakeven at 1.11.",
      evidence: `${EV_FOULS_SEV} ${EV_LADDER}`,
      fair: poissonAtLeast(1, L.romeroFouls) * 0.99,
      settlement: { type: "player_prop", player: "Isaac Romero", stat: "foulsCommitted", line: 0.5, side: "over", sourceBasis: "escada da Betano + faltas do time" },
    })],
    [pt ? "cobertura para o mesmo cenário, jogador diferente" : "covers the same scenario with a different name"], "safe-0"));

  // ---------- VALUE ----------
  suggestions.push(build("value-0", "value",
    pt ? "Sevilha vence em casa" : "Sevilla to win at home",
    pt
      ? "O Valencia marcou 1 gol em 4 jogos e sofre 2,2 por partida. Mas o xG dele (0,97) diz que a seca é pontaria, não criação — então eu não trato isso como time morto. Meu blend dá 50,8% para o Sevilha contra 48,1% que o mercado precifica."
      : "Valencia have scored once in four games and ship 2.2 a match. Their xG of 0.97 says that's finishing, not creation, so I won't treat them as dead. My blend lands Sevilla at 50.8% against the 48.1% the market prices.",
    pt ? "Vantagem de 2,7 pontos percentuais é ruído, não convicção. O Sevilha não vence o Valencia há 6 jogos." : "A 2.7-point gap is noise, not conviction. Sevilla haven't beaten Valencia in six meetings.",
    "medium",
    [leg({
      selection: pt ? "Sevilha FC vence" : "Sevilla FC to win", market: pt ? "Resultado final" : "Match result", odd: 2.00,
      explanation: pt
        ? "Grade Poisson 1,50 x 0,92 dá 50,8%; a 2,00 o equilíbrio é 50,0%. Margem mínima e honesta."
        : "A 1.50 x 0.92 Poisson grid gives 50.8%; breakeven at 2.00 is 50.0%. The margin is thin and I'm not dressing it up.",
      evidence: `${EV_TEAM} Mercado sem vig: Sevilha 48,1% / empate 28,9% / Valencia 23,0%.`,
      fair: P_SEV,
      settlement: { type: "moneyline", teamAbbreviation: "SEV", side: "home", sourceBasis: "grade Poisson vs mercado Betano" },
    })],
    [pt ? "única linha principal onde meu modelo passa o mercado" : "the one main line where my model clears the market"]));

  suggestions.push(build("value-1", "value",
    pt ? "Alternativa: Sevilha não perde + Valencia até 1 gol" : "Alternative: Sevilla unbeaten + Valencia under 1.5",
    pt
      ? "Se a vitória simples parecer apertada demais, essa é a mesma leitura com rede embaixo: o Sevilha não perde e o ataque do Valencia continua travado."
      : "If the straight win looks too tight, this is the same read with a net under it: Sevilla don't lose and Valencia's attack stays stuck.",
    pt ? "As duas pernas apostam no mesmo jogo — se o Valencia marcar duas vezes, as duas caem juntas." : "Both legs ride the same game state — two Valencia goals and they fall together.",
    "medium",
    [
      leg({
        selection: pt ? "Sevilha FC ou empate" : "Sevilla FC or draw", market: pt ? "Chance dupla" : "Double chance", odd: 1.26,
        explanation: pt ? "Grade dá 76,9% para o Sevilha não perder." : "The grid gives 76.9% for Sevilla avoiding defeat.",
        evidence: EV_TEAM, fair: P_SEV_OR_DRAW,
        settlement: { type: "other", teamAbbreviation: "SEV", side: "home", sourceBasis: "grade Poisson" },
      }),
      leg({
        selection: pt ? "Valencia menos de 1,5 gol" : "Valencia under 1.5 goals", market: pt ? "Total de gols do time" : "Team total", odd: 1.26,
        explanation: pt ? "λ 0,92 dá 76,5% para o Valencia ficar em 0 ou 1 gol." : "λ 0.92 puts Valencia at 0 or 1 goal 76.5% of the time.",
        evidence: "Valencia marcou 1 gol em 4 jogos; xG 0,97 sugere regressão para cima, e por isso uso 0,92 e não 0,2.",
        fair: P_VAL_U15,
        settlement: { type: "total", teamAbbreviation: "VAL", line: 1.5, side: "under", sourceBasis: "xG + gols marcados" },
      }),
    ],
    [pt ? "duas pernas correlacionadas — a odd combinada exagera o risco real" : "two correlated legs — the combined price overstates the true risk"], "value-0"));

  // ---------- MID ----------
  suggestions.push(build("mid-0", "mid",
    pt ? "O jogo de faltas do Sevilha" : "Sevilla's foul game",
    pt
      ? "Essa é a leitura mais forte do confronto e ela não está no placar. O Sevilha comete 16,8 faltas por jogo, o Valencia 9,8 — quase o dobro. Do lado do Valencia sofrendo falta ainda sobra espaço: os 4 jogadores cotados somam 8,64 faltas esperadas contra 14,2 que o Sevilha entrega. Do lado do Sevilha sofrendo, a casa já empilhou 82% das faltas do Valencia em 4 nomes, e por isso eu não toco naquele lado."
      : "This is the sharpest read in the fixture and it never shows up in the scoreline. Sevilla commit 16.8 fouls a game to Valencia's 9.8. On the Valencia-fouled side there's still room: the four quoted players add up to 8.64 expected fouls against the 14.2 Sevilla hand out. On the Sevilla-fouled side the book has already stacked 82% of Valencia's entire foul count into four names, which is why I leave it alone.",
    pt ? "Três pernas de jogador, três escalações que precisam confirmar. Volume de falta desaba se o jogo for morno." : "Three player legs means three line-ups to confirm. Foul volume collapses if the game stays flat.",
    "medium",
    [
      leg({
        selection: pt ? "Hugo Duro — 2+ faltas sofridas" : "Hugo Duro — 2+ fouls drawn", market: pt ? "Faltas sofridas" : "Fouls drawn", odd: 1.39,
        explanation: pt ? "λ 2,71 na escada: P(2+) = 75,3%; equilíbrio a 1,39 é 71,9%." : "λ 2.71 on the ladder: P(2+) = 75.3% against a 71.9% breakeven at 1.39.",
        evidence: `${EV_FOULS_SEV} Duro é o centroavante que segura a bola de costas — é nele que a falta tática cai. ${EV_LADDER}`,
        fair: devig(1.39) * 1.02,
        settlement: { type: "player_prop", player: "Hugo Duro", stat: "foulsDrawn", line: 1.5, side: "over", sourceBasis: "escada da Betano + faltas do adversário" },
      }),
      leg({
        selection: pt ? "Lucien Agoumé — 2+ faltas cometidas" : "Lucien Agoumé — 2+ fouls committed", market: pt ? "Faltas cometidas" : "Fouls committed", odd: 1.52,
        explanation: pt ? "λ 2,49: P(2+) = 71,1%; equilíbrio a 1,52 é 65,8%." : "λ 2.49: P(2+) = 71.1% against a 65.8% breakeven at 1.52.",
        evidence: `${EV_FOULS_SEV} ${EV_LADDER}`,
        fair: devig(1.52) * 1.02,
        settlement: { type: "player_prop", player: "Lucien Agoumé", stat: "foulsCommitted", line: 1.5, side: "over", sourceBasis: "escada da Betano + faltas do time" },
      }),
      leg({
        selection: pt ? "Ryunosuke Sato — 1+ falta sofrida" : "Ryunosuke Sato — 1+ foul drawn", market: pt ? "Faltas sofridas" : "Fouls drawn", odd: 1.13,
        explanation: pt ? "λ 2,09: P(1+) = 87,6%; equilíbrio a 1,13 é 88,5%. Perna de amarração, não de valor." : "λ 2.09: P(1+) = 87.6% against 88.5% breakeven. This is glue, not value.",
        evidence: `${EV_FOULS_SEV} ${EV_LADDER}`,
        fair: devig(1.13) * 1.02,
        settlement: { type: "player_prop", player: "Ryunosuke Sato", stat: "foulsDrawn", line: 0.5, side: "over", sourceBasis: "escada da Betano + faltas do adversário" },
      }),
    ],
    [pt ? "cruzamento de estatística de time com escada de jogador da mesma casa" : "team-level stat cross-checked against the same book's player ladders",
     pt ? "lado do Sevilha sofrendo falta foi analisado e descartado por estar rico" : "the Sevilla-fouled side was analysed and dropped as too rich"]));

  suggestions.push(build("mid-1", "mid",
    pt ? "Alternativa: desarmes no lugar das faltas" : "Alternative: tackles instead of fouls",
    pt
      ? "Mesma ideia — jogo truncado, muita disputa — por outra porta, caso os mercados de falta fechem. Agoumé e Suazo são os dois maiores λ de desarme da partida."
      : "Same idea — a scrappy, high-duel game — through a different door if the foul markets close. Agoumé and Suazo carry the two highest tackle λ in the match.",
    pt ? "Desarme é estatística mais dependente de quem tem a bola; se o Sevilha dominar, os números do Valencia caem." : "Tackles depend on who has the ball; if Sevilla dominate, Valencia's numbers drop.",
    "medium",
    [
      leg({
        selection: pt ? "Lucien Agoumé — 2+ desarmes" : "Lucien Agoumé — 2+ tackles", market: pt ? "Desarmes" : "Tackles", odd: 1.19,
        explanation: pt ? "λ 3,41: P(2+) = 85,4%; equilíbrio a 1,19 é 84,0%." : "λ 3.41: P(2+) = 85.4% against an 84.0% breakeven.",
        evidence: `Maior λ de desarme do confronto. ${EV_LADDER}`,
        fair: devig(1.19) * 1.02,
        settlement: { type: "player_prop", player: "Lucien Agoumé", stat: "tackles", line: 1.5, side: "over", sourceBasis: "escada da Betano" },
      }),
      leg({
        selection: pt ? "Gabriel Suazo — 2+ desarmes" : "Gabriel Suazo — 2+ tackles", market: pt ? "Desarmes" : "Tackles", odd: 1.20,
        explanation: pt ? "λ 3,35: P(2+) = 84,7%; equilíbrio a 1,20 é 83,3%." : "λ 3.35: P(2+) = 84.7% against an 83.3% breakeven.",
        evidence: `Lateral do Sevilha, segundo maior λ de desarme. ${EV_LADDER}`,
        fair: devig(1.20) * 1.02,
        settlement: { type: "player_prop", player: "Gabriel Suazo", stat: "tackles", line: 1.5, side: "over", sourceBasis: "escada da Betano" },
      }),
      leg({
        selection: pt ? "Hugo Duro — 2+ faltas sofridas" : "Hugo Duro — 2+ fouls drawn", market: pt ? "Faltas sofridas" : "Fouls drawn", odd: 1.39,
        explanation: pt ? "Mantida da versão principal: é a perna com mais folga estrutural." : "Kept from the main ticket: it's the leg with the most structural room.",
        evidence: EV_FOULS_SEV, fair: devig(1.39) * 1.02,
        settlement: { type: "player_prop", player: "Hugo Duro", stat: "foulsDrawn", line: 1.5, side: "over", sourceBasis: "escada da Betano + faltas do adversário" },
      }),
    ],
    [pt ? "mesma tese de jogo truncado, mercado diferente" : "same scrappy-game thesis through a different market"], "mid-0"));

  // ---------- LONG ----------
  suggestions.push(build("long-0", "long",
    pt ? "Sevilha aperta e o jogo trava" : "Sevilla squeeze and the game snags",
    pt
      ? "Cenário: Sevilha vence, Valencia não passa de um gol, e o jogo tem o volume de falta que os dois números de time preveem. Tudo aqui vem da mesma leitura, o que é bom para coerência e ruim para diversificação."
      : "The scenario: Sevilla win, Valencia don't get past one, and the game carries the foul volume both team numbers imply. It all comes from one read — good for coherence, bad for diversification.",
    pt ? "Cinco pernas correlacionadas. Uma escalação surpresa derruba metade do bilhete." : "Five correlated legs. One surprise team sheet takes out half the ticket.",
    "low",
    [
      leg({ selection: pt ? "Sevilha FC vence" : "Sevilla FC to win", market: pt ? "Resultado final" : "Match result", odd: 2.00,
        explanation: pt ? "50,8% na grade contra 50,5% de equilíbrio." : "50.8% on the grid against a 50.5% breakeven.",
        evidence: EV_TEAM, fair: P_SEV,
        settlement: { type: "moneyline", teamAbbreviation: "SEV", side: "home", sourceBasis: "grade Poisson" } }),
      leg({ selection: pt ? "Valencia menos de 1,5 gol" : "Valencia under 1.5 goals", market: pt ? "Total do time" : "Team total", odd: 1.26,
        explanation: pt ? "λ 0,92 dá 76,5%." : "λ 0.92 gives 76.5%.",
        evidence: "xG 0,97 — uso 0,92 e não os 0,2 do placar.", fair: P_VAL_U15,
        settlement: { type: "total", teamAbbreviation: "VAL", line: 1.5, side: "under", sourceBasis: "xG" } }),
      leg({ selection: pt ? "Hugo Duro — 2+ faltas sofridas" : "Hugo Duro — 2+ fouls drawn", market: pt ? "Faltas sofridas" : "Fouls drawn", odd: 1.39,
        explanation: pt ? "λ 2,71: 75,3%." : "λ 2.71: 75.3%.", evidence: EV_FOULS_SEV, fair: devig(1.39) * 1.02,
        settlement: { type: "player_prop", player: "Hugo Duro", stat: "foulsDrawn", line: 1.5, side: "over", sourceBasis: "escada da Betano" } }),
      leg({ selection: pt ? "Lucien Agoumé — 2+ faltas cometidas" : "Lucien Agoumé — 2+ fouls committed", market: pt ? "Faltas cometidas" : "Fouls committed", odd: 1.52,
        explanation: pt ? "λ 2,49: 71,1%." : "λ 2.49: 71.1%.", evidence: EV_FOULS_SEV, fair: devig(1.52) * 1.02,
        settlement: { type: "player_prop", player: "Lucien Agoumé", stat: "foulsCommitted", line: 1.5, side: "over", sourceBasis: "escada da Betano" } }),
      leg({ selection: pt ? "Isaac Romero — 2+ finalizações" : "Isaac Romero — 2+ shots", market: pt ? "Chutes" : "Shots", odd: 1.17,
        explanation: pt ? "λ 3,45 é o maior de finalização do jogo: P(2+) = 96,2% pelo ajuste, mas Poisson exagera cauda de chute, então corto para 88%." : "λ 3.45 is the highest shot rate in the match. The fit says 96.2%, but Poisson overstates shot tails, so I cut it to 88%.",
        evidence: `Sevilha finaliza 5,0 vezes por jogo em média. ${EV_LADDER}`, fair: 0.88,
        settlement: { type: "player_prop", player: "Isaac Romero", stat: "shots", line: 1.5, side: "over", sourceBasis: "escada da Betano" } }),
    ],
    [pt ? "5 pernas — cada uma é mais um jeito de perder" : "5 legs — each one is another way to lose",
     pt ? "probabilidade de finalização cortada à mão por desconfiança do Poisson na cauda" : "shot probability hand-cut because Poisson overstates that tail"]));

  suggestions.push(build("long-1", "long",
    pt ? "Alternativa: sem a perna de resultado" : "Alternative: drop the result leg",
    pt
      ? "Mesmo bilhete tirando o Resultado Final, que é a perna mais imprevisível. Troca por volume de finalização do Sevilha, que depende menos de quem ganha."
      : "The same ticket without the match result, which is the least predictable leg. Swapped for Sevilla shot volume, which cares less about who wins.",
    pt ? "Continua com 5 pernas correlacionadas; só troquei uma incerteza por outra menor." : "Still five correlated legs; I've swapped one uncertainty for a smaller one.",
    "low",
    [
      leg({ selection: pt ? "Sevilha marca 1+ gol" : "Sevilla to score 1+", market: pt ? "Total do time" : "Team total", odd: 1.27,
        explanation: pt ? "λ 1,50 dá 77,7% para o Sevilha marcar." : "λ 1.50 gives Sevilla 77.7% to score.", evidence: EV_TEAM, fair: P_SEV_O05,
        settlement: { type: "total", teamAbbreviation: "SEV", line: 0.5, side: "over", sourceBasis: "grade Poisson" } }),
      leg({ selection: pt ? "Valencia menos de 1,5 gol" : "Valencia under 1.5 goals", market: pt ? "Total do time" : "Team total", odd: 1.26,
        explanation: pt ? "λ 0,92: 76,5%." : "λ 0.92: 76.5%.", evidence: "xG 0,97.", fair: P_VAL_U15,
        settlement: { type: "total", teamAbbreviation: "VAL", line: 1.5, side: "under", sourceBasis: "xG" } }),
      leg({ selection: pt ? "Hugo Duro — 2+ faltas sofridas" : "Hugo Duro — 2+ fouls drawn", market: pt ? "Faltas sofridas" : "Fouls drawn", odd: 1.39,
        explanation: pt ? "λ 2,71: 75,3%." : "λ 2.71: 75.3%.", evidence: EV_FOULS_SEV, fair: devig(1.39) * 1.02,
        settlement: { type: "player_prop", player: "Hugo Duro", stat: "foulsDrawn", line: 1.5, side: "over", sourceBasis: "escada da Betano" } }),
      leg({ selection: pt ? "Gabriel Suazo — 2+ desarmes" : "Gabriel Suazo — 2+ tackles", market: pt ? "Desarmes" : "Tackles", odd: 1.20,
        explanation: pt ? "λ 3,35: 84,7%." : "λ 3.35: 84.7%.", evidence: EV_LADDER, fair: devig(1.20) * 1.02,
        settlement: { type: "player_prop", player: "Gabriel Suazo", stat: "tackles", line: 1.5, side: "over", sourceBasis: "escada da Betano" } }),
      leg({ selection: pt ? "Isaac Romero — 2+ finalizações" : "Isaac Romero — 2+ shots", market: pt ? "Chutes" : "Shots", odd: 1.17,
        explanation: pt ? "Cortado para 88% pelo mesmo motivo do bilhete anterior." : "Cut to 88% for the same reason as the previous ticket.", evidence: EV_LADDER, fair: 0.88,
        settlement: { type: "player_prop", player: "Isaac Romero", stat: "shots", line: 1.5, side: "over", sourceBasis: "escada da Betano" } }),
    ],
    [pt ? "troca a perna de maior variância por uma de volume" : "swaps the highest-variance leg for a volume one"], "long-0"));

  // ---------- MOONSHOT ----------
  suggestions.push(build("moon-0", "moonshot",
    pt ? "O jogo feio inteiro" : "The whole ugly game",
    pt
      ? "Bilhete de tese única levado ao extremo: o confronto vira exatamente o que os números de falta descrevem, e o Sevilha resolve por pouco. Sete pernas — isso é bilhete de sonho, não de banca."
      : "One thesis taken to its limit: the match becomes exactly what the foul numbers describe and Sevilla edge it. Seven legs — this is a dream ticket, not a bankroll one.",
    pt ? "Sete pernas correlacionadas dão ~19% de chance combinada. Aposte o que você não se importa de perder." : "Seven correlated legs land near 19% combined. Stake only what you don't mind losing.",
    "low",
    [
      leg({ selection: pt ? "Sevilha FC vence" : "Sevilla FC to win", market: pt ? "Resultado final" : "Match result", odd: 2.00,
        explanation: pt ? "50,8%." : "50.8%.", evidence: EV_TEAM, fair: P_SEV,
        settlement: { type: "moneyline", teamAbbreviation: "SEV", side: "home", sourceBasis: "grade Poisson" } }),
      leg({ selection: pt ? "Menos de 2,5 gols" : "Under 2.5 goals", market: pt ? "Total de gols" : "Total goals", odd: 1.62,
        explanation: pt ? "Grade dá 56,4%; equilíbrio a 1,62 é 61,7%. Perna negativa, entra só pela correlação com o resto." : "The grid gives 56.4% against a 61.7% breakeven. A negative leg, in purely for its correlation with the rest.",
        evidence: "xG somado 2,19 contra 2,35 implícito no mercado.", fair: P_U25,
        settlement: { type: "total", line: 2.5, side: "under", sourceBasis: "xG vs mercado" } }),
      leg({ selection: pt ? "Ambas marcam — Não" : "Both teams to score — No", market: "BTTS", odd: 1.75,
        explanation: pt ? "Grade dá 56,9% contra 57,1% de equilíbrio — praticamente neutra." : "The grid gives 56.9% against a 57.1% breakeven — all but neutral.",
        evidence: EV_TEAM, fair: P_BTTS_NO,
        settlement: { type: "other", side: "no", sourceBasis: "grade Poisson" } }),
      leg({ selection: pt ? "Hugo Duro — 2+ faltas sofridas" : "Hugo Duro — 2+ fouls drawn", market: pt ? "Faltas sofridas" : "Fouls drawn", odd: 1.39,
        explanation: pt ? "λ 2,71." : "λ 2.71.", evidence: EV_FOULS_SEV, fair: devig(1.39) * 1.02,
        settlement: { type: "player_prop", player: "Hugo Duro", stat: "foulsDrawn", line: 1.5, side: "over", sourceBasis: "escada da Betano" } }),
      leg({ selection: pt ? "Lucien Agoumé — 2+ faltas cometidas" : "Lucien Agoumé — 2+ fouls committed", market: pt ? "Faltas cometidas" : "Fouls committed", odd: 1.52,
        explanation: pt ? "λ 2,49." : "λ 2.49.", evidence: EV_FOULS_SEV, fair: devig(1.52) * 1.02,
        settlement: { type: "player_prop", player: "Lucien Agoumé", stat: "foulsCommitted", line: 1.5, side: "over", sourceBasis: "escada da Betano" } }),
      leg({ selection: pt ? "Lucien Agoumé — 3+ desarmes" : "Lucien Agoumé — 3+ tackles", market: pt ? "Desarmes" : "Tackles", odd: 1.62,
        explanation: pt ? "λ 3,41: P(3+) = 66,1%." : "λ 3.41: P(3+) = 66.1%.", evidence: EV_LADDER, fair: devig(1.62) * 1.02,
        settlement: { type: "player_prop", player: "Lucien Agoumé", stat: "tackles", line: 2.5, side: "over", sourceBasis: "escada da Betano" } }),
      leg({ selection: pt ? "Isaac Romero — 3+ finalizações" : "Isaac Romero — 3+ shots", market: pt ? "Chutes" : "Shots", odd: 1.60,
        explanation: pt ? "λ 3,45: ajuste dá 70%, corto para 63% pela cauda." : "λ 3.45: the fit says 70%, cut to 63% for the tail.", evidence: EV_LADDER, fair: 0.63,
        settlement: { type: "player_prop", player: "Isaac Romero", stat: "shots", line: 2.5, side: "over", sourceBasis: "escada da Betano" } }),
    ],
    [pt ? "7 pernas — cada uma é mais um jeito de perder" : "7 legs — each one is another way to lose",
     pt ? "inclui uma perna de EV negativo assumido, mantida pela correlação" : "includes one knowingly negative-EV leg, kept for correlation"]));

  suggestions.push(build("moon-1", "moonshot",
    pt ? "Alternativa: mesmo sonho sem gols baixos" : "Alternative: same dream without the low-scoring legs",
    pt
      ? "Tira as duas pernas de placar baixo — que são as que eu menos acredito — e coloca mais volume de jogador no lugar. Odd parecida, tese mais limpa."
      : "Drops the two low-scoring legs, the ones I believe least, and puts more player volume in their place. Similar price, cleaner thesis.",
    pt ? "Continua sendo bilhete de 7 pernas. A diferença é que agora todas saem da mesma estatística medida." : "Still a seven-leg ticket. The difference is that every leg now comes from the same measured stat.",
    "low",
    [
      leg({ selection: pt ? "Sevilha FC vence" : "Sevilla FC to win", market: pt ? "Resultado final" : "Match result", odd: 2.00,
        explanation: pt ? "50,8%." : "50.8%.", evidence: EV_TEAM, fair: P_SEV,
        settlement: { type: "moneyline", teamAbbreviation: "SEV", side: "home", sourceBasis: "grade Poisson" } }),
      leg({ selection: pt ? "Hugo Duro — 3+ faltas sofridas" : "Hugo Duro — 3+ fouls drawn", market: pt ? "Faltas sofridas" : "Fouls drawn", odd: 2.18,
        explanation: pt ? "λ 2,71: P(3+) = 50,7%; equilíbrio a 2,18 é 45,9%." : "λ 2.71: P(3+) = 50.7% against a 45.9% breakeven.", evidence: EV_FOULS_SEV, fair: devig(2.18) * 1.02,
        settlement: { type: "player_prop", player: "Hugo Duro", stat: "foulsDrawn", line: 2.5, side: "over", sourceBasis: "escada da Betano" } }),
      leg({ selection: pt ? "Ryunosuke Sato — 2+ faltas sofridas" : "Ryunosuke Sato — 2+ fouls drawn", market: pt ? "Faltas sofridas" : "Fouls drawn", odd: 1.67,
        explanation: pt ? "λ 2,09: P(2+) = 63,4%." : "λ 2.09: P(2+) = 63.4%.", evidence: EV_FOULS_SEV, fair: devig(1.67) * 1.02,
        settlement: { type: "player_prop", player: "Ryunosuke Sato", stat: "foulsDrawn", line: 1.5, side: "over", sourceBasis: "escada da Betano" } }),
      leg({ selection: pt ? "Lucien Agoumé — 2+ faltas cometidas" : "Lucien Agoumé — 2+ fouls committed", market: pt ? "Faltas cometidas" : "Fouls committed", odd: 1.52,
        explanation: pt ? "λ 2,49." : "λ 2.49.", evidence: EV_FOULS_SEV, fair: devig(1.52) * 1.02,
        settlement: { type: "player_prop", player: "Lucien Agoumé", stat: "foulsCommitted", line: 1.5, side: "over", sourceBasis: "escada da Betano" } }),
      leg({ selection: pt ? "Lucien Agoumé — 3+ desarmes" : "Lucien Agoumé — 3+ tackles", market: pt ? "Desarmes" : "Tackles", odd: 1.62,
        explanation: pt ? "λ 3,41." : "λ 3.41.", evidence: EV_LADDER, fair: devig(1.62) * 1.02,
        settlement: { type: "player_prop", player: "Lucien Agoumé", stat: "tackles", line: 2.5, side: "over", sourceBasis: "escada da Betano" } }),
      leg({ selection: pt ? "Gabriel Suazo — 3+ desarmes" : "Gabriel Suazo — 3+ tackles", market: pt ? "Desarmes" : "Tackles", odd: 1.67,
        explanation: pt ? "λ 3,35: P(3+) = 65,2%." : "λ 3.35: P(3+) = 65.2%.", evidence: EV_LADDER, fair: devig(1.67) * 1.02,
        settlement: { type: "player_prop", player: "Gabriel Suazo", stat: "tackles", line: 2.5, side: "over", sourceBasis: "escada da Betano" } }),
      leg({ selection: pt ? "Isaac Romero — 3+ finalizações" : "Isaac Romero — 3+ shots", market: pt ? "Chutes" : "Shots", odd: 1.60,
        explanation: pt ? "Cortado para 63%." : "Cut to 63%.", evidence: EV_LADDER, fair: 0.63,
        settlement: { type: "player_prop", player: "Isaac Romero", stat: "shots", line: 2.5, side: "over", sourceBasis: "escada da Betano" } }),
    ],
    [pt ? "todas as pernas saem de estatística medida na mesma página" : "every leg comes from a stat measured on the same page"], "moon-0"));


  // ---------- 100x+ e 400x ----------
  // Placar exato é a perna que estica a odd sem inventar mercado: 2-0 sai a 9,00 e é o resultado
  // mais provável dentro do cenário que o resto do bilhete já descreve.
  suggestions.push(build("sky-0", "moonshot",
    pt ? "2 a 0 com o jogo picado" : "2-0 in a chopped-up game",
    pt
      ? "Ancorado no placar exato 2-0, que a grade Poisson coloca em 11,2% — o segundo resultado mais provável do jogo, e o mais provável entre as vitórias do Sevilha. Em volta dele vão as mesmas pernas de falta e desarme que sustentam os bilhetes curtos."
      : "Anchored on a 2-0 correct score, which the Poisson grid puts at 11.2% — the second most likely scoreline in the match and the likeliest of Sevilla's wins. Around it sit the same foul and tackle legs that carry the short tickets.",
    pt ? "Placar exato erra na imensa maioria das vezes. Trate como bilhete de bolso." : "Correct score misses the overwhelming majority of the time. Treat it as pocket change.",
    "low",
    [
      leg({ selection: pt ? "Sevilha 2 x 0 Valencia" : "Sevilla 2-0 Valencia", market: pt ? "Resultado correto" : "Correct score", odd: 9.00,
        explanation: pt ? "Grade 1,50 x 0,92 dá 11,2% para o 2-0; equilíbrio a 9,00 é 11,1%." : "The 1.50 x 0.92 grid gives 11.2% for 2-0 against an 11.1% breakeven at 9.00.",
        evidence: EV_TEAM, fair: gridProb((i, j) => i === 2 && j === 0),
        settlement: { type: "other", teamAbbreviation: "SEV", sourceBasis: "grade Poisson" } }),
      leg({ selection: pt ? "Lucien Agoumé — 3+ faltas cometidas" : "Lucien Agoumé — 3+ fouls committed", market: pt ? "Faltas cometidas" : "Fouls committed", odd: 2.55,
        explanation: pt ? "λ 2,49: P(3+) = 45,6%; equilíbrio a 2,55 é 39,2%." : "λ 2.49: P(3+) = 45.6% against a 39.2% breakeven at 2.55.",
        evidence: EV_FOULS_SEV, fair: devig(2.55) * 1.02,
        settlement: { type: "player_prop", player: "Lucien Agoumé", stat: "foulsCommitted", line: 2.5, side: "over", sourceBasis: "escada da Betano" } }),
      leg({ selection: pt ? "Hugo Duro — 3+ faltas sofridas" : "Hugo Duro — 3+ fouls drawn", market: pt ? "Faltas sofridas" : "Fouls drawn", odd: 2.18,
        explanation: pt ? "λ 2,71: P(3+) = 50,7%." : "λ 2.71: P(3+) = 50.7%.", evidence: EV_FOULS_SEV, fair: devig(2.18) * 1.02,
        settlement: { type: "player_prop", player: "Hugo Duro", stat: "foulsDrawn", line: 2.5, side: "over", sourceBasis: "escada da Betano" } }),
      leg({ selection: pt ? "Gabriel Suazo — 3+ desarmes" : "Gabriel Suazo — 3+ tackles", market: pt ? "Desarmes" : "Tackles", odd: 1.67,
        explanation: pt ? "λ 3,35: P(3+) = 65,2%." : "λ 3.35: P(3+) = 65.2%.", evidence: EV_LADDER, fair: devig(1.67) * 1.02,
        settlement: { type: "player_prop", player: "Gabriel Suazo", stat: "tackles", line: 2.5, side: "over", sourceBasis: "escada da Betano" } }),
      leg({ selection: pt ? "Isaac Romero — 3+ finalizações" : "Isaac Romero — 3+ shots", market: pt ? "Chutes" : "Shots", odd: 1.60,
        explanation: pt ? "Ajuste dá 70%, cortado para 63%." : "The fit says 70%, cut to 63%.", evidence: EV_LADDER, fair: 0.63,
        settlement: { type: "player_prop", player: "Isaac Romero", stat: "shots", line: 2.5, side: "over", sourceBasis: "escada da Betano" } }),
    ],
    [pt ? "âncora em placar exato, o resto sai da mesma tese de faltas" : "correct-score anchor, everything else from the same foul thesis"]));

  suggestions.push(build("sky-1", "moonshot",
    pt ? "Alternativa: 1 a 0 no lugar do 2 a 0" : "Alternative: 1-0 instead of 2-0",
    pt
      ? "Mesmo bilhete trocando o placar: 1-0 paga menos (6,00) mas é o resultado mais provável de todos na grade, com 13,6%. Se o mercado de placar exato fechar em um, normalmente o outro ainda está aberto."
      : "The same ticket with the scoreline swapped: 1-0 pays less at 6.00 but is the single likeliest result on the grid at 13.6%. When one correct-score market closes, the other is usually still up.",
    pt ? "Continua sendo placar exato. A alternativa reduz a odd, não o risco de errar o placar." : "It's still correct score. The alternative cuts the price, not the odds of missing the scoreline.",
    "low",
    [
      leg({ selection: pt ? "Sevilha 1 x 0 Valencia" : "Sevilla 1-0 Valencia", market: pt ? "Resultado correto" : "Correct score", odd: 6.00,
        explanation: pt ? "Grade dá 13,6% para o 1-0; equilíbrio a 6,00 é 16,7%. Perna cara, mas é a âncora." : "The grid gives 13.6% for 1-0 against a 16.7% breakeven at 6.00. An expensive leg, but it's the anchor.",
        evidence: EV_TEAM, fair: gridProb((i, j) => i === 1 && j === 0),
        settlement: { type: "other", teamAbbreviation: "SEV", sourceBasis: "grade Poisson" } }),
      leg({ selection: pt ? "Lucien Agoumé — 3+ faltas cometidas" : "Lucien Agoumé — 3+ fouls committed", market: pt ? "Faltas cometidas" : "Fouls committed", odd: 2.55,
        explanation: pt ? "λ 2,49: 45,6%." : "λ 2.49: 45.6%.", evidence: EV_FOULS_SEV, fair: devig(2.55) * 1.02,
        settlement: { type: "player_prop", player: "Lucien Agoumé", stat: "foulsCommitted", line: 2.5, side: "over", sourceBasis: "escada da Betano" } }),
      leg({ selection: pt ? "Hugo Duro — 3+ faltas sofridas" : "Hugo Duro — 3+ fouls drawn", market: pt ? "Faltas sofridas" : "Fouls drawn", odd: 2.18,
        explanation: pt ? "λ 2,71: 50,7%." : "λ 2.71: 50.7%.", evidence: EV_FOULS_SEV, fair: devig(2.18) * 1.02,
        settlement: { type: "player_prop", player: "Hugo Duro", stat: "foulsDrawn", line: 2.5, side: "over", sourceBasis: "escada da Betano" } }),
      leg({ selection: pt ? "Lucien Agoumé — 4+ desarmes" : "Lucien Agoumé — 4+ tackles", market: pt ? "Desarmes" : "Tackles", odd: 2.55,
        explanation: pt ? "λ 3,41: P(4+) = 44,2%." : "λ 3.41: P(4+) = 44.2%.", evidence: EV_LADDER, fair: devig(2.55) * 1.02,
        settlement: { type: "player_prop", player: "Lucien Agoumé", stat: "tackles", line: 3.5, side: "over", sourceBasis: "escada da Betano" } }),
      leg({ selection: pt ? "Isaac Romero — 3+ finalizações" : "Isaac Romero — 3+ shots", market: pt ? "Chutes" : "Shots", odd: 1.60,
        explanation: pt ? "Cortado para 63%." : "Cut to 63%.", evidence: EV_LADDER, fair: 0.63,
        settlement: { type: "player_prop", player: "Isaac Romero", stat: "shots", line: 2.5, side: "over", sourceBasis: "escada da Betano" } }),
    ],
    [pt ? "placar alternativo para quando o primeiro fechar" : "an alternative scoreline for when the first one closes"], "sky-0"));

  suggestions.push(build("lot-0", "lottery",
    pt ? "A loteria das faltas" : "The foul lottery",
    pt
      ? "Aqui eu subo todos os degraus de uma vez: Agoumé em 4+ faltas, Duro em 3+ sofridas, e o placar exato 2-0. É o mesmo jogo que descrevi o dia inteiro, levado ao degrau onde a casa já trava o preço. Não é aposta de valor, é aposta de sonho — e está declarado."
      : "Here I climb every rung at once: Agoumé at 4+ fouls, Duro at 3+ drawn, and the 2-0 scoreline. It's the same match I've described all day, pushed to the rung where the book starts capping prices. This is not a value bet, it's a dream bet, and it says so.",
    pt ? "Chance combinada abaixo de 1%. Se você apostar isso esperando lucro, leu errado." : "Combined chance under 1%. If you're staking this expecting profit, you've misread it.",
    "low",
    [
      leg({ selection: pt ? "Sevilha 2 x 0 Valencia" : "Sevilla 2-0 Valencia", market: pt ? "Resultado correto" : "Correct score", odd: 9.00,
        explanation: pt ? "11,2% na grade." : "11.2% on the grid.", evidence: EV_TEAM, fair: gridProb((i, j) => i === 2 && j === 0),
        settlement: { type: "other", teamAbbreviation: "SEV", sourceBasis: "grade Poisson" } }),
      leg({ selection: pt ? "Lucien Agoumé — 4+ faltas cometidas" : "Lucien Agoumé — 4+ fouls committed", market: pt ? "Faltas cometidas" : "Fouls committed", odd: 5.00,
        explanation: pt ? "λ 2,49: P(4+) = 24,2%; equilíbrio a 5,00 é 20,0%." : "λ 2.49: P(4+) = 24.2% against a 20.0% breakeven at 5.00.",
        evidence: EV_FOULS_SEV, fair: devig(5.00) * 1.02,
        settlement: { type: "player_prop", player: "Lucien Agoumé", stat: "foulsCommitted", line: 3.5, side: "over", sourceBasis: "escada da Betano" } }),
      leg({ selection: pt ? "Hugo Duro — 3+ faltas sofridas" : "Hugo Duro — 3+ fouls drawn", market: pt ? "Faltas sofridas" : "Fouls drawn", odd: 2.18,
        explanation: pt ? "50,7%." : "50.7%.", evidence: EV_FOULS_SEV, fair: devig(2.18) * 1.02,
        settlement: { type: "player_prop", player: "Hugo Duro", stat: "foulsDrawn", line: 2.5, side: "over", sourceBasis: "escada da Betano" } }),
      leg({ selection: pt ? "Gabriel Suazo — 3+ desarmes" : "Gabriel Suazo — 3+ tackles", market: pt ? "Desarmes" : "Tackles", odd: 1.67,
        explanation: pt ? "65,2%." : "65.2%.", evidence: EV_LADDER, fair: devig(1.67) * 1.02,
        settlement: { type: "player_prop", player: "Gabriel Suazo", stat: "tackles", line: 2.5, side: "over", sourceBasis: "escada da Betano" } }),
      leg({ selection: pt ? "Ryunosuke Sato — 2+ faltas sofridas" : "Ryunosuke Sato — 2+ fouls drawn", market: pt ? "Faltas sofridas" : "Fouls drawn", odd: 1.67,
        explanation: pt ? "λ 2,09: 63,4%." : "λ 2.09: 63.4%.", evidence: EV_FOULS_SEV, fair: devig(1.67) * 1.02,
        settlement: { type: "player_prop", player: "Ryunosuke Sato", stat: "foulsDrawn", line: 1.5, side: "over", sourceBasis: "escada da Betano" } }),
      leg({ selection: pt ? "Isaac Romero — 3+ finalizações" : "Isaac Romero — 3+ shots", market: pt ? "Chutes" : "Shots", odd: 1.60,
        explanation: pt ? "63%." : "63%.", evidence: EV_LADDER, fair: 0.63,
        settlement: { type: "player_prop", player: "Isaac Romero", stat: "shots", line: 2.5, side: "over", sourceBasis: "escada da Betano" } }),
    ],
    [pt ? "6 pernas — cada uma é mais um jeito de perder" : "6 legs — each one is another way to lose"]));

  suggestions.push(build("lot-1", "lottery",
    pt ? "Alternativa: loteria sem placar exato" : "Alternative: lottery without the correct score",
    pt
      ? "Se o placar exato te incomoda, essa versão troca ele por vitória simples do Sevilha e sobe mais um degrau nas pernas de jogador. A odd cai, mas a chance combinada quase dobra."
      : "If the correct score bothers you, this version swaps it for a straight Sevilla win and climbs one more rung on the player legs. The price drops, but the combined chance nearly doubles.",
    pt ? "Continua sendo bilhete de loteria. Só é uma loteria um pouco menos improvável." : "It's still a lottery ticket. Just a marginally less improbable one.",
    "low",
    [
      leg({ selection: pt ? "Sevilha FC vence" : "Sevilla FC to win", market: pt ? "Resultado final" : "Match result", odd: 2.00,
        explanation: pt ? "50,8% na grade." : "50.8% on the grid.", evidence: EV_TEAM, fair: P_SEV,
        settlement: { type: "moneyline", teamAbbreviation: "SEV", side: "home", sourceBasis: "grade Poisson" } }),
      leg({ selection: pt ? "Lucien Agoumé — 4+ faltas cometidas" : "Lucien Agoumé — 4+ fouls committed", market: pt ? "Faltas cometidas" : "Fouls committed", odd: 5.00,
        explanation: pt ? "24,2%." : "24.2%.", evidence: EV_FOULS_SEV, fair: devig(5.00) * 1.02,
        settlement: { type: "player_prop", player: "Lucien Agoumé", stat: "foulsCommitted", line: 3.5, side: "over", sourceBasis: "escada da Betano" } }),
      leg({ selection: pt ? "Hugo Duro — 4+ faltas sofridas" : "Hugo Duro — 4+ fouls drawn", market: pt ? "Faltas sofridas" : "Fouls drawn", odd: 3.95,
        explanation: pt ? "λ 2,71: P(4+) = 28,9%; equilíbrio a 3,95 é 25,3%." : "λ 2.71: P(4+) = 28.9% against a 25.3% breakeven.", evidence: EV_FOULS_SEV, fair: devig(3.95) * 1.02,
        settlement: { type: "player_prop", player: "Hugo Duro", stat: "foulsDrawn", line: 3.5, side: "over", sourceBasis: "escada da Betano" } }),
      leg({ selection: pt ? "Lucien Agoumé — 4+ desarmes" : "Lucien Agoumé — 4+ tackles", market: pt ? "Desarmes" : "Tackles", odd: 2.55,
        explanation: pt ? "44,2%." : "44.2%.", evidence: EV_LADDER, fair: devig(2.55) * 1.02,
        settlement: { type: "player_prop", player: "Lucien Agoumé", stat: "tackles", line: 3.5, side: "over", sourceBasis: "escada da Betano" } }),
      leg({ selection: pt ? "Gabriel Suazo — 3+ desarmes" : "Gabriel Suazo — 3+ tackles", market: pt ? "Desarmes" : "Tackles", odd: 1.67,
        explanation: pt ? "65,2%." : "65.2%.", evidence: EV_LADDER, fair: devig(1.67) * 1.02,
        settlement: { type: "player_prop", player: "Gabriel Suazo", stat: "tackles", line: 2.5, side: "over", sourceBasis: "escada da Betano" } }),
      leg({ selection: pt ? "Isaac Romero — 4+ finalizações" : "Isaac Romero — 4+ shots", market: pt ? "Chutes" : "Shots", odd: 2.42,
        explanation: pt ? "λ 3,45: ajuste dá 47%, corto para 42%." : "λ 3.45: the fit says 47%, cut to 42%.", evidence: EV_LADDER, fair: 0.42,
        settlement: { type: "player_prop", player: "Isaac Romero", stat: "shots", line: 3.5, side: "over", sourceBasis: "escada da Betano" } }),
    ],
    [pt ? "6 pernas — cada uma é mais um jeito de perder" : "6 legs — each one is another way to lose"], "lot-0"));

  const dataNote = pt
    ? [
        "Todos os preços vieram da Betano (evento 88312157), lidos no pool de Criar Aposta com as abas Todos e Jogadores abertas, cada accordion expandido e cada 'MOSTRAR TODOS' clicado: 27 mercados, 540 seleções.",
        "",
        "O QUE EU DECIDI NÃO APOSTAR, E POR QUÊ:",
        "• Cartões. O Sevilha tem média de 3,2 amarelos por jogo e o Valencia 1,5, mas são 4 jogos de amostra. Regredindo à liga, a resposta para 'mais de 4,5 cartões' varia de 36,7% a 59,1% dependendo da média da LaLiga, que eu não medi. Ontem esse mercado derrubou quatro dos seis bilhetes do Flamengo. Sem baseline medida, sem posição.",
        "• Escanteios. A média crua dos dois times soma 6,8 por jogo, o que daria 24,5% para mais de 8,5 contra 50% do mercado — um edge enorme e falso. Regredido à liga vira 8,60 esperados e 49,1%, praticamente igual ao mercado. Não havia nada ali.",
        "• Faltas sofridas pelos jogadores do Sevilha. Os quatro cotados somam 9,37 faltas esperadas, mas o Valencia comete 9,8 por jogo — a casa empilhou 82% das faltas do time inteiro em quatro nomes. Escada rica, fora.",
        "",
        "O QUE SOBROU: o desequilíbrio de faltas (Sevilha 16,8 x Valencia 9,8, ou 14,2 x 11,4 depois de regredir) e uma vantagem mínima no Sevilha para vencer. As linhas principais da Betano estão bem precificadas neste jogo — a maioria destes bilhetes tem EV levemente negativo, e isso está declarado em cada um.",
        "",
        "Escalações não estavam confirmadas na leitura (jogo às 16:00). Toda perna de jogador depende de titularidade.",
      ].join("\n")
    : [
        "Every price here came from Betano (event 88312157), read out of the bet-builder pool with the Todos and Jogadores tabs open, each accordion expanded and each 'MOSTRAR TODOS' clicked: 27 markets, 540 selections.",
        "",
        "WHAT I DELIBERATELY DIDN'T BET, AND WHY:",
        "• Cards. Sevilla average 3.2 yellows a game and Valencia 1.5, but that's a four-game sample. Regressed to the league, 'over 4.5 cards' swings between 36.7% and 59.1% depending on a LaLiga baseline I never measured. This exact market took down four of six Flamengo tickets yesterday. No measured baseline, no position.",
        "• Corners. The raw team averages sum to 6.8 a game, which would put over 8.5 at 24.5% against the market's 50% — a huge, fake edge. Regressed to the league it becomes 8.60 expected and 49.1%, level with the market. There was nothing there.",
        "• Fouls drawn by Sevilla players. The four quoted names add up to 9.37 expected fouls, but Valencia only commit 9.8 a game — the book has stacked 82% of a whole team's fouls into four players. Rich ladder, passed.",
        "",
        "WHAT SURVIVED: the foul imbalance (Sevilla 16.8 to Valencia 9.8, or 14.2 to 11.4 once regressed) and a sliver on Sevilla to win. Betano's main lines are priced tightly on this fixture — most of these tickets carry slightly negative EV, and each one says so.",
        "",
        "Line-ups were not confirmed at read time (16:00 kick-off). Every player leg depends on a start.",
      ].join("\n");

  return { suggestions, dataNote };
}

for (const lang of ["pt", "en"] as const) {
  const s = slate(lang);
  savePrediction({
    scope: "game", sportKey: SPORT, gameId: GAME_ID, dateKey: DATE_KEY, lang,
    matchup: MATCHUP, startsAt: STARTS_AT, slate: s, costUsd: 0,
  });
  console.log(`[${lang}] ${s.suggestions.length} bilhetes salvos`);
  for (const g of s.suggestions) {
    console.log(`   ${g.bandKey.padEnd(9)} ${g.combinedDecimal.toFixed(2).padStart(7)}x  mod=${(g.modelledProbability * 100).toFixed(1).padStart(5)}%  EV=${g.edgePct.toFixed(1).padStart(6)}%  ${g.title}`);
  }
}
