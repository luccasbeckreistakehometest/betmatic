import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/server/session";
import { resetToDefault, revertPrompt } from "@/lib/server/prompts";

export const runtime = "nodejs";

const schema = z.union([z.object({ id: z.string() }), z.object({ kind: z.enum(["game", "slate"]), reset: z.literal(true) })]);

/** Revert to a previous version, or to the code default. */
export async function POST(request: Request) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "não autorizado" }, { status: 403 });
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "pedido inválido" }, { status: 400 });
  if ("reset" in parsed.data) { resetToDefault(parsed.data.kind, admin.email); return NextResponse.json({ ok: true }); }
  const v = revertPrompt(parsed.data.id, admin.email);
  return v ? NextResponse.json({ ok: true, version: v.version }) : NextResponse.json({ error: "versão não encontrada" }, { status: 404 });
}
