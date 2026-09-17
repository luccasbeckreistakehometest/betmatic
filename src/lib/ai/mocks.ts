import type { RawLeg, RawSuggestion } from "@/lib/bets/builder";
import { formatAmerican, impliedProbability } from "@/lib/odds";
import type { Lang } from "@/lib/i18n";
import type { Game, GameDetail, PropRow } from "@/lib/types";

/**
 * Deterministic stand-ins for model output under AI_MOCK. They are built from the same inputs the
 * real prompt carries, so the code around the model (anchoring, pricing, linking, caps, UI) is
 * exercised end to end without spending tokens. Never used outside tests.
 */
interface RawSlate { suggestions: RawSuggestion[]; dataNote: string }

const clamp = (p: number) => Math.min(0.95, Math.max(0.03, p));

export function mockPropLeg(p: PropRow, lang: Lang, gameId: string | null = null): RawLeg {
  const side = p.side === "under" ? (lang === "pt" ? "menos de" : "under") : lang === "pt" ? "mais de" : "over";
  const measured = p.measured;
  const fair = measured ? clamp(measured.impliedFair * 0.9 + (p.decimal ? 0.1 / p.decimal : 0)) : 0.4;
  return {
    selection: `${p.player} ${side} ${p.line} ${p.market}`,
    market: "player prop",
    odds: p.odds ?? "",
    book: p.book ?? null,
    explanation: lang === "pt" ? `Linha publicada e medida no histórico de ${p.player}.` : `Posted line, measured against ${p.player}'s game log.`,
    evidence: measured ? `measured history: ${measured.season.hits}/${measured.season.of} (${Math.round(measured.impliedFair * 100)}%)` : "no measured support",
    fairProbability: fair,
    settlementType: "player_prop",
    settlementTeam: null,
    settlementPlayer: p.player,
    settlementStat: p.marketKey ?? p.market,
    settlementLine: p.line ?? null,
    settlementSide: p.side === "under" ? "under" : "over",
    sourceBasis: "measured history",
    gameId,
  };
}

function moneylineLeg(game: Game, detail: GameDetail, lang: Lang): RawLeg | null {
  const american = detail.books[0]?.homeMoneyline;
  if (american === undefined || !Number.isFinite(american)) return null;
  const decimal = american > 0 ? 1 + american / 100 : 1 + 100 / Math.abs(american);
  return {
    selection: lang === "pt" ? `${game.home.displayName} vence` : `${game.home.displayName} moneyline`,
    market: "moneyline",
    odds: formatAmerican(decimal),
    book: detail.books[0]?.provider ?? null,
    explanation: lang === "pt" ? "Mandante favorito pelo mercado." : "Home side the market favours.",
    evidence: "book line",
    fairProbability: clamp(impliedProbability(decimal) * 0.97),
    settlementType: "moneyline",
    settlementTeam: game.home.abbreviation,
    settlementPlayer: null,
    settlementStat: null,
    settlementLine: null,
    settlementSide: "home",
    sourceBasis: "book line",
    gameId: null,
  };
}

function ticket(legs: RawLeg[], title: string, lang: Lang, extra: Partial<RawSuggestion> = {}): RawSuggestion {
  return {
    kind: legs.length > 1 ? "parlay" : "single",
    alternativeOf: null,
    swapReason: null,
    title,
    background: lang === "pt" ? "Bilhete de teste montado a partir das linhas publicadas." : "Test ticket built from the posted lines.",
    legs,
    riskNote: lang === "pt" ? "Uma perna de jogador depende de minutos." : "A player leg depends on minutes.",
    confidence: "medium",
    ...extra,
  };
}

export function mockGameSlate(args: { game: Game; detail: GameDetail; props: PropRow[]; lang: Lang; bands: string[]; live?: boolean }): RawSlate {
  const { game, detail, lang } = args;
  const priced = args.props.filter((p) => p.priced && p.odds);
  const suggestions: RawSuggestion[] = [];
  const ml = moneylineLeg(game, detail, lang);
  if (args.live) {
    if (priced[0]) suggestions.push(ticket([mockPropLeg(priced[0], lang)], lang === "pt" ? "Leitura ao vivo" : "Live read", lang));
    else if (ml) suggestions.push(ticket([ml], lang === "pt" ? "Leitura ao vivo" : "Live read", lang));
    return { suggestions, dataNote: "AI_MOCK" };
  }
  const [a, ...rest] = priced;
  if (a) {
    const b = rest.find((p) => p.player !== a.player);
    const c = rest.find((p) => p.player !== a.player && p !== b);
    const d = rest.find((p) => p.player !== a.player && p !== b && p !== c);
    suggestions.push(ticket([mockPropLeg(a, lang)], lang === "pt" ? "A linha mais medida" : "The best-measured line", lang));
    if (b) {
      const main = suggestions.push(ticket([mockPropLeg(a, lang), mockPropLeg(b, lang)], lang === "pt" ? "Dupla de jogadores" : "Player double", lang)) - 1;
      if (c) suggestions.push(ticket([mockPropLeg(a, lang), mockPropLeg(c, lang)], lang === "pt" ? "Dupla alternativa" : "Backup double", lang, { alternativeOf: main, swapReason: lang === "pt" ? `se ${b.player} for vetado` : `if ${b.player} is ruled out` }));
      if (d) suggestions.push(ticket([mockPropLeg(a, lang), mockPropLeg(d, lang)], lang === "pt" ? "Outra saída" : "Another way in", lang, { alternativeOf: main, swapReason: lang === "pt" ? "se a linha subir" : "if the line moves up" }));
    }
  }
  if (ml) suggestions.push(ticket([ml], lang === "pt" ? "Vitória do mandante" : "Home win", lang));
  return { suggestions, dataNote: lang === "pt" ? "Dados de teste (AI_MOCK)." : "Test data (AI_MOCK)." };
}

/** One long cross-game ticket (one leg per game) and, when possible, a moonshot. */
export function mockSlateBets(args: { games: { game: Game; detail: GameDetail; props?: PropRow[] }[]; lang: Lang }): RawSlate {
  const { lang } = args;
  const perGame = args.games
    .map(({ game, props }) => {
      const pick = (props ?? []).filter((p) => p.priced && p.decimal && p.decimal >= 2.2).sort((x, y) => (y.decimal ?? 0) - (x.decimal ?? 0))[0];
      return pick ? mockPropLeg(pick, lang, game.id) : null;
    })
    .filter((l): l is RawLeg => l !== null);
  const suggestions: RawSuggestion[] = [];
  if (perGame.length >= 2) suggestions.push(ticket(perGame, lang === "pt" ? "Múltipla da rodada" : "Round parlay", lang, { confidence: "low" }));
  if (perGame.length >= 3) suggestions.push(ticket(perGame.slice(0, perGame.length - 1), lang === "pt" ? "Múltipla menor" : "Shorter parlay", lang, { confidence: "low" }));
  return { suggestions, dataNote: "AI_MOCK" };
}
