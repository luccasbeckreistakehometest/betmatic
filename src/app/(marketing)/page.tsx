import type { Metadata } from "next";
import Link from "next/link";
import { LogoMark } from "@/components/Logo";
import { MarketingFooter, MarketingHeader } from "@/components/MarketingShell";
import { ProofStrip } from "@/components/ProofStrip";
import { DEFAULT_META, langFrom, pageMetadata, type SearchProps } from "@/lib/seo";
import { formatMoneyBRL, formatPercent } from "@/lib/format";
import { LinkButton, NumCell, Table, Td, Th, Tr, chanceStep } from "@/components/ui";
import { currentUser } from "@/lib/server/session";
import { LADDER, landingCopy } from "@/lib/landing-copy";
import { normaliseLang } from "@/lib/i18n";
import { SPORT_LANDINGS } from "@/lib/sport-landing";
import { COIN_PACKS, PERIOD, PLANS, PREPAID_NOTE, type Plan } from "@/lib/plans";
import { impliedProbability } from "@/lib/odds";

export const dynamic = "force-dynamic";

export async function generateMetadata({ searchParams }: SearchProps): Promise<Metadata> {
  const lang = await langFrom(searchParams);
  const meta = pageMetadata({ lang, ...DEFAULT_META[lang], paths: { pt: "/", en: "/?lang=en" } });
  return { ...meta, title: { absolute: DEFAULT_META[lang].title } };
}

/** The rows of the plan comparison: only what actually differs between tiers, in the model's own
 *  fields, so the table can never drift from what the code enforces. */
function planRows(lang: "pt" | "en"): { label: string; value: (plan: Plan) => string }[] {
  const yes = lang === "pt" ? "sim" : "yes";
  const no = "—";
  return [
    { label: lang === "pt" ? "Jogos por dia" : "Games a day", value: (p) => (p.gamesPerDay === null ? (lang === "pt" ? "todos" : "all") : String(p.gamesPerDay)) },
    { label: lang === "pt" ? "Faixas de odds" : "Odds bands", value: (p) => String(p.bands.length) },
    { label: lang === "pt" ? "Esportes" : "Sports", value: (p) => (p.sports.length === 0 ? (lang === "pt" ? "todos" : "all") : String(p.sports.length)) },
    { label: lang === "pt" ? "Múltiplas entre jogos" : "Cross-game parlays", value: (p) => (p.crossGame ? yes : no) },
    { label: lang === "pt" ? "Atraso dos destaques" : "Featured delay", value: (p) => (p.delayMinutes ? `${p.delayMinutes} min` : lang === "pt" ? "nenhum" : "none") },
    { label: lang === "pt" ? "Coins no período" : "Coins per period", value: (p) => (p.coinsPerPeriod ? String(p.coinsPerPeriod) : no) },
    { label: lang === "pt" ? "Histórico completo" : "Full track record", value: (p) => (p.trackRecord ? yes : no) },
  ];
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
    <div className="flex min-h-full flex-col bg-surface-0" data-density="comfortable">
      <MarketingHeader
        lang={lang}
        langHrefs={{ pt: "/", en: "/?lang=en" }}
        nav={
          <nav className="ml-4 hidden items-center gap-5 text-sm text-fg-muted md:flex">
            <a href="#como" className="transition-colors duration-(--dur-1) ease-(--ease-out) hover:text-fg">{c.navHow}</a>
            <a href="#esportes" className="transition-colors duration-(--dur-1) ease-(--ease-out) hover:text-fg">{c.navSports}</a>
            <Link href={{ pathname: "/planos", query: { lang } }} className="transition-colors duration-(--dur-1) ease-(--ease-out) hover:text-fg">{c.navPricing}</Link>
            <Link href={{ pathname: "/prova", query: { lang } }} className="transition-colors duration-(--dur-1) ease-(--ease-out) hover:text-fg">{lang === "pt" ? "Prova" : "Track record"}</Link>
            <Link href={{ pathname: "/ferramentas", query: { lang } }} className="transition-colors duration-(--dur-1) ease-(--ease-out) hover:text-fg">{lang === "pt" ? "Ferramentas" : "Free tools"}</Link>
          </nav>
        }
      />

      {/* ---- hero: type, a real grid, and the product's own output as the visual ---- */}
      <section className="border-b border-line">
        <div className="mx-auto grid max-w-shell items-start gap-10 px-4 py-14 sm:px-6 lg:grid-cols-12 lg:gap-12 lg:py-20">
          <div className="flex flex-col lg:col-span-7">
            <span className="text-label u-label text-fg-dim">{c.heroKicker}</span>
            <h1 className="u-display mt-5 text-mega text-fg">
              {c.heroTitle[0]}
              <br />
              <span className="text-fg-dim">{c.heroTitle[1]}</span>
            </h1>
            <p className="mt-6 max-w-measure text-body text-fg-muted">{c.heroSub}</p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <LinkButton variant="primary" href={`/signup?lang=${lang}`} data-testid="hero-cta" className="h-11 px-6 text-base">
                {c.heroCta}
              </LinkButton>
              <LinkButton href={`/app?lang=${lang}`} className="h-11 px-5 text-base">
                {c.heroSecondary}
              </LinkButton>
            </div>
            <p className="mt-3 text-tiny text-fg-dim">{c.heroCtaSub}</p>
            <p className="mt-8 max-w-measure border-l-2 border-line-strong pl-4 text-tiny leading-relaxed text-fg-dim">
              {c.heroProof}
            </p>
          </div>

          {/* ---- the ladder: the product's real output, as the table it is ---- */}
          <div className="border border-line bg-surface-1 lg:col-span-5" data-density="compact">
            <div className="border-b border-line px-4 py-3">
              <h2 className="text-label u-label text-fg">{c.ladderTitle}</h2>
              <p className="mt-1 text-tiny leading-relaxed text-fg-dim">{c.ladderSub}</p>
            </div>
            <Table caption={c.ladderTitle} collapse={false}>
              <thead>
                <tr>
                  <Th className="w-16">{c.ladderStake}</Th>
                  <Th>{c.ladderReturns}</Th>
                  <Th numeric className="w-20">{c.ladderChance}</Th>
                </tr>
              </thead>
              <tbody>
                {LADDER.map((rung) => {
                  const payout = rung.decimal * stake;
                  const chance = impliedProbability(rung.decimal);
                  const width = Math.max(6, (Math.log10(payout) / Math.log10(maxReturn)) * 100);
                  return (
                    <Tr key={rung.legs}>
                      <Td label={c.ladderStake} className="nums text-fg-dim">{rung.label[lang]}</Td>
                      <Td label={c.ladderReturns} className="relative">
                        {/* A measurement, so it is a rule under the figure at one ink value — not a
                            filled box, which would read as a field, and never a gradient. */}
                        <span className="nums text-fg">{money(payout, lang)}</span>
                        <span aria-hidden="true" className="absolute bottom-1 left-(--cell-px) h-px bg-fg-dim" style={{ width: `calc(${width}% - var(--cell-px))` }} />
                      </Td>
                      {/* The chance is always printed beside the multiplier: the product's point,
                          and the Brazilian advertising rule. The ramp paints the rule, not the text. */}
                      <NumCell label={c.ladderChance} chance={chanceStep(chance)} className="text-fg-muted">
                        {formatPercent(chance, lang, { digits: chance >= 0.01 ? 1 : 2 })}
                      </NumCell>
                    </Tr>
                  );
                })}
              </tbody>
            </Table>
            <p className="border-t border-line px-4 py-3 text-tiny leading-relaxed text-fg-dim">{c.ladderFootnote}</p>
          </div>
        </div>
      </section>

      <ProofStrip lang={lang} />

      {/* ---- what runs on its own: the day's featured games, and the closing line ---- */}
      <section className="border-b border-line" data-testid="daily">
        <div className="mx-auto max-w-shell px-4 py-16 sm:px-6">
          <h2 className="max-w-2xl u-title text-h2 text-fg">
            {c.dailyTitle}
          </h2>
          <p className="mt-2 max-w-2xl text-base leading-relaxed text-fg-muted">{c.dailySub}</p>
          <div className="mt-8 grid gap-4 md:grid-cols-2">
            {c.daily.map((item) => (
              <div key={item.title} className="flex flex-col rounded-panel border border-line bg-surface-1 p-(--panel-p)">
                <h3 className="text-body font-semibold text-fg">{item.title}</h3>
                <p className="mt-2 flex-1 text-sm leading-relaxed text-fg-muted">{item.body}</p>
                <Link
                  href={{ pathname: item.href, query: { lang } }}
                  className="mt-4 self-start text-sm text-fg underline underline-offset-2 decoration-line-control hover:decoration-fg"
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
        <div className="mx-auto max-w-shell px-4 py-16 sm:px-6">
          <h2 className="max-w-xl u-title text-h2 text-fg">
            {c.honestyTitle}
          </h2>
          <p className="mt-2 text-base text-fg-muted">{c.honestySub}</p>
          <div className="mt-10 grid gap-px overflow-hidden rounded-panel border border-line bg-surface-3 md:grid-cols-3">
            {c.honestyPoints.map((point, i) => (
              <div key={point.title} className="flex flex-col bg-surface-1 p-6">
                <span className="nums text-label text-fg-faint">{String(i + 1).padStart(2, "0")}</span>
                <h3 className="mt-3 text-base font-semibold text-fg">{point.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-fg-muted">{point.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---- edge ---- */}
      <section className="border-b border-line" data-testid="edge">
        <div className="mx-auto max-w-shell px-4 py-16 sm:px-6">
          <h2 className="u-title text-h2 text-fg">{c.edgeTitle}</h2>
          <p className="mt-3 max-w-2xl text-base text-fg-muted">{c.edgeSub}</p>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {c.edges.map((e) => (
              <Link key={e.title} href={{ pathname: e.href, query: { lang } }} className="group rounded-panel border border-line bg-surface-1 p-(--panel-p) transition-colors duration-(--dur-1) ease-(--ease-out) hover:border-line-control hover:bg-surface-2">
                <p className="text-base font-semibold text-fg">{e.title}</p>
                <p className="mt-2 text-sm leading-relaxed text-fg-muted">{e.body}</p>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* ---- how ---- */}
      <section id="como" className="border-b border-line">
        <div className="mx-auto max-w-shell px-4 py-16 sm:px-6">
          <h2 className="u-title text-h2 text-fg">
            {c.howTitle}
          </h2>
          <ol className="mt-10 flex flex-col gap-px overflow-hidden rounded-panel border border-line bg-surface-3">
            {c.howSteps.map((step) => (
              <li key={step.n} className="grid gap-4 bg-surface-1 p-6 sm:grid-cols-[6rem_1fr_2fr] sm:items-baseline">
                <span className="nums text-h3 leading-none text-fg-faint">{step.n}</span>
                <h3 className="text-base font-semibold text-fg">{step.title}</h3>
                <p className="text-sm leading-relaxed text-fg-muted">{step.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ---- per-sport funnel ---- */}
      <section id="esportes" className="border-b border-line">
        <div className="mx-auto max-w-shell px-4 py-16 sm:px-6">
          <h2 className="u-title text-h2 text-fg">
            {c.sportsTitle}
          </h2>
          <p className="mt-2 max-w-2xl text-base text-fg-muted">{c.sportsSub}</p>
          <div className="mt-10 flex flex-col gap-4">
            {c.sports.map((sport) => (
              <Link
                key={sport.key}
                href={`/${SPORT_LANDINGS.find((l) => l.sportKeys.some((k) => k.startsWith(sport.key === "basketball" ? "nba" : "soccer")))?.slug[lang] ?? ""}`}
                className="group grid gap-5 rounded-panel border border-line bg-surface-1 p-(--panel-p) transition-colors duration-(--dur-1) ease-(--ease-out) hover:border-line-control hover:bg-surface-2 md:grid-cols-[1fr_1.5fr]"
              >
                <div>
                  <h3 className="u-title text-lead text-fg">{sport.name}</h3>
                  <p className="mt-1 text-sm font-medium text-fg-muted">{sport.hook}</p>
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
        <div className="mx-auto max-w-shell px-4 py-16 sm:px-6">
          <h2 className="u-title text-h2 text-fg">
            {c.pricingTitle}
          </h2>
          <p className="mt-2 text-base text-fg-muted">{c.pricingSub}</p>

          {/* Four equal cards cannot be compared; a table can. One row per thing that differs. */}
          <div className="mt-10 border border-line bg-surface-1" data-density="default">
            <Table caption={c.pricingTitle} collapse={false}>
              <thead>
                <tr>
                  <Th className="min-w-36">{lang === "pt" ? "O que muda" : "What differs"}</Th>
                  {PLANS.map((plan) => (
                    <Th key={plan.id} numeric className="min-w-28">
                      {plan.name}
                    </Th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <Tr>
                  <Td label={lang === "pt" ? "O que muda" : "What differs"} className="text-fg-muted">{c.perMonth.replace("/", "")}</Td>
                  {PLANS.map((plan) => (
                    <NumCell key={plan.id} label={plan.name} className="text-fg">
                      {plan.monthlyPrice === 0 ? (lang === "pt" ? "Grátis" : "Free") : money(plan.monthlyPrice, lang)}
                    </NumCell>
                  ))}
                </Tr>
                {planRows(lang).map((row) => (
                  <Tr key={row.label}>
                    <Td label={lang === "pt" ? "O que muda" : "What differs"} className="text-fg-muted">{row.label}</Td>
                    {PLANS.map((plan) => (
                      <NumCell key={plan.id} label={plan.name} className="text-fg">{row.value(plan)}</NumCell>
                    ))}
                  </Tr>
                ))}
                <Tr>
                  <Td label="" />
                  {PLANS.map((plan) => (
                    <Td key={plan.id} numeric label={plan.name}>
                      <LinkButton
                        variant={plan.id === "pro" ? "primary" : "secondary"}
                        href={plan.id === "free" ? (signedIn ? `/app?lang=${lang}` : `/signup?lang=${lang}`) : signedIn ? `/planos?lang=${lang}` : `/signup?lang=${lang}&plan=${plan.id}&period=monthly`}
                        data-testid={`landing-plan-${plan.id}`}
                      >
                        {plan.id === "free" ? c.startFree : c.choosePlan}
                      </LinkButton>
                    </Td>
                  ))}
                </Tr>
              </tbody>
            </Table>
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

          <div className="mt-10 rounded-panel border border-line bg-surface-1 p-(--panel-p)">
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
                    <p className="nums text-micro text-fg-muted">
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
        <div className="mx-auto max-w-shell px-4 py-16 sm:px-6">
          <h2 className="u-title text-h2 text-fg">
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
        <div className="mx-auto flex max-w-shell flex-col items-start gap-5 px-4 py-20 sm:px-6">
          <LogoMark size={40} className="text-fg" />
          <h2 className="max-w-2xl u-display text-display text-fg">
            {c.finalTitle}
          </h2>
          <p className="max-w-lg text-base text-fg-muted">{c.finalSub}</p>
          <Link
            href={{ pathname: "/signup", query: { lang } }}
            className="inline-flex h-11 items-center rounded-control bg-action px-6 text-base font-medium text-action-fg transition-colors duration-(--dur-1) ease-(--ease-out) hover:bg-action-hover"
          >
            {c.finalCta}
          </Link>
        </div>
      </section>

      <MarketingFooter lang={lang} />
    </div>
  );
}
