import { NextResponse } from "next/server";
import { handleWebhook, MercadoPagoError, mpConfigured, webhookSignatureState } from "@/lib/server/mercadopago";
import { hit, ipKey } from "@/lib/server/rate-limit";
import { logEvent, reportError } from "@/lib/server/ops-log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Mercado Pago notifications. Nothing in the body is trusted: the payment is re-read from the API.
 * A failed lookup answers 5xx so Mercado Pago retries; a payload that is not ours answers 200.
 */
export async function POST(request: Request) {
  if (!hit("webhookIp", ipKey(request)).ok) return NextResponse.json({ ok: false }, { status: 429 });
  if (!mpConfigured()) return NextResponse.json({ ok: false, note: "payments not configured" }, { status: 503 });

  const url = new URL(request.url);
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const topic = url.searchParams.get("type") ?? url.searchParams.get("topic") ?? String(body.type ?? body.topic ?? "");
  const queryId = url.searchParams.get("data.id") ?? url.searchParams.get("id");
  const bodyId = (body.data as { id?: string | number } | undefined)?.id;
  const paymentId = String(queryId ?? bodyId ?? "");

  const signature = webhookSignatureState({ signature: request.headers.get("x-signature"), requestId: request.headers.get("x-request-id"), dataId: queryId ?? (bodyId != null ? String(bodyId) : null) });
  if (signature === "invalid") {
    reportError("payments.webhook", new Error("invalid x-signature"), { paymentId }, "warn");
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  if (signature === "unsigned") logEvent("payments.webhook.unsigned", { paymentId, topic });
  if (topic && topic !== "payment") return NextResponse.json({ ok: true, note: `ignored ${topic}` });
  if (!paymentId) return NextResponse.json({ ok: true, note: "no payment id" });

  try {
    const result = await handleWebhook(paymentId);
    logEvent("payments.webhook", { paymentId, ...result });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    reportError("payments.webhook", error, { paymentId });
    // 5xx makes Mercado Pago retry later instead of losing a paid purchase.
    const status = error instanceof MercadoPagoError && error.status === 404 ? 404 : 500;
    return NextResponse.json({ ok: false }, { status });
  }
}
