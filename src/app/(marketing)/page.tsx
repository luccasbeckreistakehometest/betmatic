import type { Metadata } from "next";
import Link from "next/link";
import { LogoMark } from "@/components/Logo";
import { MarketingFooter, MarketingHeader } from "@/components/MarketingShell";
import { ProofStrip } from "@/components/ProofStrip";
import { DEFAULT_META, langFrom, pageMetadata, type SearchProps } from "@/lib/seo";
import { formatMoneyBRL } from "@/lib/format";
import { currentUser } from "@/lib/server/session";
import { LADDER, landingCopy } from "@/lib/landing-copy";
import { normaliseLang } from "@/lib/i18n";
import { SPORT_LANDINGS } from "@/lib/sport-landing";
import { COIN_PACKS, PERIOD, PLANS, PREPAID_NOTE } from "@/lib/plans";
import { impliedProbability } from "@/lib/odds";

export const dynamic = "force-dynamic";

export async function generateMetadata({ searchParams }: SearchProps): Promise<Metadata> {
  const lang = await langFrom(searchParams);
  const meta = pageMetadata({ lang, ...DEFAULT_META[lang], paths: { pt: "/", en: "/?lang=en" } });
  return { ...meta, title: { absolute: DEFAULT_META[lang].title } };
}

/** Every price on the site is in reais; English readers see it labelled BRL. */
const money = (value: number, lang: "pt" | "en") => formatMoneyBRL(value, lang);

export default async function Landing({ searchParams }: PageProps<"/">) {
  const query = await searchParams;
  const lang = normaliseLang(typeof query.lang === "string" ? query.lang : undefined);
  const c = landingCopy(lang);
  // Visitors carry the chosen plan through signup straight to checkout; members pick the period on /planos.
  const signedIn = !!(await currentUser());
  const stake = lang === "pt" ? 10 : 10;
  const maxReturn = Math.max(...LADDER.map((l) => l.decimal)) * stake;

  return (
    <div className="flex min-h-full flex-col bg-surface-0">
      <MarketingHeader
        lang={lang}
        langHrefs={{ pt: "/", en: "/?lang=en" }}
        nav={
          <nav className="ml-4 hidden items-center gap-5 text-sm text-fg-muted md:flex">
            <a href="#como" className="transition hover:text-fg">{c.navHow}</a>
            <a href="#esportes" className="transition hover:text-fg">{c.navSports}</a>
            <Link href={{ pathname: "/planos", query: { lang } }} className="transition hover:text-fg">{c.navPricing}</Link>
            <Link href={{ pathname: "/prova", query: { lang } }} className="transition hover:text-fg">{lang === "pt" ? "Prova" : "Track record"}</Link>
            <Link href={{ pathname: "/ferramentas", query: { lang } }} className="transition hover:text-fg">{lang === "pt" ? "Ferramentas" : "Free tools"}</Link>
          </nav>
        }
      />

      {/* ---- hero ---- */}
      <section className="relative overflow-hidden border-b border-line">
        {/* Faint technical grid instead of a decorative gradient blob. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.055]"
          style={{
            backgroundImage:
              "linear-gradient(to right, #7d8aa0 1px, transparent 1px), linear-gradient(to bottom, #7d8aa0 1px, transparent 1px)",
            backgroundSize: "72px 72px",
          }}
        />
        <div className="relative mx-auto grid max-w-6xl gap-12 px-5 py-16 lg:grid-cols-[1.05fr_0.95fr] lg:py-24">
          <div className="flex flex-col justify-center">
            <span className="text-label font-medium uppercase tracking-[0.18em] text-pos">
              {c.heroKicker}
            </span>
            <h1 className="mt-5 text-[clamp(2.6rem,6.2vw,4.4rem)] font-semibold leading-[0.98] tracking-[-0.035em] text-fg">
              {c.heroTitle[0]}
              <br />
              <span className="text-pos">{c.heroTitle[1]}</span>
            </h1>
            <p className="mt-6 max-w-lg text-base leading-relaxed text-fg-muted">{c.heroSub}</p>
            <div className="mt-8 flex flex-wrap items-center gap-4">
              <Link
                href={{ pathname: "/signup", query: { lang } }}
                data-testid="hero-cta"
                className="rounded-panel bg-action px-6 py-3 text-base font-semibold text-action-fg transition hover:bg-action"
              >
                {c.heroCta}
              </Link>
              <Link href={{ pathname: "/app", query: { lang } }} className="rounded-panel border border-line-strong px-5 py-3 text-base font-medium text-fg transition hover:border-line-control hover:text-fg">
                {c.heroSecondary}
              </Link>
            </div>
            <p className="mt-3 text-tiny text-fg-dim">{c.heroCtaSub}</p>
            <p className="mt-8 max-w-md border-l-2 border-line-strong pl-4 text-tiny leading-relaxed text-fg-dim">
              {c.heroProof}
            </p>
          </div>

          {/* ---- the ladder: the product's real output, used as the hero visual ---- */}
          <div className="rounded-panel border border-line bg-surface-1 p-5">
            <h2 className="text-sm font-semibold text-fg">{c.ladderTitle}</h2>
            <p className="mt-1 text-tiny leading-relaxed text-fg-dim">{c.ladderSub}</p>

            <div className="mt-5 grid grid-cols-[auto_1fr_auto] items-center gap-x-3 text-micro uppercase tracking-wider text-fg-dim">
              <span>{c.ladderStake}</span>
              <span>{c.ladderReturns}</span>
              <span className="text-right">{c.ladderChance}</span>
            </div>

            <ul className="mt-2 flex flex-col gap-2.5">
              {LADDER.map((rung) => {
                const payout = rung.decimal * stake;
                const chance = impliedProbability(rung.decimal);
                const width = Math.max(6, (Math.log10(payout) / Math.log10(maxReturn)) * 100);
                return (
                  <li key={rung.legs} className="grid grid-cols-[auto_1fr_auto] items-center gap-x-3">
                    <span className="nums w-14 text-label text-fg-dim">{rung.label[lang]}</span>
                    <span className="relative flex h-7 items-center">
                      <span
                        className="absolute inset-y-0 left-0 rounded-control bg-gradient-to-r from-edge-500/70 to-edge-400"
                        style={{ width: `${width}%` }}
                      />
                      <span className="nums relative pl-2.5 text-tiny font-semibold text-action-fg mix-blend-luminosity">
                        {money(payout, lang)}
                      </span>
                    </span>
                    <span
                      className={`nums w-14 text-right text-tiny ${
                        chance > 0.2 ? "text-fg-muted" : chance > 0.02 ? "text-warn" : "text-neg"
                      }`}
                    >
                      {chance >= 0.01 ? `${(chance * 100).toFixed(1)}%` : `${(chance * 100).toFixed(2)}%`}
                    </span>
                  </li>
                );
              })}
            </ul>

            <p className="mt-5 border-t border-line pt-3 text-tiny leading-relaxed text-fg-dim">
              {c.ladderFootnote}
            </p>
          </div>
        </div>
      </section>

      <ProofStrip lang={lang} />

      {/* ---- what runs on its own: the day's featured games, and the closing line ---- */}
      <section className="border-b border-line" data-testid="daily">
        <div className="mx-auto max-w-6xl px-5 py-16">
          <h2 className="max-w-2xl text-[clamp(1.6rem,3.2vw,2.3rem)] font-semibold leading-tight tracking-[-0.02em] text-fg">
            {c.dailyTitle}
          </h2>
          <p className="mt-2 max-w-2xl text-base leading-relaxed text-fg-muted">{c.dailySub}</p>
          <div className="mt-8 grid gap-4 md:grid-cols-2">
            {c.daily.map((item) => (
              <div key={item.title} className="flex flex-col rounded-panel border border-line bg-surface-1 p-6">
                <h3 className="text-body font-semibold text-fg">{item.title}</h3>
                <p className="mt-2 flex-1 text-sm leading-relaxed text-fg-muted">{item.body}</p>
                <Link
                  href={{ pathname: item.href, query: { lang } }}
                  className="mt-4 self-start text-sm text-pos hover:underline"
                >
                  {item.cta} →
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---- honesty ---- */}
      <section className="border-b border-line">
        <div className="mx-auto max-w-6xl px-5 py-16">
          <h2 className="max-w-xl text-[clamp(1.6rem,3.2vw,2.3rem)] font-semibold leading-tight tracking-[-0.02em] text-fg">
            {c.honestyTitle}
          </h2>
          <p className="mt-2 text-base text-fg-muted">{c.honestySub}</p>
          <div className="mt-10 grid gap-px overflow-hidden rounded-panel border border-line bg-surface-3 md:grid-cols-3">
            {c.honestyPoints.map((point, i) => (
              <div key={point.title} className="flex flex-col bg-surface-1 p-6">
                <span className="nums text-label text-pos">{String(i + 1).padStart(2, "0")}</span>
                <h3 className="mt-3 text-base font-semibold text-fg">{point.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-fg-muted">{point.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---- edge ---- */}
      <section className="border-b border-line" data-testid="edge">
        <div className="mx-auto max-w-6xl px-5 py-16">
          <h2 className="text-h2 font-semibold tracking-tight text-fg sm:text-h1">{c.edgeTitle}</h2>
          <p className="mt-3 max-w-2xl text-base text-fg-muted">{c.edgeSub}</p>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {c.edges.map((e) => (
              <Link key={e.title} href={{ pathname: e.href, query: { lang } }} className="group rounded-panel border border-line bg-surface-1 p-5 transition hover:border-pos">
                <p className="text-base font-semibold text-fg group-hover:text-pos">{e.title}</p>
                <p className="mt-2 text-sm leading-relaxed text-fg-muted">{e.body}</p>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* ---- how ---- */}
      <section id="como" className="border-b border-line">
        <div className="mx-auto max-w-6xl px-5 py-16">
          <h2 className="text-[clamp(1.6rem,3.2vw,2.3rem)] font-semibold tracking-[-0.02em] text-fg">
            {c.howTitle}
          </h2>
          <ol className="mt-10 flex flex-col gap-px overflow-hidden rounded-panel border border-line bg-surface-3">
            {c.howSteps.map((step) => (
              <li key={step.n} className="grid gap-4 bg-surface-1 p-6 sm:grid-cols-[6rem_1fr_2fr] sm:items-baseline">
                <span className="nums text-[2rem] font-semibold leading-none text-fg-faint">{step.n}</span>
                <h3 className="text-base font-semibold text-fg">{step.title}</h3>
                <p className="text-sm leading-relaxed text-fg-muted">{step.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ---- per-sport funnel ---- */}
      <section id="esportes" className="border-b border-line">
        <div className="mx-auto max-w-6xl px-5 py-16">
          <h2 className="text-[clamp(1.6rem,3.2vw,2.3rem)] font-semibold tracking-[-0.02em] text-fg">
            {c.sportsTitle}
          </h2>
          <p className="mt-2 max-w-2xl text-base text-fg-muted">{c.sportsSub}</p>
          <div className="mt-10 flex flex-col gap-4">
            {c.sports.map((sport) => (
              <Link
                key={sport.key}
                href={`/${SPORT_LANDINGS.find((l) => l.sportKeys.some((k) => k.startsWith(sport.key === "basketball" ? "nba" : "soccer")))?.slug[lang] ?? ""}`}
                className="group grid gap-5 rounded-panel border border-line bg-surface-1 p-6 transition hover:border-pos md:grid-cols-[1fr_1.5fr]"
              >
                <div>
                  <h3 className="text-[1.5rem] font-semibold tracking-[-0.02em] text-fg">{sport.name}</h3>
                  <p className="mt-1 text-sm font-medium text-pos">{sport.hook}</p>
                </div>
                <div>
                  <p className="text-sm leading-relaxed text-fg-muted">{sport.detail}</p>
                  <p className="nums mt-3 text-tiny leading-relaxed text-fg-dim">{sport.markets}</p>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* ---- pricing ---- */}
      <section id="planos" className="border-b border-line">
        <div className="mx-auto max-w-6xl px-5 py-16">
          <h2 className="text-[clamp(1.6rem,3.2vw,2.3rem)] font-semibold tracking-[-0.02em] text-fg">
            {c.pricingTitle}
          </h2>
          <p className="mt-2 text-base text-fg-muted">{c.pricingSub}</p>

          <div className="mt-10 grid gap-4 lg:grid-cols-4">
            {PLANS.map((plan) => {
              const featured = plan.id === "pro";
              return (
                <div
                  key={plan.id}
                  className={`relative flex flex-col rounded-panel border p-6 ${
                    featured ? "border-pos bg-action]" : "border-line bg-surface-1"
                  }`}
                >
                  {featured && (
                    <span className="absolute -top-2.5 left-6 rounded-control bg-action px-2 py-0.5 text-micro font-bold uppercase tracking-wide text-action-fg">
                      {c.mostPopular}
                    </span>
                  )}
                  <h3 className="text-base font-semibold text-fg">{plan.name}</h3>
                  <p className="mt-1 text-tiny text-fg-dim">{plan.tagline[lang]}</p>
                  <p className="mt-4 flex items-baseline gap-1">
                    <span className="nums text-[2rem] font-semibold leading-none text-fg">
                      {plan.monthlyPrice === 0 ? (lang === "pt" ? "Grátis" : "Free") : money(plan.monthlyPrice, lang)}
                    </span>
                    {plan.monthlyPrice > 0 && <span className="text-tiny text-fg-dim">{c.perMonth}</span>}
                  </p>
                  <ul className="mt-5 flex flex-1 flex-col gap-2">
                    {plan.highlights[lang].map((item) => (
                      <li key={item} className="flex gap-2 text-tiny leading-snug text-fg-muted">
                        <span className="mt-[3px] text-pos">—</span>
                        {item}
                      </li>
                    ))}
                  </ul>
                  <Link
                    href={plan.id === "free" ? (signedIn ? `/app?lang=${lang}` : `/signup?lang=${lang}`) : signedIn ? `/planos?lang=${lang}` : `/signup?lang=${lang}&plan=${plan.id}&period=monthly`}
                    data-testid={`landing-plan-${plan.id}`}
                    className={`mt-6 rounded-control px-4 py-2.5 text-center text-sm font-semibold transition ${
                      featured
                        ? "bg-action text-action-fg hover:bg-action"
                        : "border border-line-strong text-fg hover:border-line-control hover:text-fg"
                    }`}
                  >
                    {plan.id === "free" ? c.startFree : c.choosePlan}
                  </Link>
                </div>
              );
            })}
          </div>

          <p className="mt-5 text-tiny text-fg-muted">{PREPAID_NOTE[lang]}</p>
          <p className="mt-2 text-tiny text-fg-dim">
            {c.pricingPeriod}:{" "}
            {(["quarterly", "semiannual", "annual"] as const).map((period, i) => (
              <span key={period} className="nums">
                {i > 0 && " · "}
                {PERIOD[period].label[lang]} −{Math.round(PERIOD[period].discount * 100)}%
              </span>
            ))}
          </p>

          <div className="mt-10 rounded-panel border border-line bg-surface-1 p-6">
            <h3 className="text-base font-semibold text-fg">{c.pricingCoins}</h3>
            <p className="mt-2 max-w-3xl text-sm leading-relaxed text-fg-muted">{c.pricingCoinsSub}</p>
            <div className="mt-5 flex flex-wrap gap-3">
              {COIN_PACKS.map((pack) => (
                <div key={pack.id} className="rounded-panel border border-line bg-surface-2 px-5 py-3">
                  <p className="nums text-base font-semibold text-fg">
                    {pack.coins + pack.bonus}
                    <span className="ml-1 text-label font-normal text-fg-dim">coins</span>
                  </p>
                  {pack.bonus > 0 && (
                    <p className="nums text-micro text-pos">
                      +{pack.bonus} {lang === "pt" ? "bônus" : "bonus"}
                    </p>
                  )}
                  <p className="nums mt-1 text-tiny text-fg-muted">{money(pack.price, lang)}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ---- faq ---- */}
      <section className="border-b border-line">
        <div className="mx-auto max-w-6xl px-5 py-16">
          <h2 className="text-[clamp(1.6rem,3.2vw,2.3rem)] font-semibold tracking-[-0.02em] text-fg">
            {c.faqTitle}
          </h2>
          <dl className="mt-8 grid gap-px overflow-hidden rounded-panel border border-line bg-surface-3 md:grid-cols-2">
            {c.faq.map((item) => (
              <div key={item.q} className="bg-surface-1 p-6">
                <dt className="text-base font-semibold text-fg">{item.q}</dt>
                <dd className="mt-2 text-sm leading-relaxed text-fg-muted">{item.a}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* ---- final ---- */}
      <section className="border-b border-line">
        <div className="mx-auto flex max-w-6xl flex-col items-start gap-5 px-5 py-20">
          <LogoMark size={44} className="text-pos" />
          <h2 className="max-w-2xl text-[clamp(1.8rem,4vw,2.8rem)] font-semibold leading-tight tracking-[-0.025em] text-fg">
            {c.finalTitle}
          </h2>
          <p className="max-w-lg text-base text-fg-muted">{c.finalSub}</p>
          <Link
            href={{ pathname: "/signup", query: { lang } }}
            className="rounded-panel bg-action px-6 py-3 text-base font-semibold text-action-fg transition hover:bg-action"
          >
            {c.finalCta}
          </Link>
        </div>
      </section>

      <MarketingFooter lang={lang} />
    </div>
  );
}
