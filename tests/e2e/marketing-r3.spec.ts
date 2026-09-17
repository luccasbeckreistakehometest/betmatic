import { test, expect } from "@playwright/test";
import { registerUser, skipTour } from "./helpers";

test("landing, funnels and plans speak about what exists now", async ({ page }) => {
  await page.goto("/?lang=pt");
  const edge = page.getByTestId("edge");
  await expect(edge).toContainText("Se a escalação mudar, seu bilhete avisa");
  await expect(edge).toContainText("Manda o print, a gente confere");
  await expect(edge.getByRole("link", { name: /raio-x/ })).toHaveAttribute("href", /\/raio-x-tipster/);
  await expect(page.locator("#como li")).toHaveCount(4);
  await expect(page.locator("#planos")).toContainText("Raio-x de 1 jogador por dia");
  await expect(page.locator("#planos")).toContainText("Análise profunda do seu bilhete pelo preço normal");
  await expect(page.locator("body")).not.toContainText(/lucro garantido|aposte agora|últimas vagas/i);

  await page.goto("/?lang=en");
  await expect(page.getByTestId("edge")).toContainText("Your slip watches the lineup for you");
  expect(await page.locator("#planos").innerText()).not.toMatch(/(^|[^R])\$\d/);

  await page.goto("/futebol");
  await expect(page.locator("h1")).toContainText("Escalação confirmada muda tudo");
  await page.goto("/basquete");
  await expect(page.locator("h1")).toContainText("Odd e minutagem em cada perna de jogador");

  await page.goto("/raio-x-tipster");
  const funnel = page.getByTestId("tipster-funnel");
  await expect(funnel).toContainText("Seu tipster mostra só os greens?");
  await expect(funnel).toContainText(/nome do tipster nunca aparece/i);
  await expect(page.getByTestId("tipster-funnel-cta")).toHaveAttribute("href", /\/signup\?lang=pt&next=%2Fapp%2Ftipster/);
  await page.goto("/tipster-audit");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByTestId("tipster-funnel")).toContainText("Your tipster only shows the wins?");

  await page.goto("/ferramentas?lang=pt");
  await expect(page.getByTestId("tools-more")).toContainText("Manda o print do seu bilhete");

  const sitemap = await page.request.get("/sitemap.xml").then((r) => r.text());
  expect(sitemap).toContain("/raio-x-tipster");
});

test("the app shows what's new once, and the privacy notice covers prints and measurement", async ({ page }) => {
  await registerUser(page, "novo");
  await skipTour(page);
  await page.goto("/app?sport=wnba&lang=pt");
  const strip = page.getByTestId("whats-new");
  await expect(strip).toContainText("Manda o print");
  await expect(strip).toContainText("Raio-x do tipster");
  await page.getByTestId("whats-new-close").click();
  await expect(strip).toBeHidden();
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByTestId("whats-new")).toHaveCount(0);

  await page.goto("/privacidade");
  await expect(page.locator("main")).toContainText("a imagem é lida na hora e descartada");
  await expect(page.locator("main")).toContainText("Não guardamos IP");
  await page.goto("/cookies");
  await expect(page.locator("main")).toContainText("bm_aid");
});
