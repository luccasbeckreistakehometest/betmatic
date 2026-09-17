import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/server/session";
import { apiError, rateLimited, requestLang } from "@/lib/server/api";
import { accountKey, hit, ipKey } from "@/lib/server/rate-limit";
import { pauseState } from "@/lib/server/settings";
import { newId } from "@/lib/server/db";
import { aiTryLimits, claimUse, globalUsesToday, releaseUse } from "@/lib/server/feature-uses";
import { adjustCoins, InsufficientCoinsError } from "@/lib/server/users";
import { deleteAudit, extractPicks, gradePicks, listAudits, saveAudit, TIPSTER_MAX_CHARS, tipsterAllowance } from "@/lib/server/tipster";
import { auditReport, redFlags } from "@/lib/tipster/audit";
import { sniffImage } from "@/lib/bets/slip-scan";
import { recordEvent } from "@/lib/server/analytics";
import { reportError } from "@/lib/server/ops-log";
import { AiBudgetExceededError } from "@/lib/server/ai-budget";
import { aiConfigured } from "@/lib/ai/client";
import { ACTION_COST } from "@/lib/plans";
import { SOLD_SPORTS } from "@/lib/sports";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const schema = z.object({
  lang: z.enum(["pt", "en"]).default("pt"),
  sport: z.string().max(20),
  label: z.string().trim().max(60).default(""),
  text: z.string().max(TIPSTER_MAX_CHARS).default(""),
  /** Up to five screenshots, base64 (already shrunk by the browser). */
  images: z.array(z.string().max(1_400_000)).max(5).default([]),
  /** Past the allowance, the user confirms paying coins for this one. */
  extra: z.boolean().default(false),
});

export async function GET(request: Request) {
  const user = await currentUser();
  const lang = requestLang(request, user?.lang);
  if (!user) return apiError("unauthenticated", lang, 401);
  const a = tipsterAllowance(user);
  return NextResponse.json({ audits: listAudits(user.id), allowance: { used: a.used, limit: a.limit, window: a.window }, extraPrice: ACTION_COST.tipster_audit, coins: user.coins, aiReady: aiConfigured() });
}

/**
 * Audits a tipster privately. The pasted text and images are read in memory and dropped; only the
 * extracted picks and the graded report are stored, under the user's own private label.
 */
export async function POST(request: Request) {
  const user = await currentUser();
  const parsed = schema.safeParse(await request.json().catch(() => null));
  const lang = parsed.success ? parsed.data.lang : requestLang(request, user?.lang);
  if (!user) return apiError("unauthenticated", lang, 401);
  if (!parsed.success || !SOLD_SPORTS.some((s) => s.key === parsed.data.sport)) return apiError("invalid_input", lang, 400);
  const d = parsed.data;
  if (!d.text.trim() && !d.images.length) return apiError("invalid_input", lang, 400);
  if (pauseState(user.id).paused) return apiError("paused", lang, 423);
  const images = [];
  for (const b64 of d.images) {
    const bytes = Buffer.from(b64, "base64");
    const mediaType = sniffImage(bytes);
    if (!mediaType) return apiError("image_invalid", lang, 415);
    images.push({ data: b64, mediaType });
  }
  if (!aiConfigured()) return apiError("ai_unavailable", lang, 503);
  const acct = hit("aiAccount", accountKey(user.id));
  if (!acct.ok) return rateLimited(acct, lang);
  const ip = hit("aiIp", ipKey(request));
  if (!ip.ok) return rateLimited(ip, lang);

  const tries = aiTryLimits().tipster;
  if (user.role !== "admin" && globalUsesToday("tipster_try") >= tries.global) return apiError("tipster_busy", lang, 503);

  const allowance = tipsterAllowance(user);
  const key = newId("audit");
  const claim = claimUse({ userId: user.id, feature: "tipster", key, limit: allowance.limit, since: allowance.since });
  let paid = 0;
  if (!claim.ok) {
    if (!d.extra) return apiError("tipster_cap", lang, 402, { used: claim.used, limit: allowance.limit, window: allowance.window, extraPrice: ACTION_COST.tipster_audit });
    try {
      adjustCoins(user.id, -ACTION_COST.tipster_audit, "spend:tipster_audit", {});
      paid = ACTION_COST.tipster_audit;
    } catch (error) {
      if (error instanceof InsufficientCoinsError) return apiError("insufficient_coins", lang, 402, { needed: error.needed, balance: error.balance });
      throw error;
    }
  }
  const undo = () => {
    if (claim.ok) releaseUse(user.id, "tipster", key);
    if (paid) adjustCoins(user.id, paid, "refund:tipster_audit", {});
  };
  if (user.role !== "admin") {
    const tried = claimUse({ userId: user.id, feature: "tipster_try", key, limit: user.plan.id !== "free" ? tries.paid : tries.free });
    if (!tried.ok) { undo(); return apiError("ai_tries", lang, 429); }
  }
  try {
    const flags = redFlags(d.text);
    const picks = await extractPicks({ text: d.text, images, lang });
    // The model read it all and found no pick: the read was paid for, so the allowance slot stays
    // used; coins spent on an extra come back (the daily try cap bounds that path).
    if (!picks.length) {
      if (paid) adjustCoins(user.id, paid, "refund:tipster_audit", {});
      return apiError("tipster_unreadable", lang, 422);
    }
    const graded = await gradePicks(d.sport, picks);
    const report = auditReport(graded, flags);
    const id = saveAudit(user.id, { label: d.label || (lang === "pt" ? "Tipster sem nome" : "Unnamed tipster"), sportKey: d.sport, report, picks: graded });
    recordEvent("tipster_audit_done", user.id, { picks: report.total, verifiable: report.verifiable });
    return NextResponse.json({ id, report, picks: graded, coinsSpent: paid });
  } catch (error) {
    undo();
    if (error instanceof AiBudgetExceededError) return apiError("ai_budget", lang, 503);
    reportError("ai.tipster", error, { userId: user.id }, "warn");
    return apiError("ai_unavailable", lang, 502);
  }
}

export async function DELETE(request: Request) {
  const user = await currentUser();
  const lang = requestLang(request, user?.lang);
  if (!user) return apiError("unauthenticated", lang, 401);
  const id = new URL(request.url).searchParams.get("id") ?? "";
  return deleteAudit(user.id, id) ? NextResponse.json({ ok: true }) : apiError("not_found", lang, 404);
}
