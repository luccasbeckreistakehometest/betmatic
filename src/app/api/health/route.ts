import { NextResponse } from "next/server";
import { getDb } from "@/lib/server/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Liveness for the compose healthcheck and uptime monitors: public, read-only, no secrets. */
export async function GET() {
  let db = false;
  try {
    db = (getDb().prepare("SELECT 1 AS ok").get() as { ok: number }).ok === 1;
  } catch {
    db = false;
  }
  return NextResponse.json({ ok: db, db }, { status: db ? 200 : 503, headers: { "cache-control": "no-store" } });
}
