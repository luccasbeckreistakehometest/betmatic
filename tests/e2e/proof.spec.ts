import { test, expect } from "@playwright/test";
import { loginAdmin } from "./helpers";

test("public track record shows every ticket, and each has a shareable permalink", async ({ page }) => {
  await page.goto("/prova?lang=pt");
  const stats = page.getByTestId("proof-stats");
  // 5 pre-game + 12 live reads; the two pre-game tickets that are still private are counted too.
  await expect(stats).toContainText("17");
  // 1 won / 2 decided PRE-GAME tickets, in pt-BR numerals: the live reads have no price to pay, so
  // they carry no unit, no return and no ROI — only the block below measures them.
  await expect(stats).toContainText(/50,0\s*%/);
  const list = page.getByTestId("proof-list");
  // Three seeded pre-game tickets are public, plus whatever live read an earlier spec took on the
  // game under way: live tickets count in the record since 22/09/2026, tagged as such.
  const liveRows = await list.getByTestId("proof-live-tag").count();
  await expect(list.locator("tbody tr")).toHaveCount(3 + liveRows);
  if (liveRows) await expect(list.getByTestId("proof-live-tag").first()).toContainText("ao vivo");
  await expect(list).toContainText(/ganhou/);
  await expect(list).toContainText(/perdeu/);
  await expect(list).toContainText(/pendente/); // the game under way
  await expect(list).not.toContainText("Sevilha não perde"); // no kickoff time, not graded yet
  await expect(list).not.toContainText("Betis em casa"); // kickoff still ahead
  await list.getByRole("link").first().click();
  await expect(page).toHaveURL(/\/p\/[0-9a-f]{10}/);
  await expect(page.getByTestId("ticket-page")).toContainText(/GANHOU|PERDEU|PENDENTE/);
  const share = page.getByTestId("share-wa");
  await expect(share).toHaveAttribute("href", /wa\.me\/\?text=/);
  // the link unfurls as a result card: Next hashes the image URL, so read it off the page itself
  const ogUrl = await page.locator('meta[property="og:image"]').getAttribute("content");
  expect(ogUrl).toMatch(/\/opengraph-image/);
  const og = await page.request.get(ogUrl!);
  expect(og.ok()).toBeTruthy();
  expect(og.headers()["content-type"]).toContain("image/png");
});

test("the live reads are measured against their own chance, and never paid a price", async ({ page }) => {
  await page.goto("/prova?lang=pt");
  const block = page.getByTestId("proof-live");
  // Promised roughly 86%, landed 3 of 6: the headline says both numbers and the verdict.
  await expect(block.getByTestId("proof-live-headline")).toContainText("12 leituras decididas, 4 acertaram");
  await expect(block).toContainText("Chance média que demos");
  await expect(block).toContainText("Acertos esperados");
  await expect(block).toContainText("Faixa esperada (95%)");
  await expect(block).toContainText("abaixo do esperado");
  await expect(block.getByTestId("proof-live-buckets")).toContainText("Linhas");
  await expect(block.getByTestId("proof-live-quarters")).toBeVisible();
  await expect(block.getByTestId("proof-live-foot")).toContainText("Não publicamos retorno das leituras ao vivo.");
  // No money anywhere in it, at any depth.
  await expect(block).not.toContainText("ROI");
  await expect(block).not.toContainText("retorno de referência");
  await expect(block).not.toContainText(/\d+,\d+u/);
  // And the balance beside it says out loud that its units are pre-game units.
  await expect(page.getByTestId("proof-balance")).toContainText("Balanço (pré-jogo)");
  // The whole page speaks the new vocabulary and not one word of the old one.
  await expect(page.locator("body")).not.toContainText(/\bpernas?\b/i);
});

test("track record never names a source for visitors", async ({ page }) => {
  const html = await page.request.get("/prova?lang=pt").then((r) => r.text());
  expect(html).not.toMatch(/Betano|ESPN|DraftKings/);
});

test("free calculators work without an account", async ({ page }) => {
  await page.goto("/ferramentas?lang=pt");
  await page.getByTestId("ev-odds").fill("2.10");
  await page.getByTestId("ev-prob").fill("52");
  await expect(page.getByTestId("ev-result")).toContainText(/\+9,2\s*%/);
  await page.getByTestId("leg-0").fill("2.00");
  await page.getByTestId("leg-1").fill("2.00");
  await page.getByTestId("leg-2").fill("2.00");
  await expect(page.getByTestId("parlay-result")).toContainText("8,00");
  await page.getByTestId("conv-dec").fill("1.50");
  await expect(page.getByTestId("conv-result")).toContainText("-200");
});

test("bankroll: saved tickets inherit the ledger's grading; outside bets are graded by hand", async ({ page }) => {
  await loginAdmin(page);
  // a generated ticket saved with a stake
  const add = await page.request.post("/api/bankroll", { data: { kind: "ticket", gameId: "401882878", bandKey: "value", selections: ["Sevilha FC vence"], stake: 100 } });
  expect(add.ok()).toBeTruthy();
  const missing = await page.request.post("/api/bankroll", { data: { kind: "ticket", gameId: "401882878", bandKey: "value", selections: ["não existe"], stake: 10 } });
  expect(missing.status()).toBe(404);
  await page.goto("/app/bankroll?lang=pt");
  await expect(page.getByTestId("bankroll-entry")).toHaveCount(1);
  await expect(page.getByTestId("bankroll-totals")).toContainText(/\+R\$\s*100,00/); // won at 2.00 with 100
  // an outside bet, graded by the user
  await page.getByTestId("manual-title").fill("Flamengo vence @ outra casa");
  await page.getByTestId("manual-odds").fill("1.80");
  await page.getByTestId("manual-stake").fill("50");
  await page.getByTestId("manual-add").click();
  await expect(page.getByTestId("bankroll-entry")).toHaveCount(2);
  await page.getByTestId("bankroll-entry").filter({ hasText: "Flamengo" }).getByRole("button", { name: /perdeu/i }).click();
  await expect(page.getByTestId("bankroll-totals")).toContainText(/\+R\$\s*50,00/); // 100 - 50
});

test("sitemap and robots exist for search engines", async ({ page }) => {
  const sm = await page.request.get("/sitemap.xml");
  expect(sm.ok()).toBeTruthy();
  expect(await sm.text()).toContain("/prova");
  const rb = await page.request.get("/robots.txt");
  expect(await rb.text()).toContain("Disallow: /app");
});

test("the whole record downloads as a whitelabelled CSV", async ({ page }) => {
  const r = await page.request.get("/api/public/ledger?lang=pt");
  expect(r.headers()["content-type"]).toContain("text/csv");
  const csv = await r.text();
  const lines = csv.split("\n");
  // header + 3 seeded pre-game tickets + the live reads taken by earlier specs, each marked in the scope column
  const liveLines = lines.filter((l) => /,"live( q\d+)?",/.test(l)).length;
  expect(lines).toHaveLength(4 + liveLines);
  expect(lines[0]).toContain("scope");
  expect(csv).toContain("Sevilha vence em casa");
  expect(csv).toContain("/p/");
  expect(csv).not.toMatch(/Betano|ESPN/);
});
