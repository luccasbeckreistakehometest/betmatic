import { z } from "zod";
import { normaliseName } from "@/lib/resolve/names";

/**
 * Raio-x do tipster, the pure half: what the cheap model extracts from pasted messages, the red-flag
 * keyword list, and the report computed from graded picks. Nothing here knows who the tipster is.
 */
export const TipsterSchema = z.object({
  picks: z.array(z.object({
    postedAt: z.string().nullable().describe("When the message was posted (ISO 8601 if a date/time is visible), or null."),
    event: z.string().describe("The match, e.g. 'Flamengo x Palmeiras'."),
    selection: z.string().describe("The pick as written."),
    market: z.string().describe("The market as written, or ''."),
    odds: z.number().nullable().describe("Decimal odds stated in the message, or null."),
    units: z.number().nullable().describe("Stake in units if stated, or null."),
    claimedResult: z.enum(["green", "red", "void"]).nullable().describe("What the tipster later claimed about this pick (green/red/void), or null."),
  })).max(60),
});
export type ExtractedPick = z.infer<typeof TipsterSchema>["picks"][number];

/** Patterns the CONAR annex and Reclame Aqui complaints keep pointing at. */
export const RED_FLAGS: { key: string; pattern: RegExp; label: { pt: string; en: string } }[] = [
  { key: "guaranteed", pattern: /(green|lucro|ganho|aposta)s? garantid|garantido|sem risco|100% (certo|garantido)|risk.?free|guaranteed/, label: { pt: "promete resultado garantido", en: "promises a guaranteed result" } },
  { key: "daily_profit", pattern: /lucro (todo|todos os) dia|lucro diario|renda (extra|diaria|fixa)|daily profit/, label: { pt: "fala em lucro diário ou renda", en: "talks about daily profit or income" } },
  { key: "urgency", pattern: /ultimas vagas|vagas limitadas|so hoje|corre que|last spots|only today/, label: { pt: "pressa: últimas vagas, só hoje", en: "urgency: last spots, today only" } },
  { key: "leverage", pattern: /alavanca|multiplicar (a )?banca|dobrar (a )?banca|all.?in/, label: { pt: "alavancagem / multiplicar a banca", en: "leverage / multiply your bankroll" } },
  { key: "chasing", pattern: /recuper(e|ar|a) (o )?(prejuizo|perda|red)|recupera(r|cao)|chase|win it back/, label: { pt: "convida a recuperar perdas", en: "invites you to win losses back" } },
  { key: "vip_upsell", pattern: /grupo vip|sala vip|vip pago|acesso vip|premium group/, label: { pt: "empurra grupo VIP pago", en: "pushes a paid VIP group" } },
];

export function redFlags(text: string): string[] {
  const t = normaliseName(text);
  return RED_FLAGS.filter((f) => f.pattern.test(t)).map((f) => f.key);
}

export type PickOutcome = "won" | "lost" | "push" | "void" | "pending" | "unverifiable";

export interface GradedPick {
  postedAt: string | null;
  startsAt: string | null;
  event: string;
  selection: string;
  matchup: string | null;
  odds: number | null;
  /** "stated" = in the message; "estimated" = the market price we read, flagged as such. */
  oddsSource: "stated" | "estimated" | null;
  claimed: "green" | "red" | "void" | null;
  outcome: PickOutcome;
}

export interface AuditReport {
  total: number;
  verifiable: number;
  verifiableShare: number;
  won: number;
  lost: number;
  hitRate: number | null;
  /** Units at 1u flat, only over decided picks with a price. */
  roi: number | null;
  roiPicks: number;
  estimatedOdds: number;
  claimedGreens: number;
  realGreensAmongClaimed: number;
  longestLosingRun: number;
  averageOdds: number | null;
  postedAfterKickoff: number;
  flags: string[];
}

export function longestLosingRun(picks: Pick<GradedPick, "outcome" | "postedAt" | "startsAt">[]): number {
  const ordered = [...picks].filter((p) => p.outcome === "won" || p.outcome === "lost")
    .sort((a, b) => (a.startsAt ?? a.postedAt ?? "").localeCompare(b.startsAt ?? b.postedAt ?? ""));
  let best = 0;
  let run = 0;
  for (const p of ordered) {
    run = p.outcome === "lost" ? run + 1 : 0;
    best = Math.max(best, run);
  }
  return best;
}

/** A green posted after the game started is the classic fake: the result was already known. */
export const postedLate = (p: Pick<GradedPick, "postedAt" | "startsAt">) =>
  !!p.postedAt && !!p.startsAt && Number.isFinite(Date.parse(p.postedAt)) && Date.parse(p.postedAt) > Date.parse(p.startsAt);

export function auditReport(picks: GradedPick[], flags: string[]): AuditReport {
  const verifiable = picks.filter((p) => p.outcome !== "unverifiable");
  const decided = picks.filter((p) => p.outcome === "won" || p.outcome === "lost");
  const won = decided.filter((p) => p.outcome === "won").length;
  const priced = decided.filter((p) => p.odds !== null && p.odds > 1);
  const units = priced.reduce((a, p) => a + (p.outcome === "won" ? p.odds! - 1 : -1), 0);
  const claimed = picks.filter((p) => p.claimed === "green");
  const withOdds = picks.filter((p) => p.odds !== null && p.odds > 1);
  return {
    total: picks.length,
    verifiable: verifiable.length,
    verifiableShare: picks.length ? verifiable.length / picks.length : 0,
    won,
    lost: decided.length - won,
    hitRate: decided.length ? won / decided.length : null,
    roi: priced.length ? units / priced.length : null,
    roiPicks: priced.length,
    estimatedOdds: priced.filter((p) => p.oddsSource === "estimated").length,
    claimedGreens: claimed.length,
    realGreensAmongClaimed: claimed.filter((p) => p.outcome === "won").length,
    longestLosingRun: longestLosingRun(picks),
    averageOdds: withOdds.length ? withOdds.reduce((a, p) => a + p.odds!, 0) / withOdds.length : null,
    postedAfterKickoff: picks.filter(postedLate).length,
    flags,
  };
}

/** The shareable line: aggregate numbers only, never the tipster's name. */
export function shareText(r: AuditReport, lang: "pt" | "en"): string {
  const pct = (x: number | null) => (x === null ? "—" : `${Math.round(x * 100)}%`);
  return lang === "pt"
    ? `Conferi ${r.total} palpites de um tipster no Betmatic: ${pct(r.verifiableShare)} verificáveis, acerto real ${pct(r.hitRate)}${r.postedAfterKickoff ? `, ${r.postedAfterKickoff} postados depois do jogo começar` : ""}.`
    : `I audited ${r.total} picks from a tipster on Betmatic: ${pct(r.verifiableShare)} verifiable, real hit rate ${pct(r.hitRate)}${r.postedAfterKickoff ? `, ${r.postedAfterKickoff} posted after kickoff` : ""}.`;
}
