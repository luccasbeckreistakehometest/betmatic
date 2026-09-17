import { NextResponse } from "next/server";
import { recordRouteEvent } from "@/lib/server/analytics";
import { z } from "zod";
import { currentUser } from "@/lib/server/session";
import { addManual, addTicket, addWithLegs, gradeManual, listBankroll, removeEntry } from "@/lib/server/bankroll";
import { getDb } from "@/lib/server/db";
import type { CustomTicketView } from "@/lib/bets/custom-writeup";
import { currentStreak, getSettings, pauseState, stakeVerdict } from "@/lib/server/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "não autorizado" }, { status: 401 });
  const s = getSettings(user.id);
  return NextResponse.json({ ...listBankroll(user.id), streak: currentStreak(user.id), pause: pauseState(user.id), limits: { dailyStakeCap: s.dailyStakeCap, weeklyStakeCap: s.weeklyStakeCap } });
}

const schema = z.union([
  z.object({ kind: z.literal("ticket"), gameId: z.string().max(40), bandKey: z.string().max(20), selections: z.array(z.string().max(200)).min(1).max(20), stake: z.number().positive().max(1_000_000) }),
  z.object({ kind: z.literal("manual"), title: z.string().trim().min(2).max(160), odds: z.number().min(1.01).max(10_000), stake: z.number().positive().max(1_000_000) }),
  z.object({ kind: z.literal("custom"), slipId: z.string().max(40), ticketIndex: z.number().int().min(0).max(5), stake: z.number().positive().max(1_000_000) }),
]);

/** A custom parlay the user computed: its legs come from the stored result, never from the browser. */
function addCustom(userId: string, input: { slipId: string; ticketIndex: number; stake: number }) {
  const row = getDb().prepare("SELECT analysis, legs FROM user_slips WHERE id=? AND userId=? AND kind='custom'").get(input.slipId, userId) as { analysis: string; legs: string } | undefined;
  const ticket = row ? (JSON.parse(row.analysis) as CustomTicketView[])[input.ticketIndex] : undefined;
  if (!ticket) return null;
  const games = [...new Set(ticket.legs.map((l) => l.matchup))];
  return addWithLegs(userId, {
    source: "custom", title: ticket.title, matchup: games.length === 1 ? games[0] : `${games.length} jogos`, odds: Number(ticket.decimal.toFixed(2)), stake: input.stake,
    legs: ticket.legs.map((l) => ({ selection: l.selection, market: l.market, odds: l.decimal, gameId: l.gameId, sportKey: (JSON.parse(row!.legs) as { sport?: string }).sport ?? null, startsAt: l.startsAt ?? null, athleteId: l.athleteId ?? null, settlement: l.settlement })),
  });
}

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "não autorizado" }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "pedido inválido" }, { status: 400 });
  // Responsible play is enforced here, not in the UI: a pause locks the bankroll, a ceiling caps it.
  const pause = pauseState(user.id);
  if (pause.paused) return NextResponse.json({ error: "paused", pausedUntil: pause.until }, { status: 423 });
  const verdict = stakeVerdict(user.id, parsed.data.stake);
  if (!verdict.allowed) return NextResponse.json({ error: "limit", ...verdict }, { status: 422 });
  const data = parsed.data;
  const entry = data.kind === "ticket" ? addTicket(user.id, data) : data.kind === "custom" ? addCustom(user.id, data) : addManual(user.id, data);
  if (entry) await recordRouteEvent("ticket_saved", user.id, { kind: data.kind });
  return entry ? NextResponse.json({ entry }) : NextResponse.json({ error: "bilhete não encontrado no histórico" }, { status: 404 });
}

export async function PATCH(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "não autorizado" }, { status: 401 });
  const parsed = z.object({ id: z.string().max(80), outcome: z.enum(["won", "lost", "void"]) }).safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "pedido inválido" }, { status: 400 });
  return NextResponse.json({ ok: gradeManual(user.id, parsed.data.id, parsed.data.outcome) });
}

export async function DELETE(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "não autorizado" }, { status: 401 });
  const id = new URL(request.url).searchParams.get("id") ?? "";
  return NextResponse.json({ ok: removeEntry(user.id, id) });
}
