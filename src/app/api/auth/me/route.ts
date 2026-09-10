import { NextResponse } from "next/server";
import { currentUser } from "@/lib/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ user: null });
  return NextResponse.json({
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      coins: user.coins,
      lang: user.lang,
      planActive: user.planActive,
      planExpiresAt: user.planExpiresAt,
      plan: { id: user.plan.id, name: user.plan.name },
    },
  });
}
