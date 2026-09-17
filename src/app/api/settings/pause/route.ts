import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/server/session";
import { getSettings, pauseState, pauseUser } from "@/lib/server/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Self-exclusion for 7 or 30 days. There is deliberately no endpoint to lift it early. */
export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "não autorizado" }, { status: 401 });
  const parsed = z.object({ days: z.union([z.literal(7), z.literal(30)]) }).safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "pedido inválido" }, { status: 400 });
  pauseUser(user.id, parsed.data.days);
  return NextResponse.json({ settings: getSettings(user.id), pause: pauseState(user.id) });
}
