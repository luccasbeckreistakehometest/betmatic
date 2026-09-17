import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/server/session";
import { CONTACT_STATUSES, listContactMessages, updateContactMessage } from "@/lib/server/contact";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const status = new URL(request.url).searchParams.get("status") ?? undefined;
  return NextResponse.json({ messages: listContactMessages({ status }) });
}

const schema = z.object({ id: z.string().max(80), status: z.enum(CONTACT_STATUSES).optional(), adminNote: z.string().max(2000).optional() });

export async function PATCH(request: Request) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  const ok = updateContactMessage(parsed.data.id, parsed.data);
  return ok ? NextResponse.json({ ok }) : NextResponse.json({ error: "not_found" }, { status: 404 });
}
