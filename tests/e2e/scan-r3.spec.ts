import { request as pwRequest, test, expect } from "@playwright/test";
import { registerUser, skipTour, withAiMock } from "./helpers";

withAiMock();

/** A made-up slip drawn on the fly (fictional teams, no real person's data), screenshotted to PNG. */
async function syntheticSlip(browser: import("@playwright/test").Browser): Promise<Buffer> {
  const page = await browser.newPage({ viewport: { width: 360, height: 420 } });
  await page.setContent(`<body style="font-family:sans-serif;background:#fff;padding:16px">
    <h3>Casa Exemplo — Múltipla</h3>
    <p>Tupi FC x Ipê EC<br><b>Tupi FC vence</b> — Resultado Final — 2,10</p>
    <p>Tupi FC x Ipê EC<br><b>Mais de 2,5 gols</b> — Total de gols — 1,95</p>
    <p>Valor da aposta: R$ 10,00<br>Odds totais: 4,10<br>Retorno potencial: R$ 41,00</p></body>`);
  const png = await page.screenshot();
  await page.close();
  return png;
}

test("manda o print: the slip is read, an odd is fixed, the bet is saved and graded by itself; the 4th free scan is capped", async ({ page, browser }) => {
  await registerUser(page, "scan");
  await skipTour(page);
  const png = await syntheticSlip(browser);

  await page.goto("/app/bankroll?lang=pt&sport=soccer-bra");
  await expect(page.getByTestId("slip-scanner")).toContainText("A imagem não fica guardada");
  await page.getByTestId("scan-input").setInputFiles({ name: "bilhete.png", mimeType: "image/png", buffer: png });
  const review = page.getByTestId("scan-review");
  await expect(review).toBeVisible({ timeout: 30_000 });
  await expect(review.getByTestId("scan-leg")).toHaveCount(2);
  await expect(review.getByTestId("scan-leg").first()).toContainText("liquidação automática");
  await expect(page.getByTestId("scan-checks").locator("[data-ok=false]")).toContainText("não bate com a odd total");

  await review.getByTestId("scan-leg-odds").nth(1).fill("1,95");
  await expect(page.getByTestId("scan-checks").locator("[data-ok=false]")).toHaveCount(0);
  await page.getByTestId("scan-save").click();
  await expect(page.getByTestId("scan-saved")).toBeVisible();

  const entry = page.getByTestId("bankroll-entry").filter({ hasText: "Casa Exemplo" });
  await expect(entry).toBeVisible();
  await expect(entry.getByTestId("auto-grade")).toHaveCount(2);

  // The settle job grades the finished game's legs without anyone marking them.
  const admin = await pwRequest.newContext({ baseURL: "http://localhost:3300" });
  expect((await admin.post("/api/auth/login", { data: { email: "admin@betmatic.app", password: "betmatic2026" } })).ok()).toBeTruthy();
  expect((await admin.post("/api/cron/refresh?job=settle")).ok()).toBeTruthy();
  await admin.dispose();
  const bank = await page.request.get("/api/bankroll").then((r) => r.json());
  const saved = bank.entries.find((e: { source: string }) => e.source === "scan");
  expect(saved.outcome).toBe("won");
  expect(saved.legs.map((l: { outcome: string }) => l.outcome)).toEqual(["won", "won"]);

  // Free plan: 3 prints a day.
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, ...new Array(64).fill(1)]);
  for (let i = 0; i < 2; i++) expect((await page.request.post("/api/slip/scan?sport=soccer-bra&lang=pt", { headers: { "content-type": "image/jpeg" }, data: jpeg })).status()).toBe(200);
  const fourth = await page.request.post("/api/slip/scan?sport=soccer-bra&lang=pt", { headers: { "content-type": "image/jpeg" }, data: jpeg });
  expect(fourth.status()).toBe(403);
  expect((await fourth.json()).message).toContain("todos os prints de hoje");
});
