import { NextResponse } from "next/server";
import { currentUser } from "@/lib/server/session";
import { referralStats, REFERRAL_COINS } from "@/lib/server/referral";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "não autorizado" }, { status: 401 });
  const base = process.env.NEXT_PUBLIC_BASE_URL ?? "";
  const s = referralStats(user.id);
  return NextResponse.json({ ...s, coinsPerInvite: REFERRAL_COINS, link: `${base}/r/${s.code}` });
}
