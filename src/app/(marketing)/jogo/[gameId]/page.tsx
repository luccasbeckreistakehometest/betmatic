import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MarketingFooter, MarketingHeader } from "@/components/MarketingShell";
import { readLedger } from "@/lib/ledger/store";
import { proofPublishable, proofStats, mainTickets } from "@/lib/ledger/proof";
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
import { legsLabel, pickTeaser, teaserHeadline } from "@/lib/teaser";
import { DEFAULT_OG_IMAGE } from "@/lib/seo";

export const dynamic = "force-dynamic";

/**
 * The search-acquisition surface: one public page per game ("palpite sevilla valencia"). Rendered
 * from the game detail plus a teaser of the stored ticket — its shape, band and price, never the
 * title, background or legs, which name the pick — with the sport's live record and an FAQ. Read-only: opening it never generates.
 */
const C = {
  pt: {
    eyebrow: "Palpite", teaser: "Bilhete com mais evidência", noTeaser: "O bilhete deste jogo ainda não foi montado. Ele é gerado com escalações e linhas atualizadas e aparece aqui assim que existir.",
    legsLocked: (n: number) => `${legsLabel(n, "pt")} — a seleção e a chance real de cada uma abrem com uma conta grátis.`, cta: "Criar conta grátis e ver as pernas", open: "Abrir no app",
    legsPaid: (n: number) => `${legsLabel(n, "pt")} — este bilhete está numa faixa dos planos pagos. Com a conta grátis você vê os bilhetes de valor do jogo que escolher.`, ctaPaid: "Ver planos",
    teaserBody: "Montado com as linhas publicadas, as escalações e o histórico medido de cada jogador. O bilhete completo fica público aqui depois que a bola rolar.",
    confidence: "confiança", proof: "Histórico público deste esporte", generated: "gerados", hit: "acerto", roi: "ROI a 1 unidade", all: "ver todos os bilhetes →", kickoff: "Bola rola",
    injuries: "Desfalques e dúvidas", line: "Linha", total: "Total", faq: "Perguntas frequentes", back: "← Betmatic", funnel: "Mais palpites de",
    method: "Todo bilhete gerado é registrado e conferido depois do jogo contra o placar oficial. Os números de acerto aparecem quando a amostra for grande o bastante para dizer alguma coisa.",
    footer: "Ferramenta de pesquisa. Dados agregados podem estar errados ou desatualizados — confirme a linha na sua casa antes de apostar. Nada aqui é recomendação.",
    responsible: "18+. Aposta não é investimento. Só aposte o que você pode perder sem que faça falta. Se deixar de ser diversão, esse é o sinal de parar.",
  },
  en: {
    eyebrow: "Prediction", teaser: "Best-evidenced ticket", noTeaser: "This game's ticket has not been built yet. It is generated from current line-ups and lines and appears here as soon as it exists.",
    legsLocked: (n: number) => `${legsLabel(n, "en")} — each selection and its real chance open with a free account.`, cta: "Create a free account and see the legs", open: "Open in the app",
    legsPaid: (n: number) => `${legsLabel(n, "en")} — this ticket sits in a paid plan's band. A free account shows the value tickets of the game you pick.`, ctaPaid: "See plans",
    teaserBody: "Built from the published lines, the line-ups and each player's measured history. The full ticket goes public here once the game kicks off.",
    confidence: "confidence", proof: "This sport's public record", generated: "generated", hit: "hit rate", roi: "ROI at 1 unit", all: "see every ticket →", kickoff: "Kickoff",
    injuries: "Injuries and doubts", line: "Line", total: "Total", faq: "Frequently asked", back: "← Betmatic", funnel: "More predictions for",
    method: "Every generated ticket is logged and graded after the game against the official score. Hit-rate numbers appear once the sample is large enough to mean something.",
    footer: "Research tool. Aggregated data can be wrong or stale — verify a line at your book before acting. Nothing here is advice.",
    responsible: "21+ where applicable. Betting is not investing. Only stake what you can lose without missing it. If it stops being fun, that is the signal to stop.",
  },
};

interface Loaded { sportKey: string; teams: Teams; detail: GameDetail | null; startsAt: string | null; dateKey: string | null; best: BetSuggestion | null; bestFree: boolean }

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
  const pick = slate ? pickTeaser(slate.slate.suggestions.map((bet) => ({ bet }))) : null;
  return { sportKey, teams, detail, startsAt, dateKey, best: pick?.bet ?? null, bestFree: pick?.free ?? false };
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
  const description = gamePageDescription(teams, getSport(data.sportKey).label[lang], lang, data.best ? { title: teaserHeadline(data.best, lang), odds: formatDecimal(data.best.combinedDecimal) } : null);
  const en = gamePageUrl(base, gameId, data.sportKey, "en");
  return {
    title: { absolute: `${title} | Betmatic` }, description,
    alternates: { canonical: lang === "en" ? en : canonical, languages: { "pt-BR": canonical, en, "x-default": canonical } },
    openGraph: { title, description, url: gamePageUrl(base, gameId, data.sportKey, lang), type: "article", siteName: "Betmatic", locale: lang === "pt" ? "pt_BR" : "en_US", images: [DEFAULT_OG_IMAGE] },
    twitter: { card: "summary_large_image", title, description, images: [DEFAULT_OG_IMAGE.url] },
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
  const proof = proofStats(mainTickets(readLedger()).filter((e) => e.sportKey === data.sportKey));
  const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
  const best = data.best;
  const appPath = `/app/game/${gameId}?sport=${data.sportKey}&lang=${lang}`;
  const signup = { pathname: "/signup", query: { lang, next: appPath } };
  const showProof = proofPublishable(proof);
  const teaser = best ? { title: teaserHeadline(best, lang), odds: formatDecimal(best.combinedDecimal), legs: best.legs.length, free: data.bestFree } : null;
  const faq = gameFaq({ teams, league, lang, teaser, proof: { settled: proof.settled, hitRate: proof.hitRate, roi: proof.roi } });
  const funnel = SPORT_LANDINGS.find((l) => l.sportKeys.includes(data.sportKey));
  const injuries = (data.detail?.injuries ?? []).slice(0, 8);
  const odds = data.detail?.game.odds;

  return (
    <main className="min-h-screen bg-surface-0 text-fg">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: faqJsonLd(faq) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: eventJsonLd({ teams, league, startsAt: data.startsAt, url, venue: data.detail?.game.venue ? sc(data.detail.game.venue) : null }) }} />
      <MarketingHeader lang={lang} langHrefs={{ pt: `/jogo/${gameId}?sport=${data.sportKey}`, en: `/jogo/${gameId}?sport=${data.sportKey}&lang=en` }} />

      <article className="mx-auto max-w-3xl px-5 py-10" data-testid="game-page">
        <p className="text-label uppercase tracking-[0.18em] text-pos">{c.eyebrow} · {league}</p>
        <h1 className="mt-2 text-h2 font-semibold tracking-tight sm:text-h1">{gamePageTitle(teams, kickoff.date, lang)}</h1>
        <p className="mt-3 text-base text-fg-muted">
          {kickoff.full ? <span>{c.kickoff}: {kickoff.full}</span> : null}
          {data.detail?.game.venue ? <span> · {sc(data.detail.game.venue)}</span> : null}
        </p>
        {odds && (odds.details || odds.overUnder !== undefined) && (
          <p className="nums mt-1 text-sm text-fg-dim">
            {odds.details ? `${c.line} ${sc(odds.details)}` : ""}{odds.details && odds.overUnder !== undefined ? " · " : ""}{odds.overUnder !== undefined ? `${c.total} ${odds.overUnder}` : ""}
          </p>
        )}

        <section className="mt-8 rounded-panel border border-pos bg-surface-1 p-5" data-testid="game-teaser">
          <p className="text-label uppercase tracking-[0.18em] text-fg-dim">{c.teaser}</p>
          {best && teaser ? (
            <>
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <h2 className="text-lead font-semibold text-fg">{teaser.title}</h2>
                <span className="nums rounded-control bg-action px-2 py-0.5 text-base font-bold text-focus">{teaser.odds}</span>
                <span className="rounded-control border border-line-strong px-1.5 py-0.5 text-micro uppercase tracking-wide text-fg-muted">{getBand(best.bandKey).label[lang]}</span>
                <span className="nums text-label text-fg-dim">{c.confidence} {best.evidenceScore}</span>
              </div>
              <p className="mt-3 text-base leading-relaxed text-fg-muted">{c.teaserBody}</p>
              <p className="mt-3 text-sm text-fg-dim">🔒 {data.bestFree ? c.legsLocked(best.legs.length) : c.legsPaid(best.legs.length)}</p>
              <div className="mt-4 flex flex-wrap gap-3">
                {data.bestFree
                  ? <Link href={signup} className="inline-flex items-center justify-center gap-2 h-(--row-h) rounded-control px-3 text-sm font-medium whitespace-nowrap bg-action text-action-fg transition-colors duration-(--dur-1) ease-(--ease-out) hover:bg-action-hover active:bg-action-active disabled:cursor-not-allowed disabled:bg-surface-3 disabled:text-fg-faint">{c.cta}</Link>
                  : <Link href={{ pathname: "/planos", query: { lang } }} className="inline-flex items-center justify-center gap-2 h-(--row-h) rounded-control px-3 text-sm font-medium whitespace-nowrap bg-action text-action-fg transition-colors duration-(--dur-1) ease-(--ease-out) hover:bg-action-hover active:bg-action-active disabled:cursor-not-allowed disabled:bg-surface-3 disabled:text-fg-faint">{c.ctaPaid}</Link>}
                <Link href={{ pathname: `/app/game/${gameId}`, query: { sport: data.sportKey, lang } }} className="rounded-control border border-line-strong px-4 py-2 text-sm text-fg-muted hover:text-fg">{c.open}</Link>
              </div>
            </>
          ) : (
            <>
              <p className="mt-2 text-base text-fg-muted">{c.noTeaser}</p>
              <Link href={signup} className="mt-4 inline-flex items-center justify-center gap-2 h-(--row-h) rounded-control px-3 text-sm font-medium whitespace-nowrap bg-action text-action-fg transition-colors duration-(--dur-1) ease-(--ease-out) hover:bg-action-hover active:bg-action-active disabled:cursor-not-allowed disabled:bg-surface-3 disabled:text-fg-faint">{c.cta}</Link>
            </>
          )}
        </section>

        <section className="mt-8 rounded-panel border border-line bg-surface-1 p-(--panel-p)" data-testid="game-proof">
          <p className="text-label uppercase tracking-[0.18em] text-fg-dim">{c.proof}</p>
          {showProof ? (
            <div className="mt-3 flex flex-wrap gap-8">
              {[[c.generated, String(proof.generated)], [c.hit, pct(proof.hitRate)], [c.roi, `${proof.roi >= 0 ? "+" : ""}${pct(proof.roi)}`]].map(([k, v]) => (
                <div key={k}><div className="nums text-h3 font-semibold text-fg">{v}</div><div className="text-tiny text-fg-dim">{k}</div></div>
              ))}
            </div>
          ) : (
            <p className="mt-2 text-sm leading-relaxed text-fg-muted">{c.method}</p>
          )}
          <Link href={{ pathname: "/prova", query: { lang } }} className="mt-3 inline-block text-sm text-pos hover:underline">{c.all}</Link>
        </section>

        {injuries.length > 0 && (
          <section className="mt-8">
            <h2 className="text-label uppercase tracking-[0.18em] text-fg-dim">{c.injuries}</h2>
            <ul className="mt-2 divide-y divide-line rounded-panel border border-line">
              {injuries.map((i, k) => (
                <li key={k} className="flex flex-wrap items-baseline gap-2 px-4 py-2 text-sm">
                  <span className="text-fg">{sc(i.player)}</span>
                  <span className="text-label text-fg-dim">{i.teamAbbreviation}</span>
                  <span className="ml-auto text-tiny text-warn">{sc(i.status)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="mt-10">
          <h2 className="text-lead font-semibold">{c.faq}</h2>
          <dl className="mt-3 divide-y divide-line rounded-panel border border-line">
            {faq.map((f) => (
              <div key={f.q} className="px-4 py-3"><dt className="text-base font-semibold text-fg">{f.q}</dt><dd className="mt-1 text-sm leading-relaxed text-fg-muted">{f.a}</dd></div>
            ))}
          </dl>
        </section>

        {funnel && (
          <p className="mt-8 text-sm text-fg-dim">
            {c.funnel} <Link href={`/${funnel.slug[lang]}`} className="text-pos hover:underline">{funnel.name[lang]}</Link>
          </p>
        )}
      </article>

      <MarketingFooter lang={lang} />
    </main>
  );
}
