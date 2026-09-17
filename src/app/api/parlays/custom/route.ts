import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/server/session";
import { adjustCoins, InsufficientCoinsError } from "@/lib/server/users";
import { getDb, newId, nowIso } from "@/lib/server/db";
import { pauseState } from "@/lib/server/settings";
import { apiError, rateLimited } from "@/lib/server/api";
import { accountKey, hit, ipKey } from "@/lib/server/rate-limit";
import { reportError } from "@/lib/server/ops-log";
import { readCache, writeCache } from "@/lib/cache";
import { ACTION_COST } from "@/lib/plans";
import { aiConfigured } from "@/lib/ai/client";
import { buildLegPool } from "@/lib/server/leg-pool";
import { CUSTOM_LIMITS, solveCustomParlay } from "@/lib/bets/custom-parlay";
import { explainCustomTickets, templateCustomTickets, type CustomTicketView } from "@/lib/bets/custom-writeup";
import { SOLD_SPORTS } from "@/lib/sports";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const schema = z.object({
  sport: z.string().max(20),
  lang: z.enum(["pt", "en"]).default("pt"),
  target: z.number().min(CUSTOM_LIMITS.minTarget).max(CUSTOM_LIMITS.maxTarget),
  maxLegs: z.number().int().min(CUSTOM_LIMITS.minLegs).max(CUSTOM_LIMITS.maxLegs),
  markets: z.array(z.string().max(40)).max(30).default([]),
  excludeMarkets: z.array(z.string().max(40)).max(30).default([]),
  gameIds: z.array(z.string().regex(/^[\w-]{1,40}$/)).max(12).default([]),
  measuredOnly: z.boolean().default(true),
  minRate: z.number().min(0).max(0.95).default(0.55),
});

interface Cached { reachable: boolean; nearest: number | null; reason: string; tickets: CustomTicketView[]; aiWritten: boolean }

/**
 * Múltipla sob medida: the solver picks legs deterministically, a cheap model writes the prose.
 * Coins are debited first and given back when the target cannot be reached or anything fails; the
 * same constraints within 15 minutes reuse the computed result (still personal work: still charged).
 */
export async function POST(request: Request) {
  const user = await currentUser();
  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  const lang = parsed.success ? parsed.data.lang : "pt";
  if (!user) return apiError("unauthenticated", lang, 401);
  if (pauseState(user.id).paused) return apiError("paused", lang, 423);
  if (!parsed.success || !SOLD_SPORTS.some((s) => s.key === parsed.data.sport)) return apiError("invalid_input", lang, 400);
  const acct = hit("slipAccount", accountKey(user.id));
  if (!acct.ok) return rateLimited(acct, lang);
  const ip = hit("aiIp", ipKey(request));
  if (!ip.ok) return rateLimited(ip, lang);

  const c = parsed.data;
  const withAi = aiConfigured();
  const price = user.role === "admin" ? 0 : withAi ? ACTION_COST.custom_parlay : ACTION_COST.custom_parlay_basic;
  const reason = withAi ? "spend:custom_parlay" : "spend:custom_parlay_basic";
  if (price > 0) {
    try {
      adjustCoins(user.id, -price, reason, { sport: c.sport, target: c.target });
    } catch (error) {
      if (error instanceof InsufficientCoinsError) return apiError("insufficient_coins", lang, 402, { needed: error.needed, balance: error.balance });
      throw error;
    }
  }
  let charged = price;
  const refund = (amount: number, why: string) => {
    if (amount > 0) adjustCoins(user.id, amount, "refund:custom_parlay", { reason: why });
    charged -= amount;
  };

  try {
    const paid = user.role === "admin" || user.plan.id !== "free";
    const hash = createHash("sha1").update(JSON.stringify({ ...c, paid, withAi })).digest("hex").slice(0, 16);
    const cacheKey = `custom-parlay-${hash}`;
    let result = readCache<Cached>(cacheKey, 15 * 60_000);
    const cachedHit = !!result;
    if (!result) {
      const { pool, dateKey } = await buildLegPool(c.sport, { lang, includeTicketLegs: paid });
      const solved = solveCustomParlay(pool, c);
      if (!solved.reachable) {
        result = { reachable: false, nearest: solved.nearest, reason: solved.reason, tickets: [], aiWritten: false };
      } else {
        let tickets: CustomTicketView[];
        let aiWritten = false;
        if (withAi) {
          try {
            tickets = await explainCustomTickets(solved.tickets, lang);
            aiWritten = true;
          } catch (error) {
            reportError("ai.custom_parlay", error, { userId: user.id }, "warn");
            tickets = templateCustomTickets(solved.tickets, lang);
          }
        } else {
          tickets = templateCustomTickets(solved.tickets, lang);
        }
        result = { reachable: true, nearest: solved.nearest, reason: "ok", tickets, aiWritten };
        void dateKey;
      }
      writeCache(cacheKey, result);
    }

    if (!result.reachable) {
      refund(charged, "unreachable");
      return NextResponse.json({ ...result, coinsSpent: 0, refunded: price, balance: user.coins });
    }
    // The prose fell back to the template: charge the template price.
    if (withAi && !result.aiWritten && charged > ACTION_COST.custom_parlay_basic) refund(charged - ACTION_COST.custom_parlay_basic, "template");

    const slipId = newId("slip");
    getDb().prepare("INSERT INTO user_slips (id,userId,title,legs,analysis,coinsSpent,createdAt,analysedAt,kind) VALUES (?,?,?,?,?,?,?,?,?)")
      .run(slipId, user.id, `${c.target}x`, JSON.stringify(c), JSON.stringify(result.tickets), charged, nowIso(), nowIso(), "custom");
    return NextResponse.json({ ...result, slipId, cached: cachedHit, coinsSpent: charged, balance: user.coins - charged });
  } catch (error) {
    refund(charged, "failure");
    reportError("custom_parlay", error, { userId: user.id });
    return apiError("ai_unavailable", lang, 502, { refunded: price });
  }
}

/** What the form needs: the price with and without the AI write-up, and the markets on offer. */
export async function GET(request: Request) {
  const user = await currentUser();
  const sportKey = new URL(request.url).searchParams.get("sport") ?? "";
  const sport = SOLD_SPORTS.find((s) => s.key === sportKey);
  if (!sport) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const markets = [
    { key: "moneyline", label: { pt: "Vencedor", en: "Moneyline" } },
    { key: "total", label: { pt: sport.group === "soccer" ? "Total de gols" : "Total de pontos", en: "Game total" } },
    ...sport.markets.filter((m) => m.statLabels.length && m.key !== "minutes").map((m) => ({ key: m.key, label: m.label })),
  ];
  return NextResponse.json({
    signedIn: !!user,
    coins: user?.coins ?? 0,
    price: user?.role === "admin" ? 0 : aiConfigured() ? ACTION_COST.custom_parlay : ACTION_COST.custom_parlay_basic,
    aiReady: aiConfigured(),
    markets,
    limits: CUSTOM_LIMITS,
  });
}
