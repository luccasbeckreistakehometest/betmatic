import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/server/session";
import { activePrompts, listPromptVersions } from "@/lib/server/prompts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await requireAdmin())) return NextResponse.json({ error: "não autorizado" }, { status: 403 });
  return NextResponse.json({
    active: activePrompts(),
    history: { game: listPromptVersions("game").map(strip), slate: listPromptVersions("slate").map(strip) },
  });
}
const strip = (v: ReturnType<typeof listPromptVersions>[number]) => ({ ...v, content: undefined, chars: v.content.length });
