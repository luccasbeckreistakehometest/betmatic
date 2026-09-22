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
const books = vi.fn(async (opts: unknown) => ({ status: "ok", rows: 0, opts }));
vi.mock("@/lib/server/session", () => ({ requireAdmin: async () => null }));
vi.mock("@/lib/server/refresh-job", () => ({ runRefresh: () => refresh() }));
vi.mock("@/lib/server/featured", () => ({ runFeatured: () => featured() }));
vi.mock("@/lib/server/book-prices", () => ({ runBooksJob: (o: unknown) => books(o) }));

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

  it("runs the books job on its own, never the generation", async () => {
    const res = await call("?job=books&sports=wnba");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ job: "books", status: "ok" });
    expect(books).toHaveBeenCalledWith({ sports: ["wnba"] });
    expect(refresh).not.toHaveBeenCalled();
  });

  it("runs the refresh (and the featured floor) when asked, with or without the job name", async () => {
    expect((await call("?job=refresh")).status).toBe(200);
    expect((await call("")).status).toBe(200);
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(featured).toHaveBeenCalledTimes(2);
  });
});

describe("the quarters job", () => {
  it("runs on its own and steps aside when switched off, never touching generation", async () => {
    process.env.LIVE_QUARTER_READS = "0";
    try {
      const res = await call("?job=quarters");
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ job: "quarters", status: "skipped", note: "LIVE_QUARTER_READS=0" });
    } finally {
      delete process.env.LIVE_QUARTER_READS;
    }
  });
});

