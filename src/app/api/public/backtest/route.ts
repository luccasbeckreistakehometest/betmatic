import { NextResponse } from "next/server";
import { readLedger } from "@/lib/ledger/store";
import { toRows } from "@/lib/ledger/backtest";
import { publicTickets, ticketSlug } from "@/lib/ledger/proof";

export const dynamic = "force-dynamic";

/** The public record as chart rows: outcomes, odds, band, sport, kind, evidence — no text, ids as public slugs. */
export async function GET() {
  return NextResponse.json({ rows: toRows(publicTickets(readLedger()), (e) => ticketSlug(e.id)) });
}
