import path from "node:path";
import Database from "better-sqlite3";
import { test, expect } from "@playwright/test";
import { registerUser, setPlan, skipTour, withAiMock } from "./helpers";

withAiMock();

const GAME = "/app/game/990000102?sport=wnba&lang=pt";
const DB = path.join(process.cwd(), "data", "e2e", "betmatic.db");
const rows = <T>(sql: string): T[] => {
  const db = new Database(DB, { readonly: true });
  try { return db.prepare(sql).all() as T[]; } finally { db.close(); }
};

/**
 * The quarter read walks ESPN's narration inside the live read, on the real request path. Nothing
 * of it is visible to a reader — it goes to the model, and the model is mocked here — so what this
 * spec holds is the two things that are visible from outside: the read still comes back with the
 * narration walk in the path, and the walk refuses the boundary it has no business claiming.
 *
 * The game under way sits 4:48 into its third quarter. That instant is the end of nothing: the
 * second quarter's box score is long gone and the third is half played. A row filed there would say
 * "this is how the game stood at the end of Q2", which would be false, so no row is written.
 */
test("the quarter read runs inside the live read, and files no boundary it cannot stand behind", async ({ page }) => {
  const { email } = await registerUser(page, "quarters");
  await setPlan(email, "pro");
  await skipTour(page);

  await page.goto(GAME);
  await expect(page.getByTestId("live-panel")).toBeVisible({ timeout: 30_000 });
  // Asked for through the API rather than the button, because the live read is shared: another spec
  // in the same run may already have taken this game's, and then there is no button to press. Fresh
  // or cached, the answer must be a read — and a throw in the narration walk would land here.
  const out = await page.evaluate(async () => {
    const res = await fetch(document.querySelector("[data-live-url]")?.getAttribute("data-live-url") ?? "", { method: "POST" });
    return { status: res.status, body: await res.json() };
  });
  expect(out.status, JSON.stringify(out.body)).toBe(200);
  expect(out.body.read?.slate?.suggestions?.length ?? 0).toBeGreaterThan(0);
  await expect(page.getByTestId("live-read-ticket").first()).toBeVisible({ timeout: 60_000 });
  expect(rows("SELECT status FROM generation_requests WHERE scope='live' AND gameId='990000102'")).toEqual([{ status: "ok" }]);

  // Still nothing filed: mid-quarter is the end of no quarter, and the table would rather be empty
  // than hold a box score under the wrong buzzer.
  expect(rows("SELECT * FROM live_read_snapshots WHERE gameId='990000102'")).toHaveLength(0);
});
