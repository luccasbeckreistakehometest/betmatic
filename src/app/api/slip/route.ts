import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/server/session";
import { adjustCoins, InsufficientCoinsError } from "@/lib/server/users";
import { getDb, newId, nowIso } from "@/lib/server/db";
import { analyseSlip } from "@/lib/bets/analyse";
import { ACTION_COST } from "@/lib/plans";
import { normaliseLang } from "@/lib/i18n";
import { AiNotConfiguredError } from "@/lib/ai/client";
import { AiBudgetExceededError } from "@/lib/server/ai-budget";
import { apiError, apiMessage, rateLimited } from "@/lib/server/api";
import { accountKey, hit, ipKey } from "@/lib/server/rate-limit";
import { reportError } from "@/lib/server/ops-log";
import { pauseState } from "@/lib/server/settings";
import { buildDeepContext, deepPrompt, type DeepContext } from "@/lib/server/deep-slip";
import { SOLD_SPORTS } from "@/lib/sports";
import { slipPrice } from "@/lib/server/slip-pricing";
import { recordRouteEvent } from "@/lib/server/analytics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const schema = z.object({
  title: z.string().trim().max(120).default(""),
  lang: z.enum(["pt", "en"]).default("pt"),
  /** Deep analysis: legs matched to the sport's upcoming games and checked against the numbers first. */
  deep: z.boolean().default(false),
  sport: z.string().max(20).optional(),
  legs: z
    .array(z.object({ selection: z.string().trim().min(1).max(160), market: z.string().trim().max(60).default(""), odds: z.string().trim().max(12) }))
    .min(2, "Adicione ao menos duas pernas")
    .max(12),
});

export async function POST(request: Request) {
  const user = await currentUser();
  const body = await request.json().catch(() => null);
  const lang = normaliseLang((body as { lang?: string } | null)?.lang ?? user?.lang);
  if (!user) return apiError("unauthenticated", lang, 401);
  const limit = hit("slipAccount", accountKey(user.id));
  if (!limit.ok) return rateLimited(limit, lang);
  const ipLimit = hit("aiIp", ipKey(request));
  if (!ipLimit.ok) return rateLimited(ipLimit, lang);

  const parsed = schema.safeParse(body);
  if (!parsed.success) return apiError("invalid_input", lang, 400);
  const { legs, title, deep } = parsed.data;
  if (deep && !SOLD_SPORTS.some((s) => s.key === parsed.data.sport)) return apiError("invalid_input", lang, 400);
  if (pauseState(user.id).paused) return apiError("paused", lang, 423);
  // The operator's own account is not billed for its own product.
  const cost = slipPrice(user, deep);

  // Debit first so a burst of parallel requests cannot spend the same coins twice; refunded below
  // if the model call fails, since the user got nothing for it.
  if (cost > 0) {
    try {
      adjustCoins(user.id, -cost, "spend:analyse_slip", { legs: legs.length });
    } catch (error) {
      if (error instanceof InsufficientCoinsError) {
        return apiError("insufficient_coins", lang, 402, { needed: error.needed, balance: error.balance });
      }
      throw error;
    }
  }

  // Steps A and B are deterministic: whatever happens to the verdict, the checked numbers are shown.
  let context: DeepContext | null = null;
  if (deep) {
    try {
      context = await buildDeepContext(parsed.data.sport!, legs, lang);
    } catch (error) {
      reportError("slip.deep_context", error, { userId: user.id }, "warn");
    }
  }

  try {
    const analysis = await analyseSlip(legs, lang, context ? { context: deepPrompt(context) } : {});
    getDb()
      .prepare(
        `INSERT INTO user_slips (id,userId,title,legs,analysis,coinsSpent,createdAt,analysedAt,kind)
         VALUES (?,?,?,?,?,?,?,?,?)`,
      )
      .run(newId("slip"), user.id, title, JSON.stringify(legs), JSON.stringify({ ...analysis, deep: context }), cost, nowIso(), nowIso(), deep ? "deep" : "analysis");

    if (deep) await recordRouteEvent("deep_slip_done", user.id, { coins: cost, resolved: context?.resolved ?? 0 });
    return NextResponse.json({ analysis, deep: context, coinsSpent: cost, balance: user.coins - cost });
  } catch (error) {
    if (context) {
      // The verdict failed: the enrichment is still worth showing, and the coins go back.
      if (cost > 0) adjustCoins(user.id, cost, "refund:analyse_slip", { reason: "verdict failed" });
      reportError("ai.slip", error, { userId: user.id, deep: true });
      return NextResponse.json({ analysis: null, deep: context, coinsSpent: 0, refunded: cost, balance: user.coins, message: apiMessage("ai_unavailable", lang) });
    }
    if (cost > 0) adjustCoins(user.id, cost, "refund:analyse_slip", { reason: "generation failed" });
    reportError("ai.slip", error, { userId: user.id });
    const code = error instanceof AiBudgetExceededError ? "ai_budget" : "ai_unavailable";
    return apiError(code, lang, error instanceof AiNotConfiguredError ? 503 : 502, { refunded: cost });
  }
}

export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ slips: [], pricing: { normal: ACTION_COST.analyse_slip, deep: ACTION_COST.deep_slip, deepIncluded: false } });
  const slips = getDb()
    .prepare("SELECT id,title,legs,analysis,coinsSpent,createdAt FROM user_slips WHERE userId = ? ORDER BY createdAt DESC LIMIT 20")
    .all(user.id);
  return NextResponse.json({ slips, pricing: { normal: slipPrice(user, false), deep: slipPrice(user, true), deepIncluded: user.plan.id === "max" || user.role === "admin" }, coins: user.coins });
}
