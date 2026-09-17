import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/server/session";
import { listPayments } from "@/lib/server/mercadopago";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const url = new URL(request.url);
  return NextResponse.json({ payments: listPayments({ status: url.searchParams.get("status") ?? undefined, limit: Number(url.searchParams.get("limit")) || 100 }) });
}
