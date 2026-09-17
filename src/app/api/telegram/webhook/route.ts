import { NextResponse } from "next/server";
import { handleTelegramUpdate, telegramConfigured, type TelegramUpdate } from "@/lib/server/telegram";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Telegram's webhook. Point the bot here with setWebhook(url, secret_token=TELEGRAM_WEBHOOK_SECRET).
 * Always answers 200 once the secret checks out: an error body would only make Telegram retry the
 * same update forever.
 */
export async function POST(request: Request) {
  if (!telegramConfigured()) return NextResponse.json({ ok: false, error: "telegram off" }, { status: 404 });
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (secret && request.headers.get("x-telegram-bot-api-secret-token") !== secret) return NextResponse.json({ ok: false }, { status: 401 });
  const update = (await request.json().catch(() => ({}))) as TelegramUpdate;
  try {
    return NextResponse.json({ ok: true, ...(await handleTelegramUpdate(update)) });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "failed" });
  }
}
