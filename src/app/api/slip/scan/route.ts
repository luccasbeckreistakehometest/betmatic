import { NextResponse } from "next/server";
import { currentUser } from "@/lib/server/session";
import { apiError, rateLimited, requestLang } from "@/lib/server/api";
import { accountKey, hit, ipKey } from "@/lib/server/rate-limit";
import { pauseState } from "@/lib/server/settings";
import { aiTryLimits, claimUse, globalUsesToday, recordUse, releaseUse } from "@/lib/server/feature-uses";
import { newId } from "@/lib/server/db";
import { extractSlip, resolveScan, SCAN_MAX_BYTES, scanLimits } from "@/lib/server/slip-scan";
import { slipChecks, sniffImage } from "@/lib/bets/slip-scan";
import { logEvent, reportError } from "@/lib/server/ops-log";
import { AiBudgetExceededError } from "@/lib/server/ai-budget";
import { aiConfigured } from "@/lib/ai/client";
import { SOLD_SPORTS } from "@/lib/sports";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * "Manda o print": the raw image body is read in memory, checked, sent to the cheap vision model and
 * dropped. Only its size is logged. Capped per day (free 3, paid 20) and globally.
 */
export async function POST(request: Request) {
  const user = await currentUser();
  const lang = requestLang(request, user?.lang);
  if (!user) return apiError("unauthenticated", lang, 401);
  const sportKey = new URL(request.url).searchParams.get("sport") ?? "";
  if (!SOLD_SPORTS.some((s) => s.key === sportKey)) return apiError("invalid_input", lang, 400);
  if (pauseState(user.id).paused) return apiError("paused", lang, 423);
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > SCAN_MAX_BYTES) return apiError("image_too_big", lang, 413);
  const acct = hit("slipAccount", accountKey(user.id));
  if (!acct.ok) return rateLimited(acct, lang);
  const ip = hit("aiIp", ipKey(request));
  if (!ip.ok) return rateLimited(ip, lang);

  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.length > SCAN_MAX_BYTES) return apiError("image_too_big", lang, 413);
  const mediaType = sniffImage(bytes);
  if (!mediaType) return apiError("image_invalid", lang, 415);
  if (!aiConfigured()) return apiError("ai_unavailable", lang, 503, { manual: true });

  const limits = scanLimits();
  const paid = user.role === "admin" || user.plan.id !== "free";
  // The global ceiling counts model calls, not successful reads.
  if (user.role !== "admin" && globalUsesToday("scan_try") >= limits.global) return apiError("scan_busy", lang, 503, { manual: true });
  const key = newId("scan");
  const limit = user.role === "admin" ? Number.MAX_SAFE_INTEGER : paid ? limits.paid : limits.free;
  const claim = claimUse({ userId: user.id, feature: "scan", key, limit });
  if (!claim.ok) return apiError("scan_cap", lang, 403, { used: claim.used, limit });
  if (user.role !== "admin") {
    const tries = aiTryLimits().scan;
    const tried = claimUse({ userId: user.id, feature: "scan_try", key, limit: paid ? tries.paid : tries.free });
    if (!tried.ok) {
      releaseUse(user.id, "scan", key);
      return apiError("ai_tries", lang, 429, { manual: true });
    }
  }

  try {
    const scan = await extractSlip({ data: Buffer.from(bytes).toString("base64"), mediaType }, lang);
    logEvent("slip.scan", { bytes: bytes.length, legs: scan.legs.length });
    // The model read the image and found nothing: that read was paid for, so it counts.
    if (!scan.legs.length) return apiError("scan_unreadable", lang, 422, { used: claim.used, limit: user.role === "admin" ? null : limit });
    const legs = await resolveScan(sportKey, scan.legs);
    // The id the save route will ask for: one save per read print.
    recordUse(user.id, "scan_ok", key);
    return NextResponse.json({ scanId: key, scan: { ...scan, legs }, checks: slipChecks({ ...scan, legs }), used: claim.used, limit: user.role === "admin" ? null : limit });
  } catch (error) {
    // A failed call gives the read back; the try stays counted.
    releaseUse(user.id, "scan", key);
    if (error instanceof AiBudgetExceededError) return apiError("ai_budget", lang, 503, { manual: true });
    reportError("ai.slip_scan", error, { userId: user.id, bytes: bytes.length }, "warn");
    return apiError("ai_unavailable", lang, 502, { manual: true });
  }
}
