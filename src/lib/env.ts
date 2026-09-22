/**
 * Reading configuration safely. docker compose's env_file keeps everything after `=` — so a line
 * like `AUTH_SECRET=   # openssl rand -hex 32` becomes the value "# openssl rand -hex 32", which is
 * long enough to pass a length check and is published in the repo. Values that are really comments
 * count as unset everywhere, and secrets that look like one stop the server at startup.
 */
type Env = Record<string, string | undefined>;

export function envValue(name: string, env: Env = process.env): string {
  const v = (env[name] ?? "").trim();
  return v.startsWith("#") ? "" : v;
}

/** A value someone meant to leave blank but that carries a comment or spaces. */
const looksLikeComment = (raw: string | undefined) => {
  const v = (raw ?? "").trim();
  return v.startsWith("#") || /\s/.test(v);
};

/** A usable signing secret: long, one token, not a comment. */
export function validSecret(raw: string | undefined, minLength = 16): boolean {
  const v = (raw ?? "").trim();
  return v.length >= minLength && !looksLikeComment(v);
}

/**
 * What a production server must refuse to start with (`fatal`) and what it should shout about
 * (`warnings`). Pure, so the rules are unit-tested.
 */
/** Every configured base URL is a plain-http localhost address, and at least one is configured. */
function localhostOnly(env: Env): boolean {
  const urls = [envValue("APP_URL", env), envValue("NEXT_PUBLIC_BASE_URL", env)].filter(Boolean);
  return urls.length > 0 && urls.every((u) => /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(u));
}

export function startupProblems(env: Env): { fatal: string[]; warnings: string[] } {
  const fatal: string[] = [];
  const warnings: string[] = [];
  if (!validSecret(env.AUTH_SECRET)) {
    fatal.push("AUTH_SECRET is missing, too short or a comment — set a long random value (openssl rand -hex 32).");
  }
  for (const key of ["CRON_SECRET", "ADMIN_EMAIL", "ADMIN_PASSWORD", "MP_ACCESS_TOKEN", "MP_WEBHOOK_SECRET", "TELEGRAM_WEBHOOK_SECRET"]) {
    if ((env[key] ?? "").trim() && looksLikeComment(env[key])) {
      fatal.push(`${key} holds a comment or spaces instead of a value — put comments on their own line in .env.`);
    }
  }
  // Test switches must never reach a real server: they replace the model and ESPN with fixtures.
  // The one exception is the e2e suite run against a production build (playwright.prod.config.ts),
  // which has to say so AND can only be pointing at localhost — the flag beside a public URL is
  // still a refusal, so a copied .env cannot open the door on a real server.
  const e2eBuild = envValue("E2E_PRODUCTION_BUILD", env) === "1" && localhostOnly(env);
  for (const key of ["AI_MOCK", "ESPN_FIXTURES", "ANALYTICS_ALLOW_HEADLESS"]) {
    if ((env[key] ?? "").trim() && !e2eBuild) fatal.push(`${key} is a test switch and must not be set in production.`);
  }
  const password = envValue("ADMIN_PASSWORD", env);
  if (password && password.length < 12) warnings.push("ADMIN_PASSWORD is shorter than 12 characters.");
  const base = [envValue("APP_URL", env), envValue("NEXT_PUBLIC_BASE_URL", env)];
  if (!base.some((v) => v.startsWith("http"))) {
    warnings.push("APP_URL / NEXT_PUBLIC_BASE_URL not set: checkout is disabled and share links fall back to the default domain.");
  }
  if (!envValue("CRON_SECRET", env)) warnings.push("CRON_SECRET not set: the scheduler cannot settle tickets or send digests.");
  // Kept as a plain string test on purpose: lib/ai must not be pulled into the startup path.
  if (envValue("AI_PROVIDER", env).toLowerCase() === "openai" && !envValue("OPENAI_API_KEY", env)) {
    warnings.push("AI_PROVIDER=openai but OPENAI_API_KEY is not set: every model call will fail and no tickets will be generated.");
  }
  if (envValue("TELEGRAM_BOT_TOKEN", env) && !envValue("TELEGRAM_WEBHOOK_SECRET", env)) {
    warnings.push("TELEGRAM_BOT_TOKEN set without TELEGRAM_WEBHOOK_SECRET: the Telegram webhook refuses updates.");
  }
  return { fatal, warnings };
}
