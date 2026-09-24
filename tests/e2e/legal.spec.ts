import { test, expect } from "@playwright/test";
import { loginAdmin } from "./helpers";

const PAGES = [
  ["/termos", "legal-terms", "Termos de uso", "pt-BR"],
  ["/terms", "legal-terms", "Terms of use", "en"],
  ["/privacidade", "legal-privacy", "LGPD", "pt-BR"],
  ["/privacy", "legal-privacy", "LGPD", "en"],
  ["/reembolso", "legal-refunds", "art. 49", "pt-BR"],
  ["/refunds", "legal-refunds", "art. 49", "en"],
  ["/cookies", "legal-cookies", "betmatic_session", "pt-BR"],
  ["/cookies?lang=en", "legal-cookies", "betmatic_session", "en"],
  ["/jogo-responsavel", "legal-responsible", "188", "pt-BR"],
  ["/responsible-gambling", "legal-responsible", "1-800-MY-RESET", "en"],
] as const;

test("every legal page renders in its language, names no invented company data and links back to contact", async ({ page }) => {
  for (const [path, testId, text, lang] of PAGES) {
    const r = await page.goto(path);
    expect(r?.status(), path).toBe(200);
    await expect(page.getByTestId(testId)).toContainText(text);
    expect(await page.locator("html").getAttribute("lang"), path).toBe(lang);
    expect(await page.locator('link[rel="canonical"]').count(), path).toBe(1);
  }
  await page.goto("/privacidade");
  const body = await page.getByTestId("legal-privacy").innerText();
  expect(body).toContain("Anthropic");
  expect(body).toContain("Mercado Pago");
  expect(body).not.toMatch(/CNPJ: |CPF\/CNPJ: /); // LEGAL_DOCUMENT is blank in the suite
  await expect(page.getByTestId("legal-privacy").getByRole("link", { name: "formulário de contato" }).first()).toBeVisible();
});

test("footers link the legal pages, signup shows the consent checkbox, and support channels appear only when set", async ({ page }) => {
  for (const path of ["/?lang=pt", "/prova", "/futebol", "/planos", "/app?sport=soccer-esp&date=20260911&lang=pt"]) {
    await page.goto(path);
    const footer = page.locator("footer").last();
    await expect(footer.getByRole("link", { name: /Termos de uso/ })).toBeVisible();
    await expect(footer.getByRole("link", { name: /Privacidade/ })).toBeVisible();
    await expect(footer.getByRole("link", { name: /Jogo responsável/ })).toBeVisible();
  }
  await page.goto("/");
  await expect(page.getByTestId("support-channels")).toContainText("ajuda@betmatic.test");
  await expect(page.getByTestId("support-channels")).not.toContainText("WhatsApp");

  await page.goto("/signup?lang=pt");
  await expect(page.getByTestId("auth-submit")).toBeDisabled();
  await page.getByTestId("auth-consent").check();
  await expect(page.getByTestId("auth-submit")).toBeEnabled();
});

test("the contact form lands in the admin inbox with a status", async ({ page, context }) => {
  const marker = `mensagem-e2e-${Date.now()}`;
  await page.goto("/contato?lang=pt&topic=refund");
  await expect(page.getByTestId("contact-topic")).toHaveValue("refund");
  await page.getByTestId("contact-name").fill("Cliente");
  await page.getByTestId("contact-email").fill("cliente@example.com");
  await page.getByTestId("contact-message").fill(`Quero o reembolso. ${marker}`);
  await page.getByTestId("contact-submit").click();
  await expect(page.getByTestId("contact-sent")).toBeVisible();
  const short = await page.request.post("/api/contact", { data: { email: "a@example.com", message: "oi" } });
  expect(short.status()).toBe(400);

  await context.clearCookies();
  await loginAdmin(page);
  await page.goto("/admin");
  const inbox = page.getByTestId("admin-inbox");
  await expect(inbox).toContainText(marker);
  // Wait for the PATCH the select fires. Without this the assertion below races it and loses every
  // time: the test's own request goes straight out over HTTP while the browser is still inside the
  // React handler, so it reads the inbox from before the status changed.
  const patched = page.waitForResponse((r) => r.url().includes("/api/admin/contact") && r.request().method() === "PATCH");
  await inbox.locator("li", { hasText: marker }).getByRole("combobox", { name: "Status" }).selectOption("answered");
  expect((await patched).ok()).toBeTruthy();
  const answered = await page.request.get("/api/admin/contact?status=answered").then((r) => r.json());
  expect(answered.messages.some((m: { message: string }) => m.message.includes(marker))).toBe(true);
});

test("error pages are branded and localized", async ({ page }) => {
  const r = await page.goto("/pagina-que-nao-existe");
  expect(r?.status()).toBe(404);
  await expect(page.getByTestId("not-found")).toContainText("Esta página não existe");
  await expect(page.getByTestId("not-found").getByRole("link", { name: "Falar com a gente" })).toBeVisible();
  await page.goto("/pagina-que-nao-existe?lang=en");
  await expect(page.getByTestId("not-found")).toContainText("This page doesn't exist");
});
