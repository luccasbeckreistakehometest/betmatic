import { test, expect } from "@playwright/test";
import { closeTicket, openTicket, registerUser, setPlan, skipTour, withAiMock } from "./helpers";

withAiMock();

/**
 * The two rules the 23/09/2026 learning run moved out of the prompt and into code (src/lib/bets/
 * gates.ts), read off the page the reader actually sees rather than off a unit fixture.
 *
 * Both used to be prose the model was asked to keep, and both were broken in production: one slate
 * put Isabelle Harrison in 10 of its 15 tickets and all ten lost, and Kayla McBride's lines went out
 * on a night she finished with 0 points, 0 rebounds and 0 assists.
 *
 * The file is named to sort after tickets-r3: the suite runs on one worker, in file order, and the
 * specs before this one count how many tickets the world has generated so far. Reading a game page
 * builds its slate, so arriving first would move their numbers.
 */
test("a game slate never leans on one player, and every player leg carries the line it was measured at", async ({ page }) => {
  const { email } = await registerUser(page, "gates");
  await setPlan(email, "pro");
  await skipTour(page);

  await page.goto("/app/game/990000101?sport=wnba&lang=pt");
  const tickets = page.getByTestId("ticket");
  await expect(tickets.first()).toBeVisible({ timeout: 60_000 });

  // The legs and their measured records live in each ticket's sheet now, so the walk opens every
  // card the way a reader does and reads the sheet it opens.
  const shown: { players: string[]; legs: { player: boolean; measured: boolean }[] }[] = [];
  const total = await tickets.count();
  for (let i = 0; i < total; i += 1) {
    const sheet = await openTicket(page, i);
    shown.push(
      await sheet.getByTestId("ticket-detail-lines").evaluate((ol) => ({
        // Counted by player, not by leg: two lines on one player are one bet on one night.
        players: [...new Set([...ol.querySelectorAll('[data-testid="leg-player-link"]')].map((a) => new URL((a as HTMLAnchorElement).href).pathname))],
        // Every leg row, and whether the ones naming a player also show the measured record.
        legs: [...ol.querySelectorAll(":scope > li")].map((li) => ({
          player: !!li.querySelector('[data-testid="leg-player-link"]'),
          measured: !!li.querySelector('[data-testid="leg-measured"]'),
        })),
      })),
    );
    await closeTicket(page);
  }
  expect(shown.length).toBeGreaterThan(1);

  const seen = new Map<string, number>();
  for (const ticket of shown) for (const p of ticket.players) seen.set(p, (seen.get(p) ?? 0) + 1);
  const worst = [...seen.entries()].sort((a, b) => b[1] - a[1])[0];
  expect(worst, "the slate has at least one player leg").toBeTruthy();
  expect(worst[1], `${worst[0]} carries ${worst[1]} of the ${shown.length} tickets on screen`).toBeLessThanOrEqual(Math.floor(shown.length / 2));

  // A player leg with no candidate row behind it has no minutes, no fitted rate and no measured
  // record: the gate keeps it out, so nothing on screen names a player without showing her history.
  for (const ticket of shown) for (const leg of ticket.legs) if (leg.player) expect(leg.measured).toBe(true);
});
