import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/server/session";
import { apiError, requestLang } from "@/lib/server/api";
import { pauseState, stakeVerdict } from "@/lib/server/settings";
import { addWithLegs } from "@/lib/server/bankroll";
import { resolveScan } from "@/lib/server/slip-scan";
import { recordEvent } from "@/lib/server/analytics";
import { SOLD_SPORTS } from "@/lib/sports";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  sport: z.string().max(20),
  lang: z.enum(["pt", "en"]).default("pt"),
  book: z.string().trim().max(60).nullable().default(null),
  betType: z.enum(["single", "multiple", "bet_builder"]).nullable().default(null),
  stake: z.number().positive().max(1_000_000),
  totalOdds: z.number().min(1.01).max(100_000),
  legs: z.array(z.object({
    event: z.string().trim().max(160).default(""),
    selection: z.string().trim().min(1).max(200),
    market: z.string().trim().max(80).default(""),
    odds: z.number().min(1.01).max(10_000).nullable().default(null),
  })).min(1).max(20),
});

/**
 * Saves a reviewed print to the bankroll. The legs are matched to ESPN again here — nothing the
 * browser sends decides how a leg is graded. The bet is already placed, so a stake ceiling does not
 * block the save; it comes back as a notice.
 */
export async function POST(request: Request) {
  const user = await currentUser();
  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  const lang = parsed.success ? parsed.data.lang : requestLang(request, user?.lang);
  if (!user) return apiError("unauthenticated", lang, 401);
  if (!parsed.success || !SOLD_SPORTS.some((s) => s.key === parsed.data.sport)) return apiError("invalid_input", lang, 400);
  const pause = pauseState(user.id);
  if (pause.paused) return NextResponse.json({ error: "paused", pausedUntil: pause.until }, { status: 423 });
  const d = parsed.data;
  const legs = await resolveScan(d.sport, d.legs.map((l) => ({ ...l, startsAt: null })));
  const verdict = stakeVerdict(user.id, d.stake);
  const games = [...new Set(legs.map((l) => l.resolved.matchup ?? l.event).filter(Boolean))];
  const entry = addWithLegs(user.id, {
    source: "scan",
    title: `${d.book ?? (lang === "pt" ? "Print" : "Slip")} · ${d.legs.length} ${lang === "pt" ? (d.legs.length === 1 ? "perna" : "pernas") : d.legs.length === 1 ? "leg" : "legs"}`,
    matchup: games.length === 1 ? games[0] : `${games.length} ${lang === "pt" ? "jogos" : "games"}`,
    odds: d.totalOdds,
    stake: d.stake,
    legs: legs.map((l) => ({ selection: l.selection, market: l.market, odds: l.odds, gameId: l.gameId, sportKey: l.gameId ? d.sport : null, startsAt: l.startsAt, athleteId: l.athleteId, settlement: l.settlement })),
  });
  if (!entry) return apiError("server_error", lang, 500);
  recordEvent("scan_done", user.id, { legs: d.legs.length, auto: legs.filter((l) => l.settlement).length });
  return NextResponse.json({ entry, limitNotice: verdict.allowed ? null : verdict });
}
