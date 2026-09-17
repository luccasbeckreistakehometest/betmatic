import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/server/session";
import { readLedger } from "@/lib/ledger/store";
import { findBySlug } from "@/lib/ledger/proof";
import { userHasTicket } from "@/lib/server/bankroll";
import { cachedReview, getOrCreateReview, reviewForViewer, settledLegLines } from "@/lib/ledger/review";
import { aiConfigured } from "@/lib/ai/client";
import { AiBudgetExceededError } from "@/lib/server/ai-budget";
import { apiError, rateLimited } from "@/lib/server/api";
import { accountKey, hit } from "@/lib/server/rate-limit";
import { reportError } from "@/lib/server/ops-log";
import { scrubText } from "@/lib/server/whitelabel";
import { normaliseLang } from "@/lib/i18n";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * "Por que perdi?" for one settled lost ticket. Only the admin or someone who has the ticket in
 * their bankroll may ask — the explanation is about a bet they followed, not a public feature.
 * GET reads the cache; POST generates once (cheap model) and caches.
 */
async function resolve(request: Request) {
  const user = await currentUser();
  if (!user) return { error: NextResponse.json({ error: "não autorizado" }, { status: 401 }) };
  const url = new URL(request.url);
  const body = request.method === "POST" ? await request.json().catch(() => ({})) : {};
  const parsed = z.object({ slug: z.string().min(4).max(40), lang: z.enum(["pt", "en"]).nullable().default(null) }).safeParse({ slug: url.searchParams.get("slug") ?? body.slug, lang: url.searchParams.get("lang") ?? body.lang ?? null });
  if (!parsed.success) return { error: NextResponse.json({ error: "pedido inválido" }, { status: 400 }) };
  const entry = findBySlug(readLedger(), parsed.data.slug);
  if (!entry) return { error: NextResponse.json({ error: "bilhete não encontrado" }, { status: 404 }) };
  if (entry.outcome !== "lost") return { error: NextResponse.json({ error: "só bilhetes perdidos têm revisão" }, { status: 400 }) };
  const role = user.role === "admin" ? "admin" : "user";
  if (role !== "admin" && !userHasTicket(user.id, entry.id)) return { error: NextResponse.json({ error: "esse bilhete não está na sua banca" }, { status: 403 }) };
  const lang = normaliseLang(parsed.data.lang ?? user.lang);
  return { entry, role, lang, userId: user.id } as const;
}

const legsFor = (entry: NonNullable<Awaited<ReturnType<typeof resolve>>["entry"]>, role: "user" | "admin", lang: "pt" | "en") =>
  settledLegLines(entry, lang).map((l) => (role === "admin" ? l : scrubText(l, lang)));

export async function GET(request: Request) {
  const r = await resolve(request);
  if ("error" in r) return r.error;
  const hit = cachedReview(r.entry.id, r.lang);
  return NextResponse.json({ available: aiConfigured() || !!hit, cached: !!hit, review: hit ? reviewForViewer(hit.review, r.role, r.lang) : null, createdAt: hit?.createdAt ?? null, legs: legsFor(r.entry, r.role, r.lang) });
}

export async function POST(request: Request) {
  const r = await resolve(request);
  if ("error" in r) return r.error;
  const legs = legsFor(r.entry, r.role, r.lang);
  const cached = cachedReview(r.entry.id, r.lang);
  if (!cached) {
    const limit = hit("reviewAccount", accountKey(r.userId));
    if (!limit.ok) return rateLimited(limit, r.lang);
  }
  if (!aiConfigured() && !cachedReview(r.entry.id, r.lang)) return NextResponse.json({ available: false, cached: false, review: null, createdAt: null, legs });
  try {
    const out = await getOrCreateReview(r.entry, r.lang);
    return NextResponse.json({ available: true, cached: out.cached, review: reviewForViewer(out.review, r.role, r.lang), createdAt: out.createdAt, legs });
  } catch (error) {
    reportError("ai.review", error, { ledgerId: r.entry.id });
    return apiError(error instanceof AiBudgetExceededError ? "ai_budget" : "ai_unavailable", r.lang, 502, { legs });
  }
}
