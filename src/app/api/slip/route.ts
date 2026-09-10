import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/server/session";
import { adjustCoins, InsufficientCoinsError } from "@/lib/server/users";
import { getDb, newId, nowIso } from "@/lib/server/db";
import { analyseSlip } from "@/lib/bets/analyse";
import { ACTION_COST } from "@/lib/plans";
import { normaliseLang } from "@/lib/i18n";
import { describeAiError } from "@/lib/ai/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const schema = z.object({
  title: z.string().trim().default(""),
  lang: z.enum(["pt", "en"]).default("pt"),
  legs: z
    .array(z.object({ selection: z.string().trim().min(1), market: z.string().trim().default(""), odds: z.string().trim() }))
    .min(2, "Adicione ao menos duas pernas"),
});

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "não autenticado" }, { status: 401 });

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Dados inválidos" }, { status: 400 });
  }
  const { legs, title } = parsed.data;
  const lang = normaliseLang(parsed.data.lang);
  const cost = ACTION_COST.analyse_slip;

  // Debit first so a burst of parallel requests cannot spend the same coins twice; refunded below
  // if the model call fails, since the user got nothing for it.
  try {
    adjustCoins(user.id, -cost, "spend:analyse_slip", { legs: legs.length });
  } catch (error) {
    if (error instanceof InsufficientCoinsError) {
      return NextResponse.json({ error: error.message, needed: error.needed, balance: error.balance }, { status: 402 });
    }
    throw error;
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
    adjustCoins(user.id, cost, "refund:analyse_slip", { reason: "generation failed" });
    return NextResponse.json(
      { error: describeAiError(error) ?? (error instanceof Error ? error.message : "Falha na análise"), refunded: cost },
      { status: 502 },
    );
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
