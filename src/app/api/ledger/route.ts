import { NextResponse } from "next/server";
import { settlePending } from "@/lib/ledger/settle";
import { calibrate, ledgerSummary, specialisation } from "@/lib/ledger/calibrate";
import { readLedger } from "@/lib/ledger/store";
import { currentUser, requireAdmin } from "@/lib/server/session";
import { publicEntry } from "@/lib/ledger/public-view";
import { normaliseLang } from "@/lib/i18n";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * The track record. Read-only (the cron settles). Non-admins get the whitelabelled view: totals,
 * per-market calibration and scrubbed entries, never the per-source breakdown.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const includeEntries = url.searchParams.get("entries") === "1";
  const user = await currentUser();
  const admin = user?.role === "admin";
  const lang = normaliseLang(url.searchParams.get("lang") ?? user?.lang);
  const report = calibrate();
  const entries = includeEntries ? readLedger().slice(-100).reverse() : undefined;
  if (admin) {
    return NextResponse.json({ admin: true, summary: ledgerSummary(), calibration: report, specialisation: specialisation(), entries });
  }
  return NextResponse.json({
    admin: false,
    summary: ledgerSummary(),
    calibration: { byMarket: report.byMarket },
    entries: entries?.map((e) => publicEntry(e, lang)),
  });
}

/** Grades pending tickets whose games have finished. Operator-only; the cron does it hourly. */
export async function POST() {
  if (!(await requireAdmin())) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  try {
    const result = await settlePending();
    return NextResponse.json({ ...result, summary: ledgerSummary() });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Settlement failed" }, { status: 502 });
  }
}
