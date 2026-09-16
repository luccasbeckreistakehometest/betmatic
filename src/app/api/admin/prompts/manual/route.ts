import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/server/session";
import { savePrompt } from "@/lib/server/prompts";

export const runtime = "nodejs";

const schema = z.object({ kind: z.enum(["game", "slate"]), lang: z.enum(["pt", "en"]), content: z.string().min(200).max(60000) });

/** Direct edit, for when the admin knows exactly what they want. */
export async function POST(request: Request) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "não autorizado" }, { status: 403 });
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "O prompt precisa ter entre 200 e 60000 caracteres." }, { status: 400 });
  const v = savePrompt({ ...parsed.data, source: "manual", createdBy: admin.email });
  return NextResponse.json({ ok: true, version: v.version });
}
