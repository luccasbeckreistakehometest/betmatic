export type BillingPeriod = "monthly" | "quarterly" | "semiannual" | "annual";
export type Role = "user" | "admin";

export const PERIOD: Record<BillingPeriod, { months: number; discount: number; label: { pt: string; en: string } }> = {
  monthly: { months: 1, discount: 0, label: { pt: "Mensal", en: "Monthly" } },
  quarterly: { months: 3, discount: 0.1, label: { pt: "Trimestral", en: "Quarterly" } },
  semiannual: { months: 6, discount: 0.18, label: { pt: "Semestral", en: "Semiannual" } },
  annual: { months: 12, discount: 0.3, label: { pt: "Anual", en: "Annual" } },
};

export function periodPrice(monthly: number, period: BillingPeriod): number {
  const { months, discount } = PERIOD[period];
  return Math.round(monthly * months * (1 - discount));
}

export interface Plan {
  id: string;
  name: string;
  monthlyPrice: number;
  /** Sports the plan unlocks. Empty means every sport. */
  sports: string[];
  /** null = every game on the slate. */
  gamesPerDay: number | null;
  /** Odds bands the plan can see. */
  bands: string[];
  crossGame: boolean;
  trackRecord: boolean;
  /** Minutes the free tier lags behind a fresh generation. */
  delayMinutes: number;
  /** Coins granted on each billing period. */
  coinsPerPeriod: number;
  highlights: { pt: string[]; en: string[] };
  tagline: { pt: string; en: string };
}

const ALL_BANDS = ["safe", "value", "mid", "long", "moonshot", "lottery"];

/**
 * Generation is a fixed cost paid by the background job, so a paid plan's marginal cost is
 * effectively zero — the tiers gate breadth (sports, games, bands), not compute.
 * Every paid tier is guaranteed at least one ticket per game on the slates it covers.
 */
export const PLANS: Plan[] = [
  {
    id: "free",
    name: "Free",
    monthlyPrice: 0,
    sports: [],
    gamesPerDay: 1,
    bands: ["value"],
    crossGame: false,
    trackRecord: false,
    delayMinutes: 120,
    coinsPerPeriod: 0,
    tagline: { pt: "Prove antes de assinar", en: "Try before you subscribe" },
    highlights: {
      pt: ["1 jogo por dia", "Faixa de valor (2x–5x)", "Com 2h de atraso", "Histórico público"],
      en: ["1 game per day", "Value band (2x–5x)", "2-hour delay", "Public track record"],
    },
  },
  {
    id: "starter",
    name: "Starter",
    monthlyPrice: 39,
    sports: ["nba", "wnba"],
    gamesPerDay: null,
    bands: ["safe", "value", "mid"],
    crossGame: false,
    trackRecord: true,
    delayMinutes: 0,
    coinsPerPeriod: 30,
    tagline: { pt: "Basquete inteiro, sem atraso", en: "All basketball, no delay" },
    highlights: {
      pt: [
        "NBA e WNBA completas",
        "Pelo menos 1 bilhete por partida",
        "Faixas até 20x",
        "Histórico de acertos medido",
        "30 coins por período",
      ],
      en: [
        "Full NBA and WNBA",
        "At least 1 ticket per game",
        "Bands up to 20x",
        "Measured track record",
        "30 coins per period",
      ],
    },
  },
  {
    id: "pro",
    name: "Pro",
    monthlyPrice: 89,
    sports: [],
    gamesPerDay: null,
    bands: ALL_BANDS,
    crossGame: true,
    trackRecord: true,
    delayMinutes: 0,
    coinsPerPeriod: 120,
    tagline: { pt: "Todos os esportes e as múltiplas longas", en: "Every sport and the long parlays" },
    highlights: {
      pt: [
        "Basquete, futebol e tênis",
        "Pelo menos 1 bilhete por partida",
        "Todas as faixas, até 500x+",
        "Múltiplas entre jogos da rodada",
        "120 coins por período",
      ],
      en: [
        "Basketball, soccer and tennis",
        "At least 1 ticket per game",
        "Every band, up to 500x+",
        "Cross-game parlays",
        "120 coins per period",
      ],
    },
  },
  {
    id: "max",
    name: "Max",
    monthlyPrice: 199,
    sports: [],
    gamesPerDay: null,
    bands: ALL_BANDS,
    crossGame: true,
    trackRecord: true,
    delayMinutes: 0,
    coinsPerPeriod: 400,
    tagline: { pt: "Para quem aposta todo dia", en: "For daily bettors" },
    highlights: {
      pt: [
        "Tudo do Pro",
        "400 coins por período",
        "Análise do seu bilhete em profundidade",
        "Prioridade nas atualizações",
      ],
      en: ["Everything in Pro", "400 coins per period", "Deep analysis of your own slip", "Priority refreshes"],
    },
  },
];

export function getPlan(id: string | undefined): Plan {
  return PLANS.find((p) => p.id === id) ?? PLANS[0];
}

export interface CoinPack {
  id: string;
  coins: number;
  bonus: number;
  price: number;
}

export const COIN_PACKS: CoinPack[] = [
  { id: "pack_50", coins: 50, bonus: 0, price: 19 },
  { id: "pack_200", coins: 200, bonus: 30, price: 59 },
  { id: "pack_600", coins: 600, bonus: 150, price: 149 },
];

export function getCoinPack(id: string): CoinPack | undefined {
  return COIN_PACKS.find((p) => p.id === id);
}

/**
 * Coins only price work computed for one specific user. Reading pre-generated inventory is free
 * to serve, so charging for it would be charging twice for the subscription.
 */
export const ACTION_COST = {
  analyse_slip: 8,
  custom_parlay: 12,
  player_deep_dive: 5,
} as const;

export type CoinAction = keyof typeof ACTION_COST;

export const ACTION_LABEL: Record<CoinAction, { pt: string; en: string }> = {
  analyse_slip: { pt: "Analisar meu bilhete", en: "Analyse my slip" },
  custom_parlay: { pt: "Múltipla sob medida", en: "Custom parlay" },
  player_deep_dive: { pt: "Raio-x de jogador", en: "Player deep dive" },
};
