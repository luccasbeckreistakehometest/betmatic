import { NextResponse } from "next/server";
import { z } from "zod";
import { cookies } from "next/headers";
import { createUser } from "@/lib/server/users";
import { REF_COOKIE, creditReferral } from "@/lib/server/referral";
import { SESSION_COOKIE, signSession } from "@/lib/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  name: z.string().trim().min(1),
  email: z.string().trim().email(),
  password: z.string().min(8, "A senha precisa de ao menos 8 caracteres"),
  lang: z.enum(["pt", "en"]).default("pt"),
});

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Dados inválidos" }, { status: 400 });
  }
  try {
    const user = createUser(parsed.data);
    const jar = await cookies();
    // A referral cookie set by /r/[code] credits both sides once; the cookie is then spent.
    if (creditReferral(user.id, jar.get(REF_COOKIE)?.value)) jar.set(REF_COOKIE, "", { path: "/", maxAge: 0 });
    jar.set(SESSION_COOKIE, signSession({ userId: user.id, role: user.role }), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 30 * 86_400,
    });
    return NextResponse.json({ ok: true, role: user.role });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha no cadastro" },
      { status: 400 },
    );
  }
}
