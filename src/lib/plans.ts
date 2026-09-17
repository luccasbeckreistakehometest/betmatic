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
 * Tiers gate breadth (sports, games, bands, cross-game parlays), not compute: a game's tickets are
 * built once, when the first entitled user opens it, and everyone after reads the same inventory.
 * Every paid plan is PREPAID for the chosen period and does not renew by itself.
 * Highlights only name what the code does — tests read them.
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
    tagline: { pt: "Prove antes de pagar", en: "Try before you pay" },
    highlights: {
      pt: ["1 jogo por dia, você escolhe qual", "Faixa de valor (2x–5x)", "O bilhete que você gerou sai na hora; os já prontos, com 2 h de atraso", "Histórico público"],
      en: ["1 game a day, your pick", "Value band (2x–5x)", "A ticket you generate shows at once; ready-made ones on a 2-hour delay", "Public track record"],
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
        "NBA e WNBA: todos os jogos",
        "Bilhetes montados quando você abre a partida",
        "Faixas até 20x",
        "30 coins por período para análises do seu bilhete",
      ],
      en: [
        "NBA and WNBA: every game",
        "Tickets built when you open the game",
        "Bands up to 20x",
        "30 coins per period to analyse your own slips",
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
    tagline: { pt: "Basquete e futebol, com as múltiplas longas", en: "Basketball and soccer, with the long parlays" },
    highlights: {
      pt: [
        "Basquete e futebol: NBA, WNBA, Brasileirão, Premier League, La Liga, Champions e Libertadores",
        "Todas as faixas de odd",
        "Múltiplas entre jogos da rodada",
        "120 coins por período",
      ],
      en: [
        "Basketball and soccer: NBA, WNBA, Brasileirão, Premier League, La Liga, Champions League, Libertadores",
        "Every odds band",
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
    tagline: { pt: "Tudo do Pro, com mais coins", en: "Everything in Pro, with more coins" },
    highlights: {
      pt: ["Tudo do Pro", "400 coins por período (50 análises do seu bilhete)"],
      en: ["Everything in Pro", "400 coins per period (50 analyses of your own slip)"],
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
 * Coins only price work computed for one specific user. Reading inventory is covered by the plan,
 * so charging for it would be charging twice. Today coins buy one thing: the analysis of a slip the
 * user assembled.
 */
export const ACTION_COST = {
  analyse_slip: 8,
  /** Deep analysis for plans below Max (Max pays the normal analyse_slip price). */
  deep_slip: 14,
  custom_parlay: 12,
  /** The same custom parlay with a templated explanation, when the AI write-up is unavailable. */
  custom_parlay_basic: 6,
  player_read: 5,
  /** A tipster audit beyond the plan's allowance. */
  tipster_audit: 6,
} as const;

export type CoinAction = keyof typeof ACTION_COST;

export const ACTION_LABEL: Record<CoinAction, { pt: string; en: string }> = {
  analyse_slip: { pt: "Analisar meu bilhete", en: "Analyse my slip" },
  deep_slip: { pt: "Análise profunda do bilhete", en: "Deep slip analysis" },
  custom_parlay: { pt: "Múltipla sob medida", en: "Custom parlay" },
  custom_parlay_basic: { pt: "Múltipla sob medida (sem texto da IA)", en: "Custom parlay (no AI write-up)" },
  player_read: { pt: "Leitura do analista no raio-x", en: "Analyst read on the player deep dive" },
  tipster_audit: { pt: "Raio-x de tipster extra", en: "Extra tipster audit" },
};

/** Prepaid wording shown next to every paid price. */
export const PREPAID_NOTE = {
  pt: "Pagamento único, pré-pago pelo período escolhido. Não renova sozinho.",
  en: "One-time prepaid payment for the chosen period. It does not renew by itself.",
} as const;

/** How a payment row reads to its buyer: "Plano PRO · Trimestral" or "Pacote de 230 coins" (bonus included). */
export function paymentLabel(p: { kind: string; reference: string; period: string | null }, lang: "pt" | "en"): string {
  if (p.kind === "plan") {
    const period = PERIOD[(p.period ?? "monthly") as BillingPeriod]?.label[lang] ?? p.period ?? "";
    return `${lang === "pt" ? "Plano" : "Plan"} ${p.reference.toUpperCase()}${period ? ` · ${period}` : ""}`;
  }
  const pack = COIN_PACKS.find((x) => x.id === p.reference);
  const coins = pack ? pack.coins + pack.bonus : Number(p.reference.replace("pack_", "")) || 0;
  return lang === "pt" ? `Pacote de ${coins} coins` : `${coins}-coin pack`;
}

