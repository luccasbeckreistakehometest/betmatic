import { NextResponse } from "next/server";
import { runRefresh } from "@/lib/server/refresh-job";
import { requireAdmin } from "@/lib/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Triggered by a scheduler (cron, Vercel Cron, a systemd timer) every four hours, or manually by an
 * admin. Protected by a shared secret so it cannot be used to burn API credit from outside.
 */
export async function POST(request: Request) {
  const url = new URL(request.url);
  const secret = process.env.CRON_SECRET;
  const provided = request.headers.get("x-cron-secret") ?? url.searchParams.get("secret");
  const admin = await requireAdmin();

  if (!admin && (!secret || provided !== secret)) {
    return NextResponse.json({ error: "não autorizado" }, { status: 401 });
  }

  const sports = (url.searchParams.get("sports") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const maxGames = Number(url.searchParams.get("maxGames") ?? "8");

  try {
    const result = await runRefresh({ sports, maxGames: Number.isFinite(maxGames) ? maxGames : 8 });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "refresh failed" },
      { status: 502 },
    );
  }
}
