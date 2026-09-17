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
import { apiError, rateLimited } from "@/lib/server/api";
import { accountKey, hit, ipKey } from "@/lib/server/rate-limit";
import { reportError } from "@/lib/server/ops-log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const schema = z.object({
  title: z.string().trim().max(120).default(""),
  lang: z.enum(["pt", "en"]).default("pt"),
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
  const { legs, title } = parsed.data;
  // The operator's own account is not billed for its own product.
  const cost = user.role === "admin" ? 0 : ACTION_COST.analyse_slip;

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

  try {
    const analysis = await analyseSlip(legs, lang);
    getDb()
      .prepare(
        `INSERT INTO user_slips (id,userId,title,legs,analysis,coinsSpent,createdAt,analysedAt)
         VALUES (?,?,?,?,?,?,?,?)`,
      )
      .run(newId("slip"), user.id, title, JSON.stringify(legs), JSON.stringify(analysis), cost, nowIso(), nowIso());

    return NextResponse.json({ analysis, coinsSpent: cost, balance: user.coins - cost });
  } catch (error) {
    if (cost > 0) adjustCoins(user.id, cost, "refund:analyse_slip", { reason: "generation failed" });
    reportError("ai.slip", error, { userId: user.id });
    const code = error instanceof AiBudgetExceededError ? "ai_budget" : "ai_unavailable";
    return apiError(code, lang, error instanceof AiNotConfiguredError ? 503 : 502, { refunded: cost });
  }
}

export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ slips: [] });
  const slips = getDb()
    .prepare("SELECT id,title,legs,analysis,coinsSpent,createdAt FROM user_slips WHERE userId = ? ORDER BY createdAt DESC LIMIT 20")
    .all(user.id);
  return NextResponse.json({ slips });
}
