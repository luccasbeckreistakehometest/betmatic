import { NextResponse } from "next/server";
import { handleWebhook } from "@/lib/server/mercadopago";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const url = new URL(request.url);
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  // Mercado Pago sends the id in the query on some events and in the body on others.
  const paymentId =
    url.searchParams.get("data.id") ??
    url.searchParams.get("id") ??
    ((body.data as { id?: string } | undefined)?.id ?? (body.id as string | undefined));

  if (!paymentId) return NextResponse.json({ ok: true, note: "no payment id" });

  try {
    const result = await handleWebhook(String(paymentId));
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    // Returning 200 stops Mercado Pago retrying forever on a payload we cannot process.
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "webhook failed" },
      { status: 200 },
    );
  }
}
