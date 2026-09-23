import path from "node:path";
import Database from "better-sqlite3";
import { test, expect } from "@playwright/test";
import { registerUser, skipTour } from "./helpers";

const DB = path.join(process.cwd(), "data", "e2e", "betmatic.db");
const LEDGER_ID = "401882878:value:Sevilha FC vence";

function seed(n: number) {
  const db = new Database(DB);
  const now = new Date().toISOString();
  const stmt = db.prepare(`INSERT OR REPLACE INTO leg_prices (ledgerId, legIndex, gameId, sportKey, startsAt, kind, marketKey, side, line, takenDecimal, closeDecimal, closeFair, clvPct, basis, status, createdAt, updatedAt)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  for (let i = 0; i < n; i++) {
    const total = i % 2 === 0;
    stmt.run(LEDGER_ID, 100 + i, "401882878", "soccer-esp", "2026-09-11T19:00:00.000Z", total ? "total" : "ml", total ? "total" : "moneyline", total ? "over" : "home", total ? 2.5 : null, 2.05, 1.95, 0.5, i % 5 === 0 ? -0.01 : 0.025, "novig", "closed", now, now);
  }
  stmt.run(LEDGER_ID, 199, "401882878", "soccer-esp", "2026-09-11T19:00:00.000Z", "total", "total", "over", 2.5, 1.9, null, null, null, null, "line_moved", now, now);
  db.close();
}

function clear() {
  const db = new Database(DB);
  db.prepare("DELETE FROM leg_prices WHERE ledgerId = ? AND legIndex >= 100").run(LEDGER_ID);
  db.close();
}

test.afterAll(clear);

test("/prova hides CLV under 30 legs and shows the block once the sample is there", async ({ page }) => {
  seed(10);
  await page.goto("/prova?lang=pt");
  await expect(page.getByTestId("clv-block")).toContainText("O mercado concordou com a gente?");
  await expect(page.getByTestId("clv-small")).toContainText("Amostra pequena: 10 linhas com fechamento");
  seed(30);
  await page.reload();
  const block = page.getByTestId("clv-block");
  await expect(block).toContainText("CLV médio");
  await expect(block).toContainText(/\+1,8\s*%/);
  await expect(block).toContainText(/80\s*%/);
  await expect(page.getByTestId("clv-markets")).toContainText("total do jogo");
  await expect(block).toContainText("1 linha teve o número alterado");
  await page.goto("/prova?lang=en");
  await expect(page.getByTestId("clv-block")).toContainText("Did the market agree with us?");
});

test("the game page shows how the line moved since the open", async ({ page }) => {
  await registerUser(page, "clvfree");
  await skipTour(page);
  await page.goto("/app/game/990000103?sport=wnba&lang=pt");
  const moved = page.getByTestId("line-movement");
  await expect(moved).toContainText("Movimento desde a abertura");
  await expect(moved).toContainText("→");
});
