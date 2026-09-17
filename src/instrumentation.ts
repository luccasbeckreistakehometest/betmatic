/**
 * Startup checks. A production server without a real AUTH_SECRET refuses to start instead of
 * running with sessions it cannot sign; missing public URL or cron secret are logged loudly.
 * Skipped during `next build`, which runs without the server's .env.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NODE_ENV !== "production" || process.env.NEXT_PHASE === "phase-production-build") return;
  const env = process.env;
  if ((env.AUTH_SECRET ?? "").length < 16) {
    throw new Error("AUTH_SECRET is missing or too short — set a long random value (openssl rand -hex 32) before starting Betmatic.");
  }
  const warn = (message: string) => console.error(JSON.stringify({ ts: new Date().toISOString(), level: "error", scope: "startup", message }));
  if (!(env.APP_URL ?? "").startsWith("http") && !(env.NEXT_PUBLIC_BASE_URL ?? "").startsWith("http")) {
    warn("APP_URL / NEXT_PUBLIC_BASE_URL not set: checkout is disabled and share links fall back to the default domain.");
  }
  if (!env.CRON_SECRET) warn("CRON_SECRET not set: the scheduler cannot settle tickets or send digests.");
  if (env.TELEGRAM_BOT_TOKEN && !env.TELEGRAM_WEBHOOK_SECRET) warn("TELEGRAM_BOT_TOKEN set without TELEGRAM_WEBHOOK_SECRET: the Telegram webhook refuses updates.");
}
