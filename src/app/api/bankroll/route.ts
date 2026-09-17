import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/server/session";
import { addManual, addTicket, gradeManual, listBankroll, removeEntry } from "@/lib/server/bankroll";
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
  z.object({ kind: z.literal("ticket"), gameId: z.string(), bandKey: z.string(), selections: z.array(z.string()).min(1), stake: z.number().positive().max(1_000_000) }),
  z.object({ kind: z.literal("manual"), title: z.string().trim().min(2).max(160), odds: z.number().min(1.01).max(10_000), stake: z.number().positive().max(1_000_000) }),
]);

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
  const entry = parsed.data.kind === "ticket" ? addTicket(user.id, parsed.data) : addManual(user.id, parsed.data);
  return entry ? NextResponse.json({ entry }) : NextResponse.json({ error: "bilhete não encontrado no histórico" }, { status: 404 });
}

export async function PATCH(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "não autorizado" }, { status: 401 });
  const parsed = z.object({ id: z.string(), outcome: z.enum(["won", "lost", "void"]) }).safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "pedido inválido" }, { status: 400 });
  return NextResponse.json({ ok: gradeManual(user.id, parsed.data.id, parsed.data.outcome) });
}

export async function DELETE(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "não autorizado" }, { status: 401 });
  const id = new URL(request.url).searchParams.get("id") ?? "";
  return NextResponse.json({ ok: removeEntry(user.id, id) });
}
