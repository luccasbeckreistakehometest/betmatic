import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/server/session";
import { HandleTakenError, currentStreak, getSettings, pauseState, stakedWindows, updateSettings } from "@/lib/server/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function payload(userId: string) {
  return { settings: getSettings(userId), pause: pauseState(userId), staked: stakedWindows(userId), streak: currentStreak(userId) };
}

export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "não autorizado" }, { status: 401 });
  return NextResponse.json(payload(user.id));
}

const money = z.number().positive().max(10_000_000).nullable();
const schema = z.object({
  dailyStakeCap: money.optional(),
  weeklyStakeCap: money.optional(),
  sessionReminderMinutes: z.number().int().min(1).max(240).nullable().optional(),
  lossStreakNotice: z.number().int().min(0).max(20).optional(),
  leaderboardOptIn: z.boolean().optional(),
  handle: z.string().max(32).nullable().optional(),
  bankrollAmount: money.optional(),
});

export async function PATCH(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "não autorizado" }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "pedido inválido" }, { status: 400 });
  try {
    updateSettings(user.id, parsed.data);
  } catch (error) {
    if (error instanceof HandleTakenError) return NextResponse.json({ error: "handle_taken" }, { status: 409 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "pedido inválido" }, { status: 400 });
  }
  return NextResponse.json(payload(user.id));
}
