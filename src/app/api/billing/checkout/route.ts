import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/server/session";
import { createCoinCheckout, createPlanCheckout, mpConfigured } from "@/lib/server/mercadopago";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const schema = z.object({
  kind: z.enum(["coins", "plan"]),
  packId: z.string().optional(),
  planId: z.string().optional(),
  period: z.enum(["monthly", "quarterly", "semiannual", "annual"]).default("monthly"),
});

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "não autenticado" }, { status: 401 });
  if (!mpConfigured()) {
    return NextResponse.json({ error: "Pagamento ainda não configurado (falta MP_ACCESS_TOKEN)." }, { status: 503 });
  }
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });

  try {
    const { kind, packId, planId, period } = parsed.data;
    if (kind === "coins") {
      if (!packId) return NextResponse.json({ error: "packId ausente" }, { status: 400 });
      return NextResponse.json(await createCoinCheckout(user.id, packId, user.email));
    }
    if (!planId) return NextResponse.json({ error: "planId ausente" }, { status: 400 });
    return NextResponse.json(await createPlanCheckout(user.id, planId, period, user.email));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro no checkout" },
      { status: 502 },
    );
  }
}
