import { NextResponse } from "next/server";
import { settlePending } from "@/lib/ledger/settle";
import { calibrate, ledgerSummary, specialisation } from "@/lib/ledger/calibrate";
import { readLedger } from "@/lib/ledger/store";
import { currentUser, requireAdmin } from "@/lib/server/session";
import { publicEntry } from "@/lib/ledger/public-view";
import { publicTickets, withinRecordWindow } from "@/lib/ledger/proof";
import { normaliseLang } from "@/lib/i18n";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * The track record. Read-only (the cron settles). Non-admins get the whitelabelled view: totals,
 * per-market calibration and scrubbed entries of tickets whose game has started, never the
 * per-source breakdown and never a ticket that can still be bet.
 */
/**
 * The most recent `n` tickets BY TIME, not by where they happen to sit in the file.
 *
 * `readLedger()` returns append order, and a ledger gains rows in the order they were written —
 * which is not the order the games were played. Backfilling older history would then push the
 * newest tickets out of "the latest 100" and the operator would be looking at an arbitrary slice.
 */
function latest<T extends { startsAt?: string; createdAt: string }>(entries: T[], n: number): T[] {
  const at = (e: T) => Date.parse(e.startsAt ?? e.createdAt) || 0;
  return [...entries].sort((a, b) => at(a) - at(b)).slice(-n).reverse();
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const includeEntries = url.searchParams.get("entries") === "1";
  const user = await currentUser();
  const admin = user?.role === "admin";
  const lang = normaliseLang(url.searchParams.get("lang") ?? user?.lang);
  const report = calibrate();
  if (admin) {
    const entries = includeEntries ? latest(readLedger(), 100) : undefined;
    return NextResponse.json({ admin: true, summary: ledgerSummary(), calibration: report, specialisation: specialisation(), entries });
  }
  const entries = includeEntries ? latest(publicTickets(withinRecordWindow(readLedger())), 100) : undefined;
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
