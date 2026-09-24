import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/server/session";
import { listLearningRuns } from "@/lib/ledger/learn";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await requireAdmin())) return NextResponse.json({ error: "não autorizado" }, { status: 403 });
  return NextResponse.json({ runs: listLearningRuns(20).map((r) => ({ ...r, report: JSON.parse(r.report || "{}") })) });
}

/**
 * Read-only on purpose. Applying a run used to be a POST here, which skipped every brake the loop
 * has — the sample gate, the code-gate routing, the one-a-day cap — and showed the operator the
 * FEEDBACK rather than the prompt text it would produce. There is one door now, and it is
 * /api/admin/proposals.
 */
