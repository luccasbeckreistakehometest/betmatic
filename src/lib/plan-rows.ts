import type { Plan } from "@/lib/plans";

/**
 * The rows of the plan comparison: only what actually differs between tiers, read out of the plan
 * model's own fields, so the table can never drift from what the code enforces. Shared by the
 * landing (where the reader compares) and /planos (where the reader buys), because a buyer should
 * not be shown a different set of facts from the one that convinced them.
 */
export function planRows(lang: "pt" | "en"): { label: string; value: (plan: Plan) => string }[] {
  const yes = lang === "pt" ? "sim" : "yes";
  const no = "—";
  return [
    { label: lang === "pt" ? "Jogos por dia" : "Games a day", value: (p) => (p.gamesPerDay === null ? (lang === "pt" ? "todos" : "all") : String(p.gamesPerDay)) },
    { label: lang === "pt" ? "Faixas de odds" : "Odds bands", value: (p) => String(p.bands.length) },
    { label: lang === "pt" ? "Esportes" : "Sports", value: (p) => (p.sports.length === 0 ? (lang === "pt" ? "todos" : "all") : String(p.sports.length)) },
    { label: lang === "pt" ? "Múltiplas entre jogos" : "Cross-game parlays", value: (p) => (p.crossGame ? yes : no) },
    { label: lang === "pt" ? "Atraso dos destaques" : "Featured delay", value: (p) => (p.delayMinutes ? `${p.delayMinutes} min` : lang === "pt" ? "nenhum" : "none") },
    { label: lang === "pt" ? "Coins no período" : "Coins per period", value: (p) => (p.coinsPerPeriod ? String(p.coinsPerPeriod) : no) },
    { label: lang === "pt" ? "Histórico completo" : "Full track record", value: (p) => (p.trackRecord ? yes : no) },
  ];
}
