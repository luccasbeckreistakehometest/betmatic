import { NextResponse } from "next/server";
import { readLedger } from "@/lib/ledger/store";
import { toRows } from "@/lib/ledger/backtest";
import { mainTickets, publicTickets, ticketSlug, withinRecordWindow } from "@/lib/ledger/proof";

export const dynamic = "force-dynamic";

/**
 * The public record as chart rows: outcomes, odds, band, sport, kind, evidence — no text, ids as
 * public slugs.
 *
 * Inside the publication window, like every other published number. /prova draws its curve from
 * `withinRecordWindow(readLedger())` and says on the page which day it counts from; this endpoint
 * drew the same curve from the whole ledger, so the two described different periods and only one
 * of them admitted it. Anything the correction or the gate computes with still reads everything —
 * that split lives in `calibration-input.ts` — but what is PUBLISHED answers to one window.
 */
export async function GET() {
  return NextResponse.json({ rows: toRows(publicTickets(mainTickets(withinRecordWindow(readLedger()))), (e) => ticketSlug(e.id)) });
}
