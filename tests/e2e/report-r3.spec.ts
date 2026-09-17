import { test, expect } from "@playwright/test";
import { registerUser, skipTour } from "./helpers";

test("weekly report: a bigger stake right after a loss is flagged, and the self-exclusion help is always there", async ({ page }) => {
  await registerUser(page, "report");
  await skipTour(page);
  const add = async (stake: number) => {
    const r = await page.request.post("/api/bankroll", { data: { kind: "manual", title: `Aposta ${stake}`, odds: 2, stake } });
    expect(r.ok(), await r.text()).toBeTruthy();
    return (await r.json()).entry.id as string;
  };
  const first = await add(10);
  expect((await page.request.patch("/api/bankroll", { data: { id: first, outcome: "lost" } })).ok()).toBeTruthy();
  await add(25);

  await page.goto("/app/report?lang=pt");
  await expect(page.getByTestId("report-chasing")).toContainText("1 vez você apostou pelo menos 1,5× o valor anterior");
  await expect(page.getByTestId("weekly-report").first()).toContainText("Retorno · 7 dias");
  const help = page.getByTestId("report-help");
  await expect(help.getByTestId("self-exclusion")).toContainText("Plataforma Centralizada de Autoexclusão");
  await expect(help.getByRole("link", { name: "Plataforma Centralizada de Autoexclusão" })).toHaveAttribute("href", "https://autoexclusaoapostas.fazenda.gov.br");
  await expect(help).toContainText("188");
  await expect(page.getByTestId("report-pause")).toHaveAttribute("href", /\/app\/settings/);
  await expect(page.getByText(/aumente|recupere/i)).toHaveCount(0);

  await page.goto("/app/report?lang=en");
  await expect(page.getByTestId("report-chasing")).toContainText("Once you staked at least 1.5×");
});
