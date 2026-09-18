import { describe, expect, it } from "vitest";
import { eventJsonLd, faqJsonLd, formatKickoff, gameFaq, gamePageDescription, gamePageTitle, jsonLd, parseMatchup } from "@/lib/seo/game-page";

describe("game page text", () => {
  it("parses the stored matchup and names the page the way people search", () => {
    expect(parseMatchup("Valencia @ Sevilla")).toEqual({ away: "Valencia", home: "Sevilla" });
    expect(parseMatchup("Los Angeles Lakers @ Boston Celtics")).toEqual({ away: "Los Angeles Lakers", home: "Boston Celtics" });
    expect(parseMatchup("3 games")).toBeNull();
    expect(gamePageTitle({ away: "Valencia", home: "Sevilla" }, "11/09/2026", "pt")).toBe("Palpite Valencia x Sevilla — 11/09/2026");
    expect(gamePageTitle({ away: "Valencia", home: "Sevilla" }, "Sep 11, 2026", "en")).toBe("Valencia vs Sevilla prediction — Sep 11, 2026");
    expect(gamePageTitle({ away: "A", home: "B" }, "", "pt")).toBe("Palpite A x B");
  });
  it("formats kickoff in Brasília for pt and Eastern for en", () => {
    const pt = formatKickoff("2026-09-11T19:00:00Z", "pt");
    expect(pt.date).toBe("11/09/2026");
    expect(pt.time).toBe("16:00");
    expect(pt.full).toBe("11/09/2026 às 16:00 (Brasília)");
    const en = formatKickoff("2026-09-11T19:00:00Z", "en");
    expect(en.full).toMatch(/Sep 11, 2026 at 3:00 PM ET/);
    expect(formatKickoff(null, "pt")).toEqual({ date: "", time: "", full: "" });
    expect(formatKickoff("nope", "en").full).toBe("");
  });
  it("writes a description with the teaser when there is one", () => {
    expect(gamePageDescription({ away: "Valencia", home: "Sevilla" }, "La Liga", "pt", { title: "Aposta simples · faixa Valor", odds: "2.10x" })).toContain("Aposta simples · faixa Valor, odd 2.10x");
    expect(gamePageDescription({ away: "Valencia", home: "Sevilla" }, "La Liga", "en", null)).toContain("Valencia vs Sevilla (La Liga) prediction");
  });
  it("answers the FAQ with the sport's own record and never calls it advice", () => {
    const faq = gameFaq({ teams: { away: "Valencia", home: "Sevilla" }, league: "La Liga", lang: "pt", teaser: { title: "Aposta simples · faixa Valor", odds: "2.10x", legs: 1 }, proof: { settled: 2, hitRate: 0.5, roi: 0 } });
    expect(faq).toHaveLength(3);
    expect(faq[0].q).toBe("Qual é o palpite para Valencia x Sevilla?");
    expect(faq[0].a).toContain("1 perna, com odd combinada de 2.10x");
    expect(faq[0].a).toContain("conta grátis");
    const paid = gameFaq({ teams: { away: "A", home: "B" }, league: "NBA", lang: "pt", teaser: { title: "x", odds: "8.00x", legs: 3, free: false }, proof: { settled: 0, hitRate: 0, roi: 0 } });
    expect(paid[0].a).toContain("planos pagos");
    // pt-BR numerals: comma decimal and a non-breaking space before the unit; zero carries no sign.
    expect(faq[1].a).toContain(`2 bilhetes de La Liga já liquidados, 50,0\u00a0% de acerto e ROI de 0,0\u00a0%`);
    expect(faq[2].a).toContain("Aposta não é investimento");
    const empty = gameFaq({ teams: { away: "A", home: "B" }, league: "NBA", lang: "en", teaser: null, proof: { settled: 0, hitRate: 0, roi: 0 } });
    expect(empty[0].a).toContain("has not been built yet");
    expect(empty[1].a).toContain("No NBA ticket has settled yet");
  });
  it("emits JSON-LD that cannot break out of its script tag", () => {
    expect(jsonLd({ name: "</script><b>" })).toBe('{"name":"\\u003c/script>\\u003cb>"}');
    const faq = JSON.parse(faqJsonLd([{ q: "Q?", a: "A." }]));
    expect(faq["@type"]).toBe("FAQPage");
    expect(faq.mainEntity[0].acceptedAnswer.text).toBe("A.");
    const ev = JSON.parse(eventJsonLd({ teams: { away: "Valencia", home: "Sevilla" }, league: "La Liga", startsAt: "2026-09-11T19:00:00Z", url: "https://x.y/jogo/1", venue: "Sánchez-Pizjuán" }));
    expect(ev).toMatchObject({ "@type": "SportsEvent", startDate: "2026-09-11T19:00:00Z", homeTeam: { name: "Sevilla" }, location: { name: "Sánchez-Pizjuán" } });
  });
});
