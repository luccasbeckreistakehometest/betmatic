import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/server/session";
import { applyFeedback } from "@/lib/server/prompts";
import { aiConfigured, describeAiError } from "@/lib/ai/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ kind: z.enum(["game", "slate"]), feedback: z.string().trim().min(10).max(4000) });

/** The admin's feedback becomes a new active prompt version, with the agent's own account of the change. */
export async function POST(request: Request) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "não autorizado" }, { status: 403 });
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Escreva o feedback com pelo menos 10 caracteres." }, { status: 400 });
  if (!aiConfigured()) return NextResponse.json({ error: "A IA não está configurada neste servidor." }, { status: 503 });
  try {
    const out = await applyFeedback({ ...parsed.data, createdBy: admin.email });
    return NextResponse.json({ ok: true, rationale: out.rationale, versions: out.versions.map((v) => ({ id: v.id, lang: v.lang, version: v.version })) });
  } catch (error) {
    return NextResponse.json({ error: describeAiError(error) ?? (error instanceof Error ? error.message : "falhou") }, { status: 502 });
  }
}
