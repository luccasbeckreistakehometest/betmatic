import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MarketingFooter, MarketingHeader } from "@/components/MarketingShell";
import { readLedger } from "@/lib/ledger/store";
import { proofPublishable, proofStats } from "@/lib/ledger/proof";
import { findGameInfo, servePredictions } from "@/lib/server/predictions";
import { gamePageUrl } from "@/lib/server/sitemap-games";
import { scrubText } from "@/lib/server/whitelabel";
import { getPlan } from "@/lib/plans";
import { getSport, SPORTS } from "@/lib/sports";
import { SPORT_LANDINGS } from "@/lib/sport-landing";
import { espnDateKey, getGameDetail } from "@/lib/sources/espn";
import { formatDecimal, getBand } from "@/lib/odds";
import { normaliseLang, type Lang } from "@/lib/i18n";
import { eventJsonLd, faqJsonLd, formatKickoff, gameFaq, gamePageDescription, gamePageTitle, parseMatchup, type Teams } from "@/lib/seo/game-page";
import type { BetSuggestion, GameDetail } from "@/lib/types";
import { publicBaseUrl } from "@/lib/base-url";

export const dynamic = "force-dynamic";

/**
 * The search-acquisition surface: one public page per game ("palpite sevilla valencia"). Rendered
 * from the game detail plus a whitelabelled teaser of the stored ticket — title, price, context,
 * never the legs — with the sport's live record and an FAQ. Read-only: opening it never generates.
 */
const C = {
  pt: {
    eyebrow: "Palpite", teaser: "Bilhete com mais evidência", noTeaser: "O bilhete deste jogo ainda não foi montado. Ele é gerado com escalações e linhas atualizadas e aparece aqui assim que existir.",
    legsLocked: (n: number) => `${n} ${n === 1 ? "perna" : "pernas"} — a seleção e a chance real de cada uma abrem com uma conta grátis.`, cta: "Criar conta grátis e ver as pernas", open: "Abrir no app",
    confidence: "confiança", proof: "Histórico público deste esporte", generated: "gerados", hit: "acerto", roi: "ROI a 1 unidade", all: "ver todos os bilhetes →", kickoff: "Bola rola",
    injuries: "Desfalques e dúvidas", line: "Linha", total: "Total", faq: "Perguntas frequentes", back: "← Betmatic", funnel: "Mais palpites de",
    method: "Todo bilhete gerado é registrado e conferido depois do jogo contra o placar oficial. Os números de acerto aparecem quando a amostra for grande o bastante para dizer alguma coisa.",
    footer: "Ferramenta de pesquisa. Dados agregados podem estar errados ou desatualizados — confirme a linha na sua casa antes de apostar. Nada aqui é recomendação.",
    responsible: "18+. Aposta não é investimento. Só aposte o que você pode perder sem que faça falta. Se deixar de ser diversão, esse é o sinal de parar.",
  },
  en: {
    eyebrow: "Prediction", teaser: "Best-evidenced ticket", noTeaser: "This game's ticket has not been built yet. It is generated from current line-ups and lines and appears here as soon as it exists.",
    legsLocked: (n: number) => `${n} ${n === 1 ? "leg" : "legs"} — each selection and its real chance open with a free account.`, cta: "Create a free account and see the legs", open: "Open in the app",
    confidence: "confidence", proof: "This sport's public record", generated: "generated", hit: "hit rate", roi: "ROI at 1 unit", all: "see every ticket →", kickoff: "Kickoff",
    injuries: "Injuries and doubts", line: "Line", total: "Total", faq: "Frequently asked", back: "← Betmatic", funnel: "More predictions for",
    method: "Every generated ticket is logged and graded after the game against the official score. Hit-rate numbers appear once the sample is large enough to mean something.",
    footer: "Research tool. Aggregated data can be wrong or stale — verify a line at your book before acting. Nothing here is advice.",
    responsible: "21+ where applicable. Betting is not investing. Only stake what you can lose without missing it. If it stops being fun, that is the signal to stop.",
  },
};

interface Loaded { sportKey: string; teams: Teams; detail: GameDetail | null; startsAt: string | null; dateKey: string | null; best: BetSuggestion | null }

async function load(gameId: string, sportParam: string | undefined, lang: Lang): Promise<Loaded | null> {
  if (!/^[0-9]{5,12}$/.test(gameId)) return null;
  const info = findGameInfo(gameId);
  const sportKey = info?.sportKey ?? (sportParam && SPORTS.some((s) => s.key === sportParam) ? sportParam : null);
  if (!sportKey) return null;
  const detail = await getGameDetail(gameId, false, sportKey).catch(() => null);
  const teams = detail ? { away: detail.game.away.displayName, home: detail.game.home.displayName } : info ? parseMatchup(info.matchup) : null;
  if (!teams) return null;
  const startsAt = detail?.game.startsAt ?? info?.startsAt ?? null;
  const dateKey = info?.dateKey ?? (startsAt ? espnDateKey(new Date(startsAt)) : null);
  // The full plan's view, whitelabelled, so the teaser reflects what exists; a missing language falls back.
  const served = (l: Lang) => (dateKey ? servePredictions({ scope: "game", sportKey, dateKey, lang: l, plan: getPlan("pro"), role: "user" }).find((p) => p.gameId === gameId) ?? null : null);
  const slate = served(lang) ?? served("pt") ?? served("en");
  const best = slate ? [...slate.slate.suggestions].sort((a, b) => b.evidenceScore - a.evidenceScore)[0] ?? null : null;
  return { sportKey, teams, detail, startsAt, dateKey, best };
}

const langOf = (q: Record<string, string | string[] | undefined>) => normaliseLang(typeof q.lang === "string" ? q.lang : undefined);
const sportOf = (q: Record<string, string | string[] | undefined>) => (typeof q.sport === "string" ? q.sport : undefined);

export async function generateMetadata({ params, searchParams }: { params: Promise<{ gameId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }): Promise<Metadata> {
  const { gameId } = await params;
  const q = await searchParams;
  const lang = langOf(q);
  const data = await load(gameId, sportOf(q), lang);
  if (!data) return {};
  const base = publicBaseUrl();
  // The sport is part of the canonical: without stored tickets it is the only way the page resolves.
  const canonical = gamePageUrl(base, gameId, data.sportKey);
  const sc = (s: string) => scrubText(s, lang);
  const teams = { away: sc(data.teams.away), home: sc(data.teams.home) };
  const title = gamePageTitle(teams, formatKickoff(data.startsAt, lang).date, lang);
  const description = gamePageDescription(teams, getSport(data.sportKey).label[lang], lang, data.best ? { title: sc(data.best.title), odds: formatDecimal(data.best.combinedDecimal) } : null);
  const en = gamePageUrl(base, gameId, data.sportKey, "en");
  return {
    title: { absolute: `${title} | Betmatic` }, description,
    alternates: { canonical: lang === "en" ? en : canonical, languages: { "pt-BR": canonical, en, "x-default": canonical } },
    openGraph: { title, description, url: gamePageUrl(base, gameId, data.sportKey, lang), type: "article", siteName: "Betmatic", locale: lang === "pt" ? "pt_BR" : "en_US" },
  };
}

export default async function GamePublicPage({ params, searchParams }: { params: Promise<{ gameId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { gameId } = await params;
  const q = await searchParams;
  const lang = langOf(q);
  const data = await load(gameId, sportOf(q), lang);
  if (!data) notFound();
  const c = C[lang];
  const sc = (s: string | undefined) => scrubText(s, lang);
  const sport = getSport(data.sportKey);
  const league = sport.label[lang];
  const teams = { away: sc(data.teams.away), home: sc(data.teams.home) };
  const kickoff = formatKickoff(data.startsAt, lang);
  const base = publicBaseUrl();
  const url = gamePageUrl(base, gameId, data.sportKey);
  const proof = proofStats(readLedger().filter((e) => e.sportKey === data.sportKey));
  const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
  const best = data.best;
  const appPath = `/app/game/${gameId}?sport=${data.sportKey}&lang=${lang}`;
  const signup = { pathname: "/signup", query: { lang, next: appPath } };
  const showProof = proofPublishable(proof);
  const teaser = best ? { title: sc(best.title), odds: formatDecimal(best.combinedDecimal), legs: best.legs.length } : null;
  const faq = gameFaq({ teams, league, lang, teaser, proof: { settled: proof.settled, hitRate: proof.hitRate, roi: proof.roi } });
  const funnel = SPORT_LANDINGS.find((l) => l.sportKeys.includes(data.sportKey));
  const injuries = (data.detail?.injuries ?? []).slice(0, 8);
  const odds = data.detail?.game.odds;

  return (
    <main className="min-h-screen bg-ink-950 text-mist-100">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: faqJsonLd(faq) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: eventJsonLd({ teams, league, startsAt: data.startsAt, url, venue: data.detail?.game.venue ? sc(data.detail.game.venue) : null }) }} />
      <MarketingHeader lang={lang} langHrefs={{ pt: `/jogo/${gameId}?sport=${data.sportKey}`, en: `/jogo/${gameId}?sport=${data.sportKey}&lang=en` }} />

      <article className="mx-auto max-w-3xl px-5 py-10" data-testid="game-page">
        <p className="text-[11px] uppercase tracking-[0.18em] text-edge-400">{c.eyebrow} · {league}</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">{gamePageTitle(teams, kickoff.date, lang)}</h1>
        <p className="mt-3 text-[14px] text-mist-400">
          {kickoff.full ? <span>{c.kickoff}: {kickoff.full}</span> : null}
          {data.detail?.game.venue ? <span> · {sc(data.detail.game.venue)}</span> : null}
        </p>
        {odds && (odds.details || odds.overUnder !== undefined) && (
          <p className="nums mt-1 text-[13px] text-mist-500">
            {odds.details ? `${c.line} ${sc(odds.details)}` : ""}{odds.details && odds.overUnder !== undefined ? " · " : ""}{odds.overUnder !== undefined ? `${c.total} ${odds.overUnder}` : ""}
          </p>
        )}

        <section className="mt-8 rounded-2xl border border-edge-400/25 bg-ink-900/70 p-5" data-testid="game-teaser">
          <p className="text-[11px] uppercase tracking-[0.18em] text-mist-500">{c.teaser}</p>
          {best && teaser ? (
            <>
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <h2 className="text-xl font-semibold text-white">{teaser.title}</h2>
                <span className="nums rounded-lg bg-signal-500/12 px-2 py-0.5 text-[14px] font-bold text-signal-400">{teaser.odds}</span>
                <span className="rounded border border-ink-700 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-mist-400">{getBand(best.bandKey).label[lang]}</span>
                <span className="nums text-[11px] text-mist-500">{c.confidence} {best.evidenceScore}</span>
              </div>
              <p className="mt-3 text-[14px] leading-relaxed text-mist-300">{sc(best.background)}</p>
              <p className="mt-3 text-[13px] text-mist-500">🔒 {c.legsLocked(best.legs.length)}</p>
              <div className="mt-4 flex flex-wrap gap-3">
                <Link href={signup} className="rounded-lg bg-edge-400 px-4 py-2 text-[13px] font-semibold text-ink-950 hover:bg-edge-500">{c.cta}</Link>
                <Link href={{ pathname: `/app/game/${gameId}`, query: { sport: data.sportKey, lang } }} className="rounded-lg border border-ink-700 px-4 py-2 text-[13px] text-mist-300 hover:text-mist-100">{c.open}</Link>
              </div>
            </>
          ) : (
            <>
              <p className="mt-2 text-[14px] text-mist-400">{c.noTeaser}</p>
              <Link href={signup} className="mt-4 inline-block rounded-lg bg-edge-400 px-4 py-2 text-[13px] font-semibold text-ink-950 hover:bg-edge-500">{c.cta}</Link>
            </>
          )}
        </section>

        <section className="mt-8 rounded-xl border border-ink-800 bg-ink-900/60 p-5" data-testid="game-proof">
          <p className="text-[11px] uppercase tracking-[0.18em] text-mist-500">{c.proof}</p>
          {showProof ? (
            <div className="mt-3 flex flex-wrap gap-8">
              {[[c.generated, String(proof.generated)], [c.hit, pct(proof.hitRate)], [c.roi, `${proof.roi >= 0 ? "+" : ""}${pct(proof.roi)}`]].map(([k, v]) => (
                <div key={k}><div className="nums text-2xl font-semibold text-white">{v}</div><div className="text-[12px] text-mist-500">{k}</div></div>
              ))}
            </div>
          ) : (
            <p className="mt-2 text-[13.5px] leading-relaxed text-mist-400">{c.method}</p>
          )}
          <Link href={{ pathname: "/prova", query: { lang } }} className="mt-3 inline-block text-[13px] text-edge-400 hover:underline">{c.all}</Link>
        </section>

        {injuries.length > 0 && (
          <section className="mt-8">
            <h2 className="text-[11px] uppercase tracking-[0.18em] text-mist-500">{c.injuries}</h2>
            <ul className="mt-2 divide-y divide-ink-800 rounded-xl border border-ink-800">
              {injuries.map((i, k) => (
                <li key={k} className="flex flex-wrap items-baseline gap-2 px-4 py-2 text-[13px]">
                  <span className="text-mist-100">{sc(i.player)}</span>
                  <span className="text-[11px] text-mist-500">{i.teamAbbreviation}</span>
                  <span className="ml-auto text-[12px] text-warn-400">{sc(i.status)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="mt-10">
          <h2 className="text-xl font-semibold">{c.faq}</h2>
          <dl className="mt-3 divide-y divide-ink-800 rounded-xl border border-ink-800">
            {faq.map((f) => (
              <div key={f.q} className="px-4 py-3"><dt className="text-[14px] font-semibold text-white">{f.q}</dt><dd className="mt-1 text-[13px] leading-relaxed text-mist-400">{f.a}</dd></div>
            ))}
          </dl>
        </section>

        {funnel && (
          <p className="mt-8 text-[13px] text-mist-500">
            {c.funnel} <Link href={`/${funnel.slug[lang]}`} className="text-edge-400 hover:underline">{funnel.name[lang]}</Link>
          </p>
        )}
      </article>

      <MarketingFooter lang={lang} />
    </main>
  );
}
