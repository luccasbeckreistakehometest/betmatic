import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/server/session";
import { addTeamAlias, assignEventGame, booksStats, listAdapterStatus, listCoverage, listUnmatchedEvents, runBooksJob, setAdapterEnabled } from "@/lib/server/book-prices";
import { SKIPPED_BOOKS, booksConfig, findAdapter } from "@/lib/sources/br-books/registry";
import { SOLD_SPORTS } from "@/lib/sports";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const forbidden = () => NextResponse.json({ error: "forbidden" }, { status: 403 });

/** Adapter status, coverage per game, the unmatched fixtures and the books left out. */
export async function GET() {
  if (!(await requireAdmin())) return forbidden();
  return NextResponse.json({
    stats: booksStats(),
    adapters: listAdapterStatus(),
    coverage: listCoverage(),
    unmatched: listUnmatchedEvents(),
    skipped: SKIPPED_BOOKS,
    config: booksConfig(),
    sports: SOLD_SPORTS.map((s) => s.key),
  });
}

/** run | toggle | assign | unassign | alias — the hand tools behind the panel. */
export async function POST(request: Request) {
  if (!(await requireAdmin())) return forbidden();
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const action = String(body.action ?? "");
  if (action === "run") {
    const sports = Array.isArray(body.sports) ? body.sports.map(String) : [];
    const result = await runBooksJob({ sports });
    return NextResponse.json(result, { status: result.status === "error" ? 502 : 200 });
  }
  if (action === "toggle") {
    const id = String(body.id ?? "");
    if (!findAdapter(id)) return NextResponse.json({ error: "unknown adapter" }, { status: 400 });
    const enabled = body.enabled === null ? null : Boolean(body.enabled);
    setAdapterEnabled(id, enabled);
    return NextResponse.json({ ok: true, adapters: listAdapterStatus() });
  }
  if (action === "assign" || action === "unassign") {
    const eventKey = String(body.eventKey ?? "");
    const gameId = action === "assign" ? String(body.gameId ?? "") : null;
    if (!eventKey || (gameId !== null && !/^\d{1,12}$/.test(gameId))) return NextResponse.json({ error: "invalid" }, { status: 400 });
    const ok = assignEventGame(eventKey, gameId, Boolean(body.swapped));
    return NextResponse.json({ ok });
  }
  if (action === "alias") {
    const sportKey = String(body.sportKey ?? ""), alias = String(body.alias ?? "").trim(), teamName = String(body.teamName ?? "").trim();
    if (!SOLD_SPORTS.some((s) => s.key === sportKey) || alias.length < 2 || teamName.length < 2) return NextResponse.json({ error: "invalid" }, { status: 400 });
    addTeamAlias(sportKey, alias, teamName);
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
