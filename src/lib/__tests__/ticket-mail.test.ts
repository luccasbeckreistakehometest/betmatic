import { describe, expect, it } from "vitest";
import { renderTicketMail, ticketMailConfig } from "@/lib/server/ticket-mail";

const t = (title: string, combinedDecimal: number, legs: [string, number][], alternative = false) =>
  ({ title, combinedDecimal, alternative, legs: legs.map(([selection, oddsDecimal]) => ({ selection, oddsDecimal })) });

// The operators asked for the running picture of a game by mail: every pre-game ticket first, then
// every live read with its quarter — name, lines and price, nothing else.
describe("the ticket mail", () => {
  it("lists every pre-game ticket, then every live read in order, marking what is new", () => {
    const mail = renderTicketMail({
      matchup: "Connecticut Sun @ Washington Mystics", sportKey: "wnba", lang: "pt",
      fresh: { kind: "live", period: 2, minute: 18 },
      pre: [t("Lacan acima de 14,5", 1.48, [["Leila Lacan PRA over 14.5", 1.48]]), t("Plano B", 1.5, [["x", 1.5]], true)],
      live: [{ period: 1, minute: 7, tickets: [t("Q1", 3.2, [["a", 1.8], ["b", 1.78]])] }, { period: 2, minute: 18, tickets: [t("Q2", 5.1, [["c", 2.1], ["d", 2.4]])] }],
    });
    expect(mail.subject).toBe("[Betmatic] Connecticut Sun @ Washington Mystics — novo: 2º quarto");
    const text = mail.text;
    expect(text.indexOf("PRÉ-JOGO")).toBeLessThan(text.indexOf("AO VIVO"));
    expect(text).toContain("Lacan acima de 14,5 — 1,48x\n  - Leila Lacan PRA over 14.5 @ 1,48");
    expect(text).toContain("Plano B (alternativa) — 1,50x");
    expect(text.indexOf("— 1º quarto · minuto 7")).toBeLessThan(text.indexOf("— 2º quarto · minuto 18 (NOVO)"));
    expect(text).not.toContain("1º quarto · minuto 7 (NOVO)");
    expect(mail.html).toContain("<pre");
  });
  it("marks the pre-game slate as new when that is what came out, and says when nothing is live yet", () => {
    const mail = renderTicketMail({ matchup: "A @ B", sportKey: "wnba", lang: "pt", fresh: { kind: "pre" }, pre: [t("Único", 2, [["l", 2]])], live: [] });
    expect(mail.subject).toContain("novo: pré-jogo");
    expect(mail.text).toContain("PRÉ-JOGO (NOVO)");
    expect(mail.text).toContain("(nenhuma leitura ao vivo ainda)");
  });
  it("stays off until the recipients and the SMTP account exist", () => {
    expect(ticketMailConfig({})).toBeNull();
    expect(ticketMailConfig({ TICKET_EMAIL_TO: "a@b.c", SMTP_HOST: "smtp.gmail.com", SMTP_USER: "me@gmail.com" })).toBeNull();
    expect(ticketMailConfig({ TICKET_EMAIL_TO: "a@b.c, d@e.f", SMTP_HOST: "smtp.gmail.com", SMTP_USER: "me@gmail.com", SMTP_PASS: "app-pass" }))
      .toMatchObject({ to: ["a@b.c", "d@e.f"], from: "me@gmail.com", port: 465, secure: true });
  });
});
