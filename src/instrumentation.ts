import { startupProblems } from "@/lib/env";

/**
 * Startup checks. A production server without a real AUTH_SECRET — or with a secret that is really
 * a comment copied from .env.example — refuses to start instead of running with sessions anyone can
 * forge; a missing public URL or cron secret is logged loudly.
 * Skipped during `next build`, which runs without the server's .env.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NODE_ENV !== "production" || process.env.NEXT_PHASE === "phase-production-build") return;
  const { fatal, warnings } = startupProblems(process.env);
  for (const message of warnings) {
    console.error(JSON.stringify({ ts: new Date().toISOString(), level: "error", scope: "startup", message }));
  }
  if (fatal.length) throw new Error(`Betmatic refuses to start: ${fatal.join(" ")}`);
}
