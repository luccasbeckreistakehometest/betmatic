import type { Lang } from "@/lib/i18n";
import { formatPercent } from "@/lib/format";

/**
 * The public per-game page ("palpite Sevilla x Valencia") as pure text builders: title, kickoff,
 * the FAQ and the JSON-LD. Nothing here reads the network or the database, so the search surface
 * is testable to the character — and every string is run through the whitelabel scrub by the page.
 */
export interface Teams { away: string; home: string }

/** Ledger and prediction rows store the matchup as "Away @ Home". */
export function parseMatchup(matchup: string): Teams | null {
  const m = matchup.match(/^(.+?)\s+@\s+(.+)$/);
  return m ? { away: m[1].trim(), home: m[2].trim() } : null;
}

export function formatKickoff(iso: string | null | undefined, lang: Lang): { date: string; time: string; full: string } {
  if (!iso || Number.isNaN(Date.parse(iso))) return { date: "", time: "", full: "" };
  const d = new Date(iso);
  const tz = lang === "pt" ? "America/Sao_Paulo" : "America/New_York";
  const date = new Intl.DateTimeFormat(lang === "pt" ? "pt-BR" : "en-US", { timeZone: tz, day: "2-digit", month: lang === "pt" ? "2-digit" : "short", year: "numeric" }).format(d);
  const time = new Intl.DateTimeFormat(lang === "pt" ? "pt-BR" : "en-US", { timeZone: tz, hour: lang === "pt" ? "2-digit" : "numeric", minute: "2-digit", hour12: lang !== "pt" }).format(d);
  return { date, time, full: lang === "pt" ? `${date} às ${time} (Brasília)` : `${date} at ${time} ET` };
}

export function gamePageTitle(teams: Teams, date: string, lang: Lang): string {
  const when = date ? ` — ${date}` : "";
  return lang === "pt" ? `Palpite ${teams.away} x ${teams.home}${when}` : `${teams.away} vs ${teams.home} prediction${when}`;
}

export function gamePageDescription(teams: Teams, league: string, lang: Lang, teaser: { title: string; odds: string } | null): string {
  if (lang === "pt") {
    return teaser
      ? `Palpite para ${teams.away} x ${teams.home} (${league}): ${teaser.title}, odd ${teaser.odds}, com a chance real ao lado e histórico público liquidado automaticamente.`
      : `Palpite para ${teams.away} x ${teams.home} (${league}) com dados medidos e histórico público liquidado automaticamente.`;
  }
  return teaser
    ? `${teams.away} vs ${teams.home} (${league}) prediction: ${teaser.title}, odds ${teaser.odds}, with the real chance next to it and a public, auto-graded record.`
    : `${teams.away} vs ${teams.home} (${league}) prediction from measured data, with a public, auto-graded record.`;
}

export interface FaqInput {
  teams: Teams;
  league: string;
  lang: Lang;
  teaser: { title: string; odds: string; legs: number; free?: boolean } | null;
  proof: { settled: number; hitRate: number; roi: number };
}

const pct = (n: number, lang: "pt" | "en") => formatPercent(n, lang);

/** Three questions a searcher actually types, answered with the page's own numbers. */
export function gameFaq(i: FaqInput): { q: string; a: string }[] {
  const { teams, league, lang, teaser, proof } = i;
  const record = proof.settled
    ? lang === "pt"
      ? `${proof.settled} bilhetes de ${league} já liquidados, ${pct(proof.hitRate, lang)} de acerto e ROI de ${formatPercent(proof.roi, lang, { signed: true })} a 1 unidade fixa.`
      : `${proof.settled} ${league} tickets settled so far, a ${pct(proof.hitRate, lang)} hit rate and ${formatPercent(proof.roi, lang, { signed: true })} ROI at a flat unit.`
    : lang === "pt"
      ? `Ainda não há bilhete de ${league} liquidado; o histórico público começa no primeiro jogo que terminar.`
      : `No ${league} ticket has settled yet; the public record starts with the first finished game.`;
  if (lang === "pt") {
    return [
      { q: `Qual é o palpite para ${teams.away} x ${teams.home}?`, a: teaser ? `O bilhete em destaque tem ${teaser.legs} ${teaser.legs === 1 ? "linha" : "linhas"}, com odd combinada de ${teaser.odds}. ${teaser.free === false ? "Ele faz parte dos planos pagos; com a conta grátis você vê os bilhetes de valor do jogo que escolher." : "As linhas e a chance real de cada uma ficam disponíveis com uma conta grátis."} Depois que a bola rola, o bilhete completo fica público.` : `O bilhete deste jogo ainda não foi montado. Ele é gerado com escalações e números atualizados e aparece aqui assim que existir.` },
      { q: `Esse palpite é confiável?`, a: `Cada bilhete gerado entra num histórico público e é liquidado sozinho contra o placar real — nada é apagado depois. ${record}` },
      { q: `Isso é recomendação de aposta?`, a: `Não. É uma ferramenta de pesquisa: mostra a chance estimada ao lado da odd para você decidir. Aposta não é investimento — só aposte o que pode perder.` },
    ];
  }
  return [
    { q: `What is the prediction for ${teams.away} vs ${teams.home}?`, a: teaser ? `The featured ticket has ${teaser.legs} ${teaser.legs === 1 ? "leg" : "legs"} at combined odds of ${teaser.odds}. ${teaser.free === false ? "It belongs to the paid plans; a free account shows the value tickets of the game you pick." : "The legs and each one's real chance open with a free account."} Once the game kicks off, the full ticket goes public.` : `This game's ticket has not been built yet. It is generated from current line-ups and lines and appears here as soon as it exists.` },
    { q: `Can this prediction be trusted?`, a: `Every ticket generated goes into a public record and is graded automatically against the real score — nothing is deleted afterwards. ${record}` },
    { q: `Is this betting advice?`, a: `No. It is a research tool: it shows the estimated chance next to the price so you can decide. Betting is not investing — only stake what you can afford to lose.` },
  ];
}

/** JSON-LD as a string safe to inline: `<` is escaped so a team name can never close the script tag. */
export function jsonLd(obj: unknown): string {
  return JSON.stringify(obj).replace(/</g, "\\u003c");
}

export function faqJsonLd(faq: { q: string; a: string }[]): string {
  return jsonLd({ "@context": "https://schema.org", "@type": "FAQPage", mainEntity: faq.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })) });
}

export function eventJsonLd(i: { teams: Teams; league: string; startsAt: string | null; url: string; venue?: string | null }): string {
  return jsonLd({
    "@context": "https://schema.org", "@type": "SportsEvent", name: `${i.teams.away} @ ${i.teams.home}`, sport: i.league, url: i.url,
    ...(i.startsAt ? { startDate: i.startsAt } : {}), ...(i.venue ? { location: { "@type": "Place", name: i.venue } } : {}),
    homeTeam: { "@type": "SportsTeam", name: i.teams.home }, awayTeam: { "@type": "SportsTeam", name: i.teams.away },
  });
}
