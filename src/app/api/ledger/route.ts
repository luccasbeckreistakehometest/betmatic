import { NextResponse } from "next/server";
import { settlePending } from "@/lib/ledger/settle";
import { calibrate, ledgerSummary, specialisation } from "@/lib/ledger/calibrate";
import { readLedger } from "@/lib/ledger/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const includeEntries = url.searchParams.get("entries") === "1";
  return NextResponse.json({
    summary: ledgerSummary(),
    calibration: calibrate(),
    specialisation: specialisation(),
    entries: includeEntries ? readLedger().slice(-100).reverse() : undefined,
  });
}

/** Grades pending tickets whose games have finished. Run it after a slate completes. */
export async function POST() {
  try {
    const result = await settlePending();
    return NextResponse.json({
      ...result,
      summary: ledgerSummary(),
      calibration: calibrate(),
      specialisation: specialisation(),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Settlement failed" },
      { status: 502 },
    );
  }
}
