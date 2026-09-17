import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

const DIR = path.join(process.cwd(), "data", "unit-cron-route");
process.env.DATA_DIR = DIR;
process.env.AUTH_SECRET = "test-secret-that-is-long-enough";
process.env.CRON_SECRET = "unit-cron-secret";
fs.rmSync(DIR, { recursive: true, force: true });

const refresh = vi.fn(async () => ({ status: "ok" }));
const featured = vi.fn(async () => ({ status: "ok" }));
vi.mock("@/lib/server/session", () => ({ requireAdmin: async () => null }));
vi.mock("@/lib/server/refresh-job", () => ({ runRefresh: () => refresh() }));
vi.mock("@/lib/server/featured", () => ({ runFeatured: () => featured() }));

const { POST } = await import("@/app/api/cron/refresh/route");
const call = (query: string, secret = "unit-cron-secret") =>
  POST(new Request(`http://x/api/cron/refresh${query}`, { method: "POST", headers: { "x-cron-secret": secret } }));

describe("cron entry point", () => {
  it("refuses a wrong secret", async () => {
    expect((await call("?job=refresh", "nope")).status).toBe(401);
  });

  it("never falls through to generation on a mistyped or unknown job", async () => {
    const res = await call("?job=lineup");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "unknown job" });
    expect(refresh).not.toHaveBeenCalled();
    expect(featured).not.toHaveBeenCalled();
  });

  it("runs the refresh (and the featured floor) when asked, with or without the job name", async () => {
    expect((await call("?job=refresh")).status).toBe(200);
    expect((await call("")).status).toBe(200);
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(featured).toHaveBeenCalledTimes(2);
  });
});
