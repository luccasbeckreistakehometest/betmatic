import path from "node:path";
import Database from "better-sqlite3";
import { test, expect, type APIRequestContext } from "@playwright/test";

/**
 * The in-play round, driven through the running app: the route, the job, the per-book status and
 * the store. No bookmaker is contacted — BR_BOOKS_OFFLINE makes every adapter request throw before
 * it leaves the machine (playwright.config.ts) — so what is proved here is the wiring and the one
 * rule the whole round exists for: an in-play price and a pre-game price never become one number.
 */
const DB = path.join(process.cwd(), "data", "e2e", "betmatic.db");
const query = <T>(sql: string, ...args: unknown[]): T => {
  const db = new Database(DB, { readonly: true });
  try { return db.prepare(sql).get(...(args as never[])) as T; } finally { db.close(); }
};

async function adminApi(request: APIRequestContext): Promise<APIRequestContext> {
  const res = await request.post("/api/auth/login", { data: { email: "admin@betmatic.app", password: "betmatic2026" } });
  expect(res.ok(), await res.text()).toBeTruthy();
  return request;
}

test("the panel says which books serve an in-play board, and which wall is why one does not", async ({ request }) => {
  const api = await adminApi(request);
  const body = await api.get("/api/admin/books").then((r) => r.json());

  const byId = new Map<string, { servesLive: boolean; liveCoverage: string | null; liveLastStatus: string }>(
    body.adapters.map((a: { id: string; servesLive: boolean; liveCoverage: string | null; liveLastStatus: string }) => [a.id, a]),
  );
  // Proved live on 24/09/2026 against each book's own public in-play endpoint.
  for (const id of ["superbet", "kambi:kto", "altenar:estrelabet", "altenar:apostaganha", "altenar:betpix365", "altenar:lotogreen", "altenar:vaidebet"]) {
    expect(byId.get(id)?.servesLive, id).toBe(true);
    expect(byId.get(id)?.liveCoverage, id).toContain("ao vivo");
  }
  // Answered 403 to a plain client, so no in-play feed is attempted and none is claimed.
  for (const id of ["sportingbet", "betfair-exchange", "betnacional"]) {
    expect(byId.get(id)?.servesLive, id).toBe(false);
    expect(byId.get(id)?.liveCoverage, id).toBeNull();
  }
  expect(body.skipped.find((s: { book: string }) => s.book === "Betnacional")?.reason).toContain("Cloudflare");
  // The freshness window is stated, because it is what separates "the price now" from a memory.
  expect(body.config.livePriceMaxAgeMs).toBe(90_000);
  expect(body.config.liveAdapterTimeoutMs).toBeLessThan(body.config.adapterTimeoutMs);
});

test("the in-play round runs on demand, reads nobody it was not told to, and writes no price it could not read", async ({ request }) => {
  const api = await adminApi(request);
  const before = query<{ n: number }>("SELECT COUNT(*) n FROM book_prices WHERE inPlay = 1").n;

  // BR_BOOKS is unset in the test world, so the honest answer is that nobody is enabled.
  const off = await api.post("/api/admin/books", { data: { action: "run-live" } }).then((r) => r.json());
  expect(off.status).toBe("skipped");
  expect(off.note).toContain("in-play feed");
  expect(off.rows).toBe(0);

  // Enabled by hand, with the network closed: the round still runs, and says per book what happened.
  await api.post("/api/admin/books", { data: { action: "toggle", id: "superbet", enabled: true } });
  const run = await api.post("/api/admin/books", { data: { action: "run-live", sports: ["wnba"] } });
  const result = await run.json();
  expect(["ok", "error", "skipped"]).toContain(result.status);
  if (result.status !== "skipped") {
    expect(result.adapters.map((a: { id: string }) => a.id)).toEqual(["superbet"]);
    // A book that could not be read wrote nothing. It never writes a price it did not receive.
    expect(result.rows).toBe(0);
  }
  await api.post("/api/admin/books", { data: { action: "toggle", id: "superbet", enabled: null } });

  expect(query<{ n: number }>("SELECT COUNT(*) n FROM book_prices WHERE inPlay = 1").n).toBe(before);
  // The in-play health of a book is recorded apart from its pre-game health.
  const status = query<{ lastStatus: string; liveLastStatus: string } | undefined>("SELECT lastStatus, liveLastStatus FROM book_adapter_status WHERE id = 'superbet'");
  if (status) expect(status.liveLastStatus).not.toBe("");
});

test("/prova promises a return only where the price was takeable", async ({ page }) => {
  await page.goto("/prova?lang=pt");
  const block = page.getByTestId("proof-live");
  await expect(block).toBeVisible();
  // The old sentence promised no live return under any circumstance. It cannot say that any more,
  // and it must not say the opposite either: the promise is conditional and names the condition.
  await expect(block).toContainText("O retorno só entra quando o preço era pegável");
  await expect(block).toContainText("no 3º quarto ele já não existe");
  await expect(block).not.toContainText("Não publicamos retorno das leituras ao vivo.");
  // Every seeded live read was priced off the pre-game board, so the takeable row is not there to
  // be shown — and the reference row still carries counts and no ROI.
  const scope = page.locator("div").filter({ hasText: /^Por origem/ }).first();
  await expect(scope).toContainText("Ao vivo (preço de referência)");
  await expect(scope).not.toContainText("Ao vivo (preço ao vivo)");
});
