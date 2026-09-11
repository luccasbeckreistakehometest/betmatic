/**
 * Reads the real Criar Aposta price for a set of same-game legs.
 *
 * Multiplying leg odds is only valid for independent legs. Every leg in a single fixture is
 * correlated, and Betano's bet builder prices that correlation in: "Sevilha vence" (1.95) with
 * "Sevilha mais de 1.5 gols" (2.15) multiplies to 4.19 and is actually quoted at 2.45 — 42% lower.
 * A ticket priced by multiplication is a price that cannot be taken.
 */
import { withPersistentContext, acceptCookies } from "@/lib/browser/persistent";
import type { Page } from "playwright";

export interface Leg {
  market: string;
  label: RegExp;
  tab?: "Todos" | "Jogadores";
  /** Player markets render as a grid of rows, not a .selections list, so they need the name. */
  player?: string;
}

async function gotoTab(p: Page, tab: string) {
  await p.locator("a,button,div,span").filter({ hasText: new RegExp(`^${tab}$`) }).last().click({ force: true }).catch(() => {});
  await p.waitForTimeout(3500);
}

/**
 * Player markets are a dynamic-table grid keyed by .row-title__text, not the .selections list the
 * team markets use. Clicking them needs the player's row first, then the cell for the threshold.
 */
async function clickPlayerLeg(p: Page, leg: Leg): Promise<string | null> {
  const blocks = p.locator(".markets > div");
  const n = await blocks.count();
  for (let i = 0; i < n; i++) {
    const lines = (await blocks.nth(i).innerText().catch(() => "")).split("\n").map((s) => s.trim());
    const name = lines.filter((s) => s && s !== "CA" && s !== "NOVO")[0] ?? "";
    if (name !== leg.market) continue;
    const blk = blocks.nth(i);
    await blk.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {});
    // Player blocks render no rows until opened, and their header is not always .tw-cursor-pointer.
    for (let attempt = 0; attempt < 3; attempt++) {
      if (await blk.locator(".row-title__text").count()) break;
      const bb = await blk.boundingBox();
      if (bb) await p.mouse.click(bb.x + bb.width / 2, bb.y + 18);
      await p.waitForTimeout(1800);
    }
    // Expand so players below the fold are reachable.
    for (let r = 0; r < 4; r++) {
      const lm = blk.locator("button.load-more");
      if (!(await lm.count())) break;
      await lm.first().click({ force: true, timeout: 3000 }).catch(() => {});
      await p.waitForTimeout(700);
    }
    // Geometry, not DOM traversal: find the row's vertical band from the player's name, then the
    // cell whose label matches and whose centre sits in that band. The grid nests inconsistently,
    // so walking up from the name to a shared ancestor is unreliable; coordinates are not.
    // The click itself must be a real Playwright click — synthetic MouseEvents do not reach the
    // framework's handler and leave the slip empty while appearing to succeed.
    const box = await blk.evaluate((root, args: { player: string; label: string }) => {
      const titles = [...root.querySelectorAll(".row-title__text")];
      const t = titles.find((e) => (e.textContent || "").trim() === args.player);
      if (!t) return null;
      const rb = t.getBoundingClientRect();
      const re = new RegExp(args.label);
      const hit = [...root.querySelectorAll("*")].find((e) => {
        if (e.children.length) return false;
        if (!re.test((e.textContent || "").trim())) return false;
        const b = e.getBoundingClientRect();
        return b.height > 0 && Math.abs((b.top + b.height / 2) - (rb.top + rb.height / 2)) < 26;
      });
      if (!hit) return null;
      const cell = (hit.closest("[class*='selection'],[class*='odd'],button,a") ?? hit.parentElement ?? hit) as HTMLElement;
      const b = cell.getBoundingClientRect();
      return { x: b.x + b.width / 2, y: b.y + b.height / 2, text: (cell.textContent || "").replace(/\s+/g, " ").trim().slice(0, 24) };
    }, { player: leg.player ?? "", label: leg.label.source });
    if (!box) return null;
    await p.mouse.click(box.x, box.y);
    const clicked = `${leg.player} ${box.text}`;
    return clicked;
  }
  return null;
}

async function clickLeg(p: Page, leg: Leg): Promise<string | null> {
  if (leg.player) return clickPlayerLeg(p, leg);
  const blocks = p.locator(".markets > div");
  const n = await blocks.count();
  for (let i = 0; i < n; i++) {
    const lines = (await blocks.nth(i).innerText().catch(() => "")).split("\n").map((s) => s.trim());
    const name = lines.filter((s) => s && s !== "CA" && s !== "NOVO")[0] ?? "";
    if (name !== leg.market) continue;
    const blk = blocks.nth(i);
    await blk.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {});
    if (!(await blk.locator(".selections").count())) {
      await blk.locator(".tw-cursor-pointer").first().click({ force: true }).catch(() => {});
      await p.waitForTimeout(1600);
    }
    const cells = blk.locator(".selections > * > *");
    const cn = await cells.count();
    for (let c = 0; c < cn; c++) {
      const t = (await cells.nth(c).innerText().catch(() => "")).replace(/\n/g, " ").trim();
      if (leg.label.test(t)) { await cells.nth(c).click({ force: true }).catch(() => {}); return t; }
    }
    return null;
  }
  return null;
}

/** The slip header carries "Criar Aposta | n/13 | <price>" once two or more legs are on it. */
async function readSlip(p: Page): Promise<{ legs: number; price: number | null; raw: string }> {
  const raw = await p.evaluate(`(() => {
    const t = document.body.innerText; const i = t.indexOf("Cupom de Apostas");
    return i < 0 ? "" : t.slice(i, i + 420);
  })()`) as string;
  const lines = raw.split("\n").map((s) => s.trim()).filter(Boolean);
  const count = lines.find((l) => /^\d+\/\d+$/.test(l));
  const legs = count ? Number(count.split("/")[0]) : 0;
  // First decimal after the "Criar Aposta" marker is the combined price.
  const idx = lines.findIndex((l) => /Criar Aposta/i.test(l));
  const price = idx >= 0 ? Number(lines.slice(idx).find((l) => /^\d+\.\d{2}$/.test(l))) : null;
  return { legs, price: Number.isFinite(price as number) ? (price as number) : null, raw: lines.slice(0, 14).join(" | ") };
}

async function clearSlip(p: Page) {
  const trash = p.locator("[class*='trash'], button").filter({ hasText: "" }).first();
  await p.evaluate(`(() => {
    const els = [...document.querySelectorAll("svg,button,div")];
    const t = els.find((e) => (e.getAttribute("class")||"").includes("trash") || (e.getAttribute("data-testid")||"").includes("delete"));
    if (t) (t.closest("button") || t).dispatchEvent(new MouseEvent("click", { bubbles: true }));
  })()`).catch(() => {});
  await p.waitForTimeout(1500);
  void trash;
}

export async function priceTickets(tickets: { name: string; legs: Leg[] }[]) {
  return withPersistentContext("betano", async (ctx) => {
    const p = (ctx.pages()[0] ?? (await ctx.newPage())) as Page;
    await p.setViewportSize({ width: 1600, height: 1100 });
    await p.goto("https://www.betano.bet.br/odds/sevilha-fc-valencia/criar-aposta/88312157/", { waitUntil: "domcontentloaded", timeout: 90000 });
    await p.waitForTimeout(6000);
    await acceptCookies(p);
    await p.waitForTimeout(2000);

    const out: { name: string; price: number | null; legs: string[]; product: number | null }[] = [];
    for (const t of tickets) {
      await clearSlip(p);
      await gotoTab(p, "Todos");
      const clicked: string[] = [];
      const odds: number[] = [];
      for (const leg of t.legs) {
        if (leg.tab === "Jogadores") await gotoTab(p, "Jogadores");
        else await gotoTab(p, "Todos");
        const got = await clickLeg(p, leg);
        await p.waitForTimeout(1800);
        if (got) {
          clicked.push(got);
          const m = got.match(/(\d+\.\d{2})\s*$/);
          if (m) odds.push(Number(m[1]));
        }
      }
      await p.waitForTimeout(2500);
      const slip = await readSlip(p);
      const product = odds.length === t.legs.length ? odds.reduce((a, b) => a * b, 1) : null;
      out.push({ name: t.name, price: slip.price, legs: clicked, product });
      console.log(`\n${t.name}`);
      console.log(`  pernas: ${clicked.join("  |  ") || "(nenhuma clicada)"}`);
      console.log(`  produto das pernas: ${product ? product.toFixed(2) : "—"}  |  PREÇO REAL DO CRIAR APOSTA: ${slip.price ?? "—"}`);
      if (product && slip.price) console.log(`  diferença: ${(((slip.price / product) - 1) * 100).toFixed(0)}%`);
    }
    return out;
  }, { headless: false });
}

if (process.argv[1]?.includes("price-ticket")) {
  await priceTickets([
    { name: "Sevilha vence + Mais de 2,5 gols", legs: [
      { market: "Resultado Final", label: /^1[\s\d.]/ },
      { market: "Total de Gols", label: /Mais de 2[.,]5/ },
    ] },
    { name: "Sevilha vence + Valencia menos de 1,5", legs: [
      { market: "Resultado Final", label: /^1[\s\d.]/ },
      { market: "Valencia - Total de Gols", label: /Menos de 1[.,]5/ },
    ] },
    { name: "Sevilha vence + Mais 2,5 + Valencia menos 1,5", legs: [
      { market: "Resultado Final", label: /^1[\s\d.]/ },
      { market: "Total de Gols", label: /Mais de 2[.,]5/ },
      { market: "Valencia - Total de Gols", label: /Menos de 1[.,]5/ },
    ] },
  ]);
}
