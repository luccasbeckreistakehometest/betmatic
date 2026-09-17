import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/server/session";
import { runRefresh } from "@/lib/server/refresh-job";
import { settlePending } from "@/lib/ledger/settle";
import { runLearning } from "@/lib/ledger/learn";
import { sendDailyDigest } from "@/lib/server/telegram";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The scheduler's entry point. `job` picks what runs:
 *   settle  — grade every finished game's tickets (ESPN only, no tokens); hourly
 *   digest  — "seus bilhetes de hoje" to Telegram subscribers; safe to call every tick, sends once a day
 *   learn   — post-mortem over the last 24h of settled tickets, proposes a prompt change; daily
 *   refresh — background generation (off unless CRON_ENABLED=1); every 4h
 * Protected by CRON_SECRET, or by an admin session for manual runs from the panel.
 */
export async function POST(request: Request) {
  const url = new URL(request.url);
  const secret = process.env.CRON_SECRET;
  const provided = request.headers.get("x-cron-secret") ?? url.searchParams.get("secret");
  const admin = await requireAdmin();
  if (!admin && (!secret || provided !== secret)) return NextResponse.json({ error: "não autorizado" }, { status: 401 });

  const job = url.searchParams.get("job") ?? "refresh";
  try {
    if (job === "settle") return NextResponse.json({ job, ...(await settlePending(500)) });
    if (job === "digest") {
      const date = url.searchParams.get("date") ?? undefined;
      return NextResponse.json({ job, ...(await sendDailyDigest({ dateKey: date, force: url.searchParams.get("force") === "1" || !!date })) });
    }
    if (job === "learn") {
      const hours = Number(url.searchParams.get("hours") ?? "24");
      return NextResponse.json({ job, run: await runLearning({ sinceHours: Number.isFinite(hours) ? hours : 24 }) });
    }
    const sports = (url.searchParams.get("sports") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    const maxGames = url.searchParams.get("maxGames") ? Number(url.searchParams.get("maxGames")) : undefined;
    return NextResponse.json({ job, ...(await runRefresh({ sports, maxGames: Number.isFinite(maxGames) ? maxGames : undefined })) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : `${job} failed` }, { status: 502 });
  }
}
