import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/server/session";
import { acquisitionReport } from "@/lib/server/analytics-report";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The acquisition panel's data. Admin only. */
export async function GET(request: Request) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const days = Number(new URL(request.url).searchParams.get("days"));
  return NextResponse.json(acquisitionReport(days === 30 ? 30 : days === 90 ? 90 : 7));
}
