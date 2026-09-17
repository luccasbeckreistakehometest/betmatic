import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/server/session";
import { applyLearningRun, listLearningRuns } from "@/lib/ledger/learn";
import { describeAiError } from "@/lib/ai/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await requireAdmin())) return NextResponse.json({ error: "não autorizado" }, { status: 403 });
  return NextResponse.json({ runs: listLearningRuns(20).map((r) => ({ ...r, report: JSON.parse(r.report || "{}") })) });
}

/** Apply a run's proposed prompt feedback. */
export async function POST(request: Request) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "não autorizado" }, { status: 403 });
  const parsed = z.object({ id: z.string().max(80) }).safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "pedido inválido" }, { status: 400 });
  try {
    const out = await applyLearningRun(parsed.data.id, admin.email);
    return NextResponse.json(out, { status: out.ok ? 200 : 400 });
  } catch (error) {
    return NextResponse.json({ error: describeAiError(error) ?? "falhou" }, { status: 502 });
  }
}
