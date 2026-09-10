import { NextResponse } from "next/server";
import { z } from "zod";
import { cookies } from "next/headers";
import { authenticate } from "@/lib/server/users";
import { SESSION_COOKIE, signSession } from "@/lib/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ email: z.string().trim(), password: z.string() });

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
  const user = authenticate(parsed.data.email, parsed.data.password);
  // One message for both cases so the response cannot be used to enumerate accounts.
  if (!user) return NextResponse.json({ error: "E-mail ou senha incorretos" }, { status: 401 });

  (await cookies()).set(SESSION_COOKIE, signSession({ userId: user.id, role: user.role }), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 30 * 86_400,
  });
  return NextResponse.json({ ok: true, role: user.role });
}
