import { describe, expect, it } from "vitest";
import { envValue, startupProblems, validSecret } from "@/lib/env";

const good = { AUTH_SECRET: "a".repeat(64), CRON_SECRET: "b".repeat(48), ADMIN_EMAIL: "owner@example.com", ADMIN_PASSWORD: "a-long-password", APP_URL: "https://betmatic.example" };

describe("env hygiene", () => {
  it("treats a value that is really a comment as unset", () => {
    expect(envValue("MP_ACCESS_TOKEN", { MP_ACCESS_TOKEN: "# production access token; checkout is disabled while empty" })).toBe("");
    expect(envValue("MP_ACCESS_TOKEN", { MP_ACCESS_TOKEN: "  APP_USR-123  " })).toBe("APP_USR-123");
    expect(envValue("MISSING", {})).toBe("");
  });
  it("rejects a secret that is a comment, has spaces or is short", () => {
    expect(validSecret("# openssl rand -hex 32 (the app refuses to sign sessions without it)")).toBe(false);
    expect(validSecret("sixteen chars with spaces")).toBe(false);
    expect(validSecret("short")).toBe(false);
    expect(validSecret("f".repeat(64))).toBe(true);
  });
  it("refuses to start on the blank .env.example lines docker compose turns into text", () => {
    expect(startupProblems(good).fatal).toEqual([]);
    const fromExample = startupProblems({ ...good, AUTH_SECRET: "# openssl rand -hex 32 (the app refuses to sign sessions without it)" });
    expect(fromExample.fatal.join(" ")).toMatch(/AUTH_SECRET/);
    for (const key of ["CRON_SECRET", "ADMIN_PASSWORD", "ADMIN_EMAIL", "MP_ACCESS_TOKEN"]) {
      expect(startupProblems({ ...good, [key]: "# a note" }).fatal.join(" ")).toContain(key);
    }
    expect(startupProblems({ ...good, AUTH_SECRET: undefined }).fatal).toHaveLength(1);
  });
  it("warns about what only degrades the product", () => {
    const w = startupProblems({ AUTH_SECRET: good.AUTH_SECRET }).warnings.join(" ");
    expect(w).toMatch(/APP_URL/);
    expect(w).toMatch(/CRON_SECRET/);
    expect(startupProblems({ ...good, TELEGRAM_BOT_TOKEN: "123:abc" }).warnings.join(" ")).toMatch(/TELEGRAM_WEBHOOK_SECRET/);
    expect(startupProblems({ ...good, AI_PROVIDER: "openai" }).warnings.join(" ")).toMatch(/OPENAI_API_KEY/);
    expect(startupProblems({ ...good, AI_PROVIDER: "openai", OPENAI_API_KEY: "sk-proj-abc" }).warnings.join(" ")).not.toMatch(/OPENAI_API_KEY/);
    expect(startupProblems(good).warnings.join(" ")).not.toMatch(/OPENAI_API_KEY/);
  });
});
