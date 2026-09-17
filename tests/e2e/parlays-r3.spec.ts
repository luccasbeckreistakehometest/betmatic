import path from "node:path";
import Database from "better-sqlite3";
import { test, expect } from "@playwright/test";
import { registerUser, setPlan, skipTour, withAiMock } from "./helpers";

withAiMock();

const slateRows = () => {
  const db = new Database(path.join(process.cwd(), "data", "e2e", "betmatic.db"), { readonly: true });
  try { return (db.prepare("SELECT COUNT(*) n FROM generation_requests WHERE scope='slate'").get() as { n: number }).n; } finally { db.close(); }
};

test("cross-game parlays are built on request for Pro, once a day, with the real chance beside 100x", async ({ page }) => {
  await registerUser(page, "free");
  expect((await page.request.post("/api/parlays/generate?sport=wnba")).status()).toBe(403);

  const { email } = await registerUser(page, "slate");
  await setPlan(email, "pro");
  await skipTour(page);
  await page.goto("/app/parlays?sport=wnba&lang=pt");
  await page.getByTestId("build-slate").click();
  await expect(page.getByTestId("expected-losers").first()).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("expected-losers").first()).toContainText("em 100 bilhetes assim, espere perder ~");
  await expect(page.getByText(/1\d\dx|[2-4]\d\dx/).first()).toBeVisible();
  expect(slateRows()).toBe(1);

  const again = await page.request.post("/api/parlays/generate?sport=wnba").then((r) => r.json());
  expect(again.status).toBe("exists");
  expect(slateRows()).toBe(1);
});
