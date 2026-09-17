import path from "node:path";
import Database from "better-sqlite3";
import { test, expect } from "@playwright/test";
import { registerUser, skipTour, withAiMock } from "./helpers";

withAiMock();

const DB = path.join(process.cwd(), "data", "e2e", "betmatic.db");
const PASTED = `[16/09 10:02] Tipster: ENTRADA Tupi FC x Ipê EC — Tupi FC vence @2.10 1u
[16/09 15:31] Tipster: GREEN GARANTIDO! Mais de 2,5 gols no Tupi x Ipê ✅✅ ÚLTIMAS VAGAS no grupo VIP
[16/09 10:05] Tipster: Ipê EC vence @3.50 — green!
[16/09 10:07] Tipster: Palmeiras vence @1.90 ZX-e2e-raw-marker`;

test("tipster audit: pasted messages become a private report with the real record, then it is deleted", async ({ page }) => {
  await registerUser(page, "tipster");
  await skipTour(page);
  await page.goto("/app/tipster?lang=pt&sport=soccer-bra");
  await expect(page.getByTestId("tipster-privacy")).toContainText("o nome que você der fica só com você");
  await page.getByTestId("tipster-label").fill("Grupo do Zé e2e");
  await page.getByTestId("tipster-text").fill(PASTED);
  await page.getByTestId("tipster-sport").selectOption("soccer-bra");
  await page.getByTestId("tipster-run").click();

  const report = page.getByTestId("tipster-report").first();
  await expect(report).toBeVisible({ timeout: 60_000 });
  await expect(report).toContainText("palpites lidos");
  await expect(report).toContainText("75%");
  await expect(report.getByTestId("tipster-claimed")).toContainText("Ele disse que deu green em 4; conferindo, deram green 2.");
  await expect(report.getByTestId("tipster-late")).toContainText("1 palpite foi postado depois");
  await expect(report.getByTestId("tipster-flags")).toContainText("promete resultado garantido");
  await expect(report.getByTestId("tipster-flags")).toContainText("pressa: últimas vagas");
  await expect(page.getByTestId("tipster-audit").first()).toContainText("Grupo do Zé e2e");

  const share = await report.getByTestId("tipster-share-text").textContent();
  expect(share).toContain("Conferi 4 palpites");
  expect(share).not.toContain("Zé");
  expect(await report.getByTestId("tipster-share-wa").getAttribute("href")).not.toContain("Z%C3%A9");

  const db = new Database(DB, { readonly: true });
  const rows = JSON.stringify(db.prepare("SELECT * FROM tipster_audits").all());
  db.close();
  expect(rows).not.toContain("ZX-e2e-raw-marker");
  expect(rows).not.toContain("GREEN GARANTIDO");

  // The free month is used: the next one asks for coins.
  await page.getByTestId("tipster-text").fill(PASTED);
  await page.getByTestId("tipster-run").click();
  await expect(page.getByTestId("tipster-pay")).toContainText("6 coins");

  await report.getByTestId("tipster-delete").click();
  await expect(page.getByTestId("tipster-audit")).toHaveCount(0);
  await expect(page.getByText("Você ainda não fez nenhum raio-x.")).toBeVisible();
});
