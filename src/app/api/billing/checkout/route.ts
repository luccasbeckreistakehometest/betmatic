import { NextResponse } from "next/server";
import { recordRouteEvent } from "@/lib/server/analytics";
import { z } from "zod";
import { currentUser } from "@/lib/server/session";
import { createCoinCheckout, createPlanCheckout, mpConfigured } from "@/lib/server/mercadopago";
import { apiError, rateLimited, requestLang } from "@/lib/server/api";
import { accountKey, hit } from "@/lib/server/rate-limit";
import { reportError } from "@/lib/server/ops-log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const schema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("coins"), packId: z.string().max(40) }),
  z.object({ kind: z.literal("plan"), planId: z.string().max(40), period: z.enum(["monthly", "quarterly", "semiannual", "annual"]).default("monthly") }),
]);

/** Starts a Mercado Pago Checkout Pro payment and returns the page to send the buyer to. */
export async function POST(request: Request) {
  const user = await currentUser();
  const lang = requestLang(request, user?.lang);
  if (!user) return apiError("unauthenticated", lang, 401);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("invalid_input", lang, 400);
  if (!mpConfigured()) return apiError("payments_off", lang, 503);
  const limit = hit("checkoutAccount", accountKey(user.id));
  if (!limit.ok) return rateLimited(limit, lang);

  try {
    const data = parsed.data;
    const result = data.kind === "coins"
      ? await createCoinCheckout(user.id, data.packId, user.email)
      : await createPlanCheckout(user.id, data.planId, data.period, user.email);
    await recordRouteEvent("checkout_started", user.id, { kind: data.kind, ref: data.kind === "coins" ? data.packId : data.planId });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof RangeError) return apiError("invalid_input", lang, 400);
    reportError("payments.checkout", error, { userId: user.id });
    return apiError("checkout_failed", lang, 502);
  }
}
