import { generateStructured, type StructuredImage } from "@/lib/ai/extract";
import { CHEAP_MODEL } from "@/lib/ai/client";
import { getDb, newId, nowIso } from "@/lib/server/db";
import { usesSince } from "@/lib/server/feature-uses";
import { gameForEvent, resolveScanLeg, settlementFor } from "@/lib/bets/slip-scan";
import { gradeLegAgainst } from "@/lib/ledger/settle";
import { espnDateKey, getGameDetail, getSlate, shiftKey, todayKey } from "@/lib/sources/espn";
import { americanToDecimal } from "@/lib/odds";
import { auditReport, TipsterSchema, type AuditReport, type ExtractedPick, type GradedPick } from "@/lib/tipster/audit";
import type { GameContext } from "@/lib/bets/deep-slip";
import type { Game, GameDetail } from "@/lib/types";
import type { PublicUser } from "@/lib/server/users";
import type { Lang } from "@/lib/i18n";

export const TIPSTER_MAX_CHARS = 30_000;
const DAY = 86_400_000;

/** Paid plans: 3 audits a week. Free: 1 a month. Past the allowance an audit costs coins. */
export function tipsterAllowance(user: Pick<PublicUser, "id" | "role" | "plan">, now = new Date()): { limit: number; since: Date; used: number; window: "week" | "month" } {
  const paid = user.role === "admin" || user.plan.id !== "free";
  const since = new Date(now.getTime() - (paid ? 7 : 30) * DAY);
  return { limit: user.role === "admin" ? 999 : paid ? 3 : 1, since, used: usesSince(user.id, "tipster", since), window: paid ? "week" : "month" };
}

const SYSTEM: Record<Lang, string> = {
  pt: `Você extrai palpites de mensagens de tipsters (Telegram, WhatsApp, prints). Para cada palpite: quando foi postado (se a data/hora aparece), o jogo, a seleção, o mercado, a odd (decimal) se estiver escrita, as unidades se houver, e o que o tipster disse depois sobre ele (green, red ou anulado) se aparecer. Não invente nada que não esteja no texto. No máximo 60 palpites; ignore propaganda, figurinhas e conversa.`,
  en: `You extract betting picks from tipster messages (Telegram, WhatsApp, screenshots). For each pick: when it was posted (if a date/time is visible), the match, the selection, the market, the decimal odds if written, units if any, and what the tipster later claimed about it (green, red or void) if shown. Never invent anything that is not in the text. At most 60 picks; ignore ads, stickers and chat.`,
};

/** Test fixture: fictional teams from the e2e world; one pick posted after kickoff, one unverifiable. */
function mockPicks(): { picks: ExtractedPick[] } {
  const at = (hoursAgo: number) => new Date(Date.now() - hoursAgo * 3_600_000).toISOString();
  return { picks: [
    { postedAt: at(30), event: "Tupi FC x Ipê EC", selection: "Tupi FC vence", market: "Resultado final", odds: 2.1, units: 1, claimedResult: "green" },
    { postedAt: at(25), event: "Tupi FC x Ipê EC", selection: "Mais de 2,5 gols", market: "Total de gols", odds: null, units: 1, claimedResult: "green" },
    { postedAt: at(30), event: "Tupi FC x Ipê EC", selection: "Ipê EC vence", market: "Resultado final", odds: 3.5, units: 1, claimedResult: "green" },
    { postedAt: at(30), event: "Palmeiras x Santos", selection: "Palmeiras vence", market: "Resultado final", odds: 1.9, units: 1, claimedResult: "green" },
  ] };
}

/** The pasted text and the images are used here and dropped; only the extracted picks go on. */
export async function extractPicks(input: { text: string; images: StructuredImage[]; lang: Lang }): Promise<ExtractedPick[]> {
  const out = await generateStructured({
    schema: TipsterSchema,
    system: SYSTEM[input.lang],
    prompt: `${input.text ? `MESSAGES:\n${input.text.slice(0, TIPSTER_MAX_CHARS)}` : "The messages are in the images."}\n\nToday is ${new Date().toISOString().slice(0, 10)}.`,
    images: input.images,
    model: CHEAP_MODEL,
    maxTokens: 6000,
    label: "tipster_audit",
    mock: mockPicks,
  });
  return out.picks.slice(0, 60);
}

const context = (d: GameDetail, sportKey: string): GameContext => ({
  id: d.game.id, sportKey, startsAt: d.game.startsAt, home: d.game.home, away: d.game.away,
  athletes: d.rosters.flatMap((r) => (r.athletes ?? []).map((a) => ({ id: a.id, name: a.name, team: r.teamAbbreviation }))),
});

function estimatedOdds(d: GameDetail, settlement: NonNullable<ReturnType<typeof settlementFor>>): number | null {
  const book = d.books[0];
  if (!book) return null;
  const home = settlement.teamAbbreviation === d.game.home.abbreviation;
  const american = settlement.type === "moneyline" ? (home ? book.homeMoneyline : book.awayMoneyline)
    : settlement.type === "total" ? (settlement.side === "under" ? book.underOdds : book.overOdds) : undefined;
  const dec = american !== undefined ? americanToDecimal(american) : NaN;
  return Number.isFinite(dec) ? Number(dec.toFixed(2)) : null;
}

/** Each pick is matched to an ESPN game around the day it was posted and graded like any ticket. */
export async function gradePicks(sportKey: string, picks: ExtractedPick[]): Promise<GradedPick[]> {
  const anchor = (p: ExtractedPick) => (p.postedAt && Number.isFinite(Date.parse(p.postedAt)) ? espnDateKey(new Date(p.postedAt)) : todayKey());
  const days = [...new Set(picks.flatMap((p) => [-1, 0, 1].map((o) => shiftKey(anchor(p), o))))].slice(0, 15);
  const slates = new Map<string, Game[]>();
  for (const d of days) slates.set(d, await getSlate(d, false, sportKey).catch(() => []));
  const details = new Map<string, GameDetail | null>();
  const out: GradedPick[] = [];
  for (const [i, p] of picks.entries()) {
    const base: GradedPick = { postedAt: p.postedAt, startsAt: null, event: p.event, selection: p.selection, matchup: null, odds: p.odds, oddsSource: p.odds ? "stated" : null, claimed: p.claimedResult, outcome: "unverifiable" };
    const pool = [-1, 0, 1].flatMap((o) => slates.get(shiftKey(anchor(p), o)) ?? []);
    const lite: GameContext[] = pool.map((g) => ({ id: g.id, sportKey, startsAt: g.startsAt, home: g.home, away: g.away, athletes: [] }));
    const hit = gameForEvent(p.event || p.selection, lite);
    if (!hit) { out.push(base); continue; }
    if (!details.has(hit.id)) details.set(hit.id, await getGameDetail(hit.id, false, sportKey).catch(() => null));
    const d = details.get(hit.id);
    if (!d) { out.push(base); continue; }
    const resolved = resolveScanLeg({ event: p.event, selection: p.selection, market: p.market, odds: p.odds, startsAt: null }, i, [context(d, sportKey)]);
    const settlement = settlementFor(resolved, d.game.home.abbreviation);
    const matched = { ...base, startsAt: d.game.startsAt, matchup: `${d.game.away.displayName} @ ${d.game.home.displayName}` };
    if (!settlement) { out.push(matched); continue; }
    const odds = p.odds ?? estimatedOdds(d, settlement);
    const graded = await gradeLegAgainst({ selection: p.selection, market: settlement.type, sourceBasis: "tipster", settlement, predictedProbability: 0, oddsDecimal: odds ?? NaN, outcome: "pending" }, d, sportKey);
    out.push({ ...matched, odds, oddsSource: p.odds ? "stated" : odds ? "estimated" : null, outcome: graded.outcome });
  }
  return out;
}

export interface StoredAudit { id: string; label: string; report: AuditReport; picks: GradedPick[]; sportKey: string; createdAt: string }

export function saveAudit(userId: string, input: { label: string; sportKey: string; report: AuditReport; picks: GradedPick[] }): string {
  const id = newId("ta");
  getDb().prepare("INSERT INTO tipster_audits (id, userId, label, sportKey, report, picks, createdAt) VALUES (?,?,?,?,?,?,?)")
    .run(id, userId, input.label.slice(0, 60), input.sportKey, JSON.stringify(input.report), JSON.stringify(input.picks), nowIso());
  return id;
}

export function listAudits(userId: string): StoredAudit[] {
  const rows = getDb().prepare("SELECT id, label, sportKey, report, picks, createdAt FROM tipster_audits WHERE userId=? ORDER BY createdAt DESC LIMIT 20").all(userId) as { id: string; label: string; sportKey: string; report: string; picks: string; createdAt: string }[];
  return rows.map((r) => ({ id: r.id, label: r.label, sportKey: r.sportKey, createdAt: r.createdAt, report: JSON.parse(r.report) as AuditReport, picks: JSON.parse(r.picks) as GradedPick[] }));
}

export function deleteAudit(userId: string, id: string): boolean {
  return getDb().prepare("DELETE FROM tipster_audits WHERE id=? AND userId=?").run(id, userId).changes > 0;
}

export { auditReport };
