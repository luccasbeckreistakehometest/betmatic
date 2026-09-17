import { generateStructured, type StructuredImage } from "@/lib/ai/extract";
import { CHEAP_MODEL } from "@/lib/ai/client";
import { resolveScanLeg, ScanSchema, settlementFor, type ScanLeg, type SlipScan } from "@/lib/bets/slip-scan";
import { slateContexts } from "@/lib/server/deep-slip";
import type { ResolvedLeg } from "@/lib/bets/deep-slip";
import type { Settlement } from "@/lib/types";
import type { Lang } from "@/lib/i18n";

export const SCAN_MAX_BYTES = 1_500_000;

export function scanLimits(env: Record<string, string | undefined> = process.env) {
  const n = (v: string | undefined, d: number) => (v !== undefined && v.trim() !== "" && Number.isFinite(Number(v)) ? Math.max(0, Math.floor(Number(v))) : d);
  return { free: n(env.SCAN_FREE_PER_DAY, 3), paid: n(env.SCAN_PAID_PER_DAY, 20), global: n(env.SCAN_DAILY_CAP, 300) };
}

const SYSTEM: Record<Lang, string> = {
  pt: `Você lê prints de bilhetes de casas de apostas brasileiras (Betano, Superbet, KTO, bet365, Sportingbet, Estrela Bet e outras). Copie exatamente o que está impresso; não invente nada que não esteja legível.
Vocabulário: "Simples" = uma seleção; "Múltipla"/"Acumulada" = várias seleções multiplicadas; "Criar Aposta"/"Aposta Criada" = seleções do mesmo jogo com odd única (bet_builder, as pernas costumam vir sem odd própria); "Valor da aposta"/"Valor apostado" = stake; "Odds totais"/"Cotação" = totalOdds; "Retorno potencial"/"Ganhos possíveis" = potentialReturn (com o valor apostado); "Cash out" não é stake.
Odds sempre em decimal (2,10 vira 2.10). Valores em reais sem "R$". Quando um campo não for legível, use null e cite o campo em unreadable.`,
  en: `You read screenshots of sportsbook betting slips. Copy exactly what is printed; never invent anything that is not legible.
"Single" = one selection; "Multiple"/"Parlay"/"Accumulator" = several selections multiplied; "Bet Builder"/"Same Game Parlay" = legs from one game priced together (bet_builder; legs often have no price of their own); "Stake" = stake; "Total odds" = totalOdds; "Potential return"/"To return" = potentialReturn (including the stake); "Cash out" is not the stake.
Odds in decimal. Amounts as plain numbers. When a field is illegible, use null and list it in unreadable.`,
};

/** Test fixture: a made-up slip (fictional teams from the e2e world), one odd deliberately misread. */
function mockScan(): SlipScan {
  return {
    book: "Casa Exemplo", betType: "multiple", stake: 10, totalOdds: 4.1, potentialReturn: 41, currency: "BRL",
    legs: [
      { event: "Tupi FC x Ipê EC", selection: "Tupi FC vence", market: "Resultado Final", odds: 2.1, startsAt: null },
      { event: "Tupi FC x Ipê EC", selection: "Mais de 2,5 gols", market: "Total de gols", odds: 1.59, startsAt: null },
    ],
    unreadable: [],
  };
}

/** The image goes to the model and nowhere else: it is never written to disk or to the database. */
export async function extractSlip(image: StructuredImage, lang: Lang): Promise<SlipScan> {
  return generateStructured({
    schema: ScanSchema,
    system: SYSTEM[lang],
    prompt: lang === "pt" ? "Leia este bilhete e preencha os campos." : "Read this slip and fill in the fields.",
    images: [image],
    model: CHEAP_MODEL,
    maxTokens: 1500,
    label: "slip_scan",
    mock: mockScan,
  });
}

export interface ScanLegView extends ScanLeg {
  resolved: ResolvedLeg;
  settlement: Settlement | null;
  gameId: string | null;
  startsAt: string | null;
  athleteId: string | null;
}

/** Places every printed leg on yesterday's, today's or tomorrow's slate of the sport (date ± 1 day). */
export async function resolveScan(sportKey: string, legs: ScanLeg[]): Promise<ScanLegView[]> {
  const { contexts } = await slateContexts(sportKey, [-1, 0, 1], { upcomingOnly: false, max: 40 });
  return legs.map((leg, i) => {
    const resolved = resolveScanLeg(leg, i, contexts);
    const game = contexts.find((g) => g.id === resolved.gameId);
    const settlement = game ? settlementFor(resolved, game.home.abbreviation) : null;
    return { ...leg, resolved, settlement, gameId: settlement ? game!.id : null, startsAt: game?.startsAt ?? null, athleteId: resolved.athleteId };
  });
}
