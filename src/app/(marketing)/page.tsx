import type { Metadata } from "next";
import Link from "next/link";
import { LogoMark } from "@/components/Logo";
import { MarketingFooter, MarketingHeader } from "@/components/MarketingShell";
import { ProofStrip } from "@/components/ProofStrip";
import { Plate } from "@/components/Plate";
import { DEFAULT_META, langFrom, pageMetadata, type SearchProps } from "@/lib/seo";
import { formatMoneyBRL, formatPercent } from "@/lib/format";
import { LinkButton, NumCell, Table, Td, Th, Tr, chanceStep } from "@/components/ui";
import { currentUser } from "@/lib/server/session";
import { LADDER, landingCopy } from "@/lib/landing-copy";
import { normaliseLang } from "@/lib/i18n";
import { SPORT_LANDINGS } from "@/lib/sport-landing";
import { COIN_PACKS, PERIOD, PLANS, PREPAID_NOTE } from "@/lib/plans";
import { planRows } from "@/lib/plan-rows";
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
            {/* The five columns beside the title are the ladder's, and the ladder is the strongest
                thing on the page, so the plate becomes the panel's cover rather than displacing it.
                The one eager image on the site: on a desk it is above the fold, and on a phone it
                follows the whole left column, so the call to action is never pushed under it. */}
            <Plate
              image="/img/plate/hand-phone.webp"
              alt={c.plates.hero.alt}
              sizes="(min-width: 1280px) 470px, (min-width: 1024px) 38vw, calc(100vw - 32px)"
              priority
              flush
              className="border-b border-line"
            />
            <div className="border-b border-line px-4 py-3">
              <h2 className="text-label u-label text-fg">{c.ladderTitle}</h2>
              <p className="mt-1 text-tiny leading-relaxed text-fg-dim">{c.ladderSub}</p>
            </div>
            <Table caption={c.ladderTitle} collapse={false}>
              <thead>
                <tr>
                  <Th className="w-20">{c.ladderStake}</Th>
                  <Th numeric>{c.ladderReturns}</Th>
                  <Th numeric className="w-20">{c.ladderChance}</Th>
                </tr>
              </thead>
              <tbody>
                {LADDER.map((rung) => {
                  const payout = rung.decimal * stake;
                  const chance = impliedProbability(rung.decimal);
                  return (
                    <Tr key={rung.legs}>
                      <Td label={c.ladderStake} className="nums whitespace-nowrap text-fg-dim">{rung.label[lang]}</Td>
                      {/* No bar: the argument is already typographic. In tabular mono the payout
                          grows a digit a row while the chance loses one, and the two columns move
                          apart down the table — a drawn bar would only repeat that, badly. */}
                      <NumCell label={c.ladderReturns} className="text-fg">{money(payout, lang)}</NumCell>
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
          {/* The section is about the day's own tickets, so the picture of a handset half photograph
              half plan leads the row and the two cards stack beside it: at every width the plate is
              a column, never a full-bleed band that would be 500px tall on a tablet. */}
          <div className="mt-8 grid gap-6 md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] md:items-start">
            <Plate
              image="/img/plate/phone-blueprint.webp"
              alt={c.plates.daily.alt}
              ratio="aspect-plate-tall"
              sizes="(min-width: 1280px) 490px, (min-width: 768px) 40vw, calc(100vw - 32px)"
            />
            <div className="grid gap-4">
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
        </div>
      </section>

      {/* ---- honesty ---- */}
      <section className="border-b border-line">
        <div className="mx-auto max-w-shell px-4 py-16 sm:px-6">
          {/* A paper slip turning into the record of itself: the argument of the three points below,
              and the closest thing on the page to what the public ledger actually is. */}
          <div className="grid gap-8 md:grid-cols-[minmax(0,8fr)_minmax(0,4fr)] md:items-end">
            <div>
              <h2 className="max-w-xl u-title text-h2 text-fg">
                {c.honestyTitle}
              </h2>
              <p className="mt-2 text-base text-fg-muted">{c.honestySub}</p>
            </div>
            <Plate
              image="/img/plate/slip-tape.webp"
              alt={c.plates.honesty.alt}
              ratio="aspect-plate"
              sizes="(min-width: 1280px) 375px, (min-width: 768px) 31vw, calc(100vw - 32px)"
            />
          </div>
          <div className="mt-10 grid gap-px overflow-hidden rounded-panel border border-line bg-surface-3 md:grid-cols-3">
            {c.honestyPoints.map((point, i) => (
              <div key={point.title} className="flex flex-col bg-surface-1 p-6">
                <span className="nums text-label text-fg-dim">{String(i + 1).padStart(2, "0")}</span>
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
          {/* Eight cards fill two rows of four; six or nine sit three across. A lone card on the last row reads as a mistake. */}
          <div className={`mt-8 grid gap-4 sm:grid-cols-2 ${c.edges.length % 4 === 0 ? "lg:grid-cols-4" : "lg:grid-cols-3"}`}>
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
          {/* The only place on the page where a falling line is the argument rather than a
              contradiction: step 04 below says every ticket is graded in public, good or bad. The
              strip runs the section's width because the drawing is mostly air — in a column it
              would be a sliver beside a void — and the caption says in words that this is the
              method and not our own record. On a phone it keeps the wider ratio, or the chart
              would be 30px tall. */}
          <Plate
            image="/img/plate/ledger-line.webp"
            alt={c.plates.how.alt}
            caption={c.plates.how.caption}
            ratio="aspect-plate-wide md:aspect-plate-band"
            sizes="(min-width: 1288px) 1192px, (min-width: 640px) calc(100vw - 48px), calc(100vw - 32px)"
            className="mt-8"
          />
          <ol className="mt-10 flex flex-col gap-px overflow-hidden rounded-panel border border-line bg-surface-3">
            {c.howSteps.map((step) => (
              <li key={step.n} className="grid gap-4 bg-surface-1 p-6 sm:grid-cols-[6rem_1fr_2fr] sm:items-baseline">
                <span className="nums text-h3 leading-none text-fg-dim">{step.n}</span>
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

      {/* ---- the closing call, right before the price: the objection answered, then the button.
           The face is a model, not a byline: nobody is named, because the claim rests on the public
           record and not on whose face it is. ---- */}
      <section className="border-b border-line" data-testid="closing-cta">
        <div className="mx-auto grid max-w-shell gap-8 px-4 py-16 sm:px-6 md:grid-cols-[minmax(0,4fr)_minmax(0,8fr)] md:items-center">
          <Plate
            image="/img/plate/founder.webp"
            alt={c.plates.closing.alt}
            ratio="aspect-plate"
            sizes="(min-width: 1280px) 375px, (min-width: 768px) 31vw, calc(100vw - 32px)"
          />
          <div>
            <span className="text-label u-label text-fg-dim">{c.closingEyebrow}</span>
            <p className="mt-3 u-title text-lead text-fg">{c.closingTitle}</p>
            <p className="mt-4 max-w-measure text-base leading-relaxed text-fg-muted">{c.closingLine}</p>
            <div className="mt-7 flex flex-wrap items-center gap-3">
              <LinkButton variant="primary" href={`/signup?lang=${lang}`} data-testid="closing-cta-button" className="h-11 px-6 text-base">
                {c.closingCta}
              </LinkButton>
              <LinkButton href={`/prova?lang=${lang}`} className="h-11 px-5 text-base">
                {c.closingSecondary}
              </LinkButton>
            </div>
            <p className="mt-3 text-tiny text-fg-dim">{c.closingCtaSub}</p>
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
                  <Td label={lang === "pt" ? "O que muda" : "What differs"} className="align-top text-fg-muted">{lang === "pt" ? "Inclui" : "Includes"}</Td>
                  {PLANS.map((plan) => (
                    <Td key={plan.id} label={plan.name} className="align-top">
                      <ul className="flex flex-col gap-1 py-2 text-tiny leading-snug text-fg-muted">
                        {plan.highlights[lang].map((item) => (
                          <li key={item} className="flex gap-1.5">
                            <span aria-hidden="true" className="text-fg-dim">—</span>
                            {item}
                          </li>
                        ))}
                      </ul>
                    </Td>
                  ))}
                </Tr>
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
          {/* Ruled, not celled: nine questions in a two-column grid of filled cells paint an empty
              tenth box. Rules belong to the items, so an odd count simply ends. */}
          <dl className="mt-8 grid border-t border-line md:grid-cols-2">
            {c.faq.map((item) => (
              <div key={item.q} className="border-b border-line py-5 md:odd:border-r md:odd:pr-8 md:even:pl-8">
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
