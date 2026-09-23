import fs from "node:fs";
import { it, expect } from "vitest";
import { priceAll, type RawSuggestion } from "@/lib/bets/builder";
import { recordPredictions, ledgerIdFor } from "@/lib/ledger/store";
import { recordLegPrices } from "@/lib/server/leg-prices";
import { savePrediction } from "@/lib/server/predictions";
import { espnDateKey } from "@/lib/sources/espn";
import type { BetSlate, GameDetail, PropRow } from "@/lib/types";

/** Temporary: adds the two long same-game tickets to the Dallas @ Phoenix slate. Delete after. */
const S = "/private/tmp/claude-501/-Users-luccasbeckreis-Documents-Dosen-v2-FE/d610ee6c-2c5c-4bcb-9851-fd34fcbc65d5/scratchpad/seed";

type Leg = RawSuggestion["legs"][number];
const leg = (o: Partial<Leg> & { selection: string; odds: string; explanation: string; evidence: string; fairProbability: number; settlementPlayer: string; settlementStat: string; settlementLine: number; settlementSide: "over" | "under" }): Leg => ({
  market: "player prop", book: "DraftKings", settlementType: "player_prop", settlementTeam: null, sourceBasis: "measured history", gameId: null, ...o,
});

const BUECKERS = leg({
  selection: "Paige Bueckers mais de 24,5 pontos+rebotes+assistências", odds: "1.38",
  explanation: "Bueckers é o centro de tudo que Dallas faz: 20,6 pontos e 5,9 assistências por jogo, contra a defesa que mais cede entre as duas.",
  evidence: "Medido: 35/43 na temporada (81%), 9/10 nos últimos 10, média 29,95 e mediana 30.",
  fairProbability: 0.78, settlementPlayer: "Paige Bueckers", settlementStat: "PRA", settlementLine: 24.5, settlementSide: "over",
});
const SHEPARD = leg({
  selection: "Jessica Shepard mais de 19,5 pontos+rebotes", odds: "1.39",
  explanation: "Phoenix perde os dois garrafões titulares; Shepard tem média 24,55 na soma, cinco acima da linha.",
  evidence: "Medido: 33/42 na temporada (79%), 4/5 nos últimos cinco, média 24,55 e mediana 24,5.",
  fairProbability: 0.74, settlementPlayer: "Jessica Shepard", settlementStat: "points+rebounds", settlementLine: 19.5, settlementSide: "over",
});
const BROCHANT = leg({
  selection: "Noemie Brochant menos de 2,5 assistências", odds: "1.52",
  explanation: "Brochant joga de ala sem a bola: média de 1,85 assistência e mediana 1.",
  evidence: "Medido: 34/41 na temporada (83%), 8/10 nos últimos 10, média 1,85.",
  fairProbability: 0.78, settlementPlayer: "Noemie Brochant", settlementStat: "assists", settlementLine: 2.5, settlementSide: "under",
});
const ARIKE = leg({
  selection: "Arike Ogunbowale mais de 19,5 pontos+assistências", odds: "1.83",
  explanation: "Com Phoenix desfalcado no perímetro, Ogunbowale assume o volume: mediana 20,5 na soma.",
  evidence: "Medido: 24/42 na temporada (57%), 7/10 nos últimos 10, média 18,55 e mediana 20,5.",
  fairProbability: 0.55, settlementPlayer: "Arike Ogunbowale", settlementStat: "points+assists", settlementLine: 19.5, settlementSide: "over",
});
const KUIER = leg({
  selection: "Awak Kuier menos de 15,5 pontos+rebotes", odds: "1.74",
  explanation: "Kuier sai do banco e tem média de 9,95 na soma, quase seis abaixo da linha.",
  evidence: "Medido: 29/39 na temporada (74%), média 9,95 e mediana 10. Minutos subiram de 18 para 25,8 nos últimos cinco.",
  fairProbability: 0.65, settlementPlayer: "Awak Kuier", settlementStat: "points+rebounds", settlementLine: 15.5, settlementSide: "under",
});
const THOMAS = leg({
  selection: "Alyssa Thomas menos de 8,5 rebotes", odds: "1.74",
  explanation: "Thomas fica abaixo de 8,5 rebotes na maioria dos jogos: média 7,6.",
  evidence: "Medido: 28/42 na temporada (67%), 3/5 nos últimos cinco, média 7,6 e mediana 7.",
  fairProbability: 0.6, settlementPlayer: "Alyssa Thomas", settlementStat: "rebounds", settlementLine: 8.5, settlementSide: "under",
});
const BUECKERS_PTS = leg({
  selection: "Paige Bueckers mais de 19,5 pontos", odds: "1.84",
  explanation: "A mesma noite grande da primeira linha, pelo lado do placar: média 20,14 pontos e mediana 21.",
  evidence: "Medido: 25/43 na temporada (58%), 7/10 nos últimos 10, média 20,14 e mediana 21.",
  fairProbability: 0.57, settlementPlayer: "Paige Bueckers", settlementStat: "points", settlementLine: 19.5, settlementSide: "over",
});

const RAWS: RawSuggestion[] = [
  {
    kind: "parlay", alternativeOf: null, swapReason: null,
    title: "O jogo inteiro de Dallas, seis linhas",
    background: "Uma tese só, esticada: Phoenix sem Copper e sem Plum, cedendo 87,3 pontos por jogo, contra o ataque que mais pontua. As três linhas de Dallas sobem juntas se o jogo for de ritmo alto; as três de Phoenix caem juntas se o banco jogar pouco. É um bilhete de uma história só, não seis apostas soltas.",
    legs: [BUECKERS, SHEPARD, BROCHANT, ARIKE, KUIER, THOMAS],
    riskNote: "Seis linhas são seis formas de perder, e a margem da casa se acumula em cada uma. Um jogo truncado, de poucas posses, derruba as linhas de Dallas e salva as de Phoenix ao mesmo tempo.",
    confidence: "low",
  },
  {
    kind: "parlay", alternativeOf: null, swapReason: null,
    title: "A noite grande da Bueckers, sete linhas",
    background: "A mesma leitura com a sétima linha deliberadamente correlacionada: se a soma da Bueckers passa de 24,5, o caminho mais provável é que ela também passe de 19,5 pontos. Correlação a favor é o que transforma um preço longo numa aposta única, e não em sete apostas independentes.",
    legs: [BUECKERS, BUECKERS_PTS, SHEPARD, BROCHANT, ARIKE, KUIER, THOMAS],
    riskNote: "Duas linhas dependem da mesma jogadora: se Bueckers tiver uma noite fria ou sentar cedo com o jogo resolvido, as duas caem juntas. Sete linhas do mesmo jogo é o formato mais caro em margem que existe.",
    confidence: "low",
  },
];

it("adds the long tickets", { timeout: 120_000 }, () => {
  const dump = JSON.parse(fs.readFileSync(`${S}/401857207.json`, "utf8")) as { detail: GameDetail; props: PropRow[]; lines: unknown[] };
  const game = dump.detail.game;
  const longs = priceAll(RAWS, { props: dump.props, sportKey: "wnba", game, lines: dump.lines as never });
  for (const s of longs) {
    console.log(`  [${s.bandKey}] ${s.title} — ${s.combinedDecimal.toFixed(2)}x | chance ${(s.modelledProbability * 100).toFixed(1)}% | implícita ${(s.impliedProbability * 100).toFixed(1)}% | evidência ${s.evidenceScore} | linhas ${s.legs.length}`);
  }
  expect(longs.length).toBe(2);

  const previous = JSON.parse(fs.readFileSync(`${S}/payload.json`, "utf8")) as BetSlate;
  const slate: BetSlate = { suggestions: [...previous.suggestions, ...longs], dataNote: previous.dataNote };
  const dateKey = espnDateKey(new Date(game.startsAt));

  recordPredictions(game, longs, { startsAt: game.startsAt });
  recordLegPrices(longs.flatMap((s) => s.legs.map((l, legIndex) => ({
    ledgerId: ledgerIdFor(game.id, s), legIndex, gameId: game.id, sportKey: "wnba", startsAt: game.startsAt, homeAbbr: game.home.abbreviation, leg: l,
  }))));
  savePrediction({ scope: "game", sportKey: "wnba", gameId: game.id, dateKey, lang: "pt", matchup: `${game.away.displayName} @ ${game.home.displayName}`, startsAt: game.startsAt, slate, costUsd: 0 });
  fs.writeFileSync(`${S}/payload.json`, JSON.stringify(slate));
  console.log("tickets no slate agora:", slate.suggestions.length);
});
