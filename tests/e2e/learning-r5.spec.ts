import { test, expect, type Page } from "@playwright/test";
import { loginAdmin, withAiMock } from "./helpers";

/**
 * The closed loop, end to end, through the screens an operator actually uses.
 *
 * What it proves, in order: a finished game is read; what it found lands in a queue instead of in
 * the prompt; the operator sees the EXACT text as a diff before deciding; a rule the code can check
 * has no approve button at all; a refusal keeps its reason; and a click applies the very text that
 * was shown. The model is answered by fixtures (src/lib/ai/mocks.ts), so nothing is spent and the
 * same rewrite comes back every run.
 *
 * Serial on purpose: these are five steps of one flow over one database, not five independent
 * checks — refusing is what frees the idea for the next game to raise again, and approving is what
 * the day cap then has something to cap.
 */

withAiMock();
test.describe.configure({ mode: "serial" });

/** The queue is filled by the real jobs: blame and factors first, then the per-game post-mortem. */
async function readGame(page: Page, gameId: string) {
  const attribute = await page.request.post("/api/cron/refresh?job=attribute");
  expect(attribute.ok(), await attribute.text()).toBeTruthy();
  // 96000000..2 are seeded games with 110 settled tickets each and nothing pending (global-setup.ts)
  const learn = await page.request.post(`/api/cron/refresh?job=learn-game&gameId=${gameId}`);
  expect(learn.ok(), await learn.text()).toBeTruthy();
  return learn.json();
}

const queueOf = (page: Page) => page.request.get("/api/admin/proposals").then((r) => r.json());
const promptsOf = (page: Page) => page.request.get("/api/admin/prompts").then((r) => r.json());

test.beforeEach(async ({ page }) => {
  await loginAdmin(page);
});

test.afterAll(async ({ browser }) => {
  // The prompt goes back to the code default, so a spec file that runs after this one reads the
  // same prompt it always did.
  const page = await browser.newPage();
  await loginAdmin(page);
  await page.request.post("/api/admin/prompts/activate", { data: { kind: "game", reset: true } });
  await page.close();
});

test("a finished game fills the queue, and the prompt does not move", async ({ page }) => {
  const before = await promptsOf(page);
  const run = await readGame(page, "96000000");
  expect(run.games).toBeGreaterThan(0);

  const queue = await queueOf(page);
  expect(queue.minDecided).toBe(20);
  const pending = queue.queue.find((p: { status: string }) => p.status === "pending");
  expect(pending, "a proposal should be waiting for the operator").toBeTruthy();
  expect(pending.gameId).toBe("96000000");
  expect(pending.decided).toBeGreaterThanOrEqual(20);

  // reading it changed nothing
  const after = await promptsOf(page);
  expect(after.active.game.pt.version).toBe(before.active.game.pt.version);
  expect(after.active.game.pt.content).not.toContain("REGRA DO APRENDIZADO");
});

test("the operator reads the exact text as a diff, not a promise", async ({ page }) => {
  await page.goto("/admin");
  const row = page.getByTestId("proposal-row").filter({ hasText: "aguardando você" }).first();
  await expect(row).toBeVisible();
  await expect(row.getByTestId("proposal-sample")).toContainText("linha(s) decidida(s)");

  await row.getByTestId("proposal-diff-toggle").click();
  const diff = page.getByTestId("proposal-diff");
  await expect(diff).toBeVisible();
  await expect(diff).toContainText("REGRA DO APRENDIZADO");
});

test("a rule the code can check is a gate to build, with no approve button anywhere", async ({ page }) => {
  await page.goto("/admin");
  const gate = page.getByTestId("proposal-row").filter({ hasText: "portão de código" }).first();
  await expect(gate).toBeVisible();
  await expect(gate).toContainText("precisa de implementação, não de clique");
  await expect(gate.getByTestId("proposal-approve")).toHaveCount(0);

  // and the API refuses it too, so the missing button is a rule and not a decoration
  const queue = await queueOf(page);
  const row = queue.queue.find((p: { channel: string }) => p.channel === "code_gate");
  const out = await page.request.post("/api/admin/proposals", { data: { id: row.id, action: "approve" } });
  expect(out.status()).toBe(400);
  expect((await out.json()).error).toMatch(/portão de código/);
});

test("refusing needs a reason, and the reason is kept", async ({ page }) => {
  const queue = await queueOf(page);
  const pending = queue.queue.find((p: { status: string }) => p.status === "pending");
  const empty = await page.request.post("/api/admin/proposals", { data: { id: pending.id, action: "reject", reason: "  " } });
  expect(empty.status()).toBe(400);

  await page.goto("/admin");
  const row = page.getByTestId("proposal-row").filter({ hasText: "aguardando você" }).first();
  await row.getByTestId("proposal-reject").click();
  await row.getByTestId("proposal-reason").fill("esse mercado não é o nosso foco agora");
  await row.getByTestId("proposal-reject-confirm").click();

  await expect(page.getByTestId("proposal-row").filter({ hasText: "recusada" }).first())
    .toContainText("esse mercado não é o nosso foco agora");
  expect((await promptsOf(page)).active.game.pt.content).not.toContain("REGRA DO APRENDIZADO");
});

test("approving applies exactly the text that was shown, and the day cap closes behind it", async ({ page }) => {
  // the refusal freed the idea, so the next game can raise it again
  await readGame(page, "96000001");
  await page.goto("/admin");

  await page.getByTestId("proposal-row").filter({ hasText: "aguardando você" }).first().getByTestId("proposal-approve").click();
  await expect(page.getByTestId("queue-note")).toContainText("Acrescentei um parágrafo");

  const prompts = await promptsOf(page);
  expect(prompts.active.game.pt.version).toBe(1);
  expect(prompts.active.game.pt.content).toContain("REGRA DO APRENDIZADO");
  expect(prompts.active.game.en.content).toContain("LEARNED RULE");

  // the applied row carries its measurement, and the honest answer today is "not enough yet"
  await expect(page.getByTestId("proposal-measurement").first()).toContainText(/insuficiente|Ainda sem bilhetes/);
  // and the cap is on screen, so the operator knows why nothing else can go live today
  await expect(page.getByText(/teto é de uma por dia/)).toBeVisible();

  const queue = await queueOf(page);
  expect(queue.appliedToday).toBeTruthy();
  expect(queue.applied).toHaveLength(1);
});
