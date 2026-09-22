import type { Metadata } from "next";
import Link from "next/link";
import { ProofStrip } from "@/components/ProofStrip";
import { notFound } from "next/navigation";
import { LogoMark } from "@/components/Logo";
import { MarketingFooter, MarketingHeader } from "@/components/MarketingShell";
import { NumCell, Table, Td, Th, Tr, buttonClass, chanceStep } from "@/components/ui";
import { formatPercent } from "@/lib/format";
import { pageMetadata } from "@/lib/seo";
import { formatMoneyBRL } from "@/lib/format";
import { SPORT_LANDINGS, findSportLanding } from "@/lib/sport-landing";
import { landingCopy, LADDER } from "@/lib/landing-copy";
import { impliedProbability } from "@/lib/odds";
import { PLANS } from "@/lib/plans";
import { currentUser } from "@/lib/server/session";

export const dynamic = "force-dynamic";

export async function generateStaticParams() {
  return SPORT_LANDINGS.flatMap((l) => [{ sport: l.slug.pt }, { sport: l.slug.en }]);
}

export async function generateMetadata({ params }: PageProps<"/[sport]">): Promise<Metadata> {
  const { sport } = await params;
  const found = findSportLanding(sport);
  if (!found) return {};
  const { landing, lang } = found;
  return pageMetadata({
    lang,
    title: lang === "pt" ? `Palpites de ${landing.name.pt.toLowerCase()} com a chance real` : `${landing.name.en} picks with the real probability`,
    description: landing.meta[lang],
    paths: { pt: `/${landing.slug.pt}`, en: `/${landing.slug.en}` },
  });
}

const money = (value: number, lang: "pt" | "en") => formatMoneyBRL(value, lang);

export default async function SportLanding({ params }: PageProps<"/[sport]">) {
  const { sport } = await params;
  const found = findSportLanding(sport);
  // Any other top-level path falls through to a 404 rather than rendering an empty funnel.
  if (!found) notFound();

  const { landing: s, lang } = found;
  const c = landingCopy(lang);
  const pro = PLANS.find((p) => p.id === "pro")!;
  // The visitor's sport travels through signup, so the app opens on it.
  const appPath = `/app?sport=${s.sportKeys[0]}&lang=${lang}`;
  const signupHref = `/signup?lang=${lang}&next=${encodeURIComponent(appPath)}`;
  const signedIn = !!(await currentUser());
  /** A feature that lives inside the app is reached through signup while nobody is signed in. */
  const destination = (href: string) => {
    if (!href.startsWith("/app")) return `${href}?lang=${lang}`;
    const path = `${href}?sport=${s.sportKeys[0]}&lang=${lang}`;
    return signedIn ? path : `/signup?lang=${lang}&next=${encodeURIComponent(path)}`;
  };

  return (
    <div className="flex min-h-full flex-col bg-surface-0">
      <MarketingHeader
        lang={lang}
        langHrefs={{ pt: `/${s.slug.pt}`, en: `/${s.slug.en}` }}
        nav={
          <nav className="ml-2 hidden items-center gap-4 text-sm text-fg-muted md:flex">
            {SPORT_LANDINGS.map((other) => (
              <Link
                key={other.slug[lang]}
                href={`/${other.slug[lang]}`}
                className={other.slug[lang] === sport ? "text-fg" : "transition-colors duration-(--dur-1) ease-(--ease-out) hover:text-fg"}
              >
                {other.name[lang]}
              </Link>
            ))}
            <Link href={`/planos${lang === "en" ? "?lang=en" : ""}`} className="transition-colors duration-(--dur-1) ease-(--ease-out) hover:text-fg">{c.navPricing}</Link>
          </nav>
        }
      />

      <section className="border-b border-line">
        <div className="mx-auto max-w-shell px-4 py-16 sm:px-6 lg:py-20">
          <div className="flex flex-wrap items-center gap-2">
            {s.leagues.map((league) => (
              <span
                key={league}
                className="rounded-control border border-line-strong bg-surface-1 px-2 py-0.5 text-label text-fg-muted"
              >
                {league}
              </span>
            ))}
          </div>
          <h1 className="mt-5 max-w-3xl u-display text-mega text-fg">
            {s.title[lang]}
          </h1>
          <p className="mt-6 max-w-2xl text-base leading-relaxed text-fg-muted">{s.sub[lang]}</p>
          <div className="mt-8 flex flex-wrap items-center gap-4">
            <Link
              href={appPath}
              data-testid="sport-cta"
              className={buttonClass("primary")}
            >
              {s.cta[lang]}
            </Link>
            <span className="text-tiny text-fg-dim">{c.heroCtaSub}</span>
          </div>
        </div>
      </section>

      <ProofStrip lang={lang} sportKeys={s.sportKeys} />

      <section className="border-b border-line">
        <div className="mx-auto max-w-shell px-4 py-16 sm:px-6">
          <div className={`grid gap-px overflow-hidden rounded-panel border border-line bg-surface-3 ${s.angle[lang].length > 3 ? "md:grid-cols-2 lg:grid-cols-4" : "md:grid-cols-3"}`}>
            {s.angle[lang].map((item, i) => (
              <div key={item.title} className="flex flex-col bg-surface-1 p-6">
                <span className="nums text-label text-fg-dim">{String(i + 1).padStart(2, "0")}</span>
                <h2 className="mt-3 text-base font-semibold text-fg">{item.title}</h2>
                <p className="mt-2 text-sm leading-relaxed text-fg-muted">{item.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-b border-line">
        <div className="mx-auto max-w-shell px-4 py-16 sm:px-6">
          <h2 className="u-title text-h2 text-fg">
            {s.marketsTitle[lang]}
          </h2>
          <div className="mt-6 flex flex-wrap gap-2">
            {s.markets[lang].map((market) => (
              <span
                key={market}
                className="rounded-control border border-line bg-surface-1 px-3 py-1.5 text-tiny text-fg"
              >
                {market}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* Everything round 3 added, told in this sport's own terms. */}
      <section className="border-b border-line" data-testid="sport-stack">
        <div className="mx-auto max-w-shell px-4 py-16 sm:px-6">
          <h2 className="u-title text-h2 text-fg">
            {s.stackTitle[lang]}
          </h2>
          <p className="mt-2 max-w-2xl text-base leading-relaxed text-fg-muted">{s.stackSub[lang]}</p>
          {/* Nine items sit 3×3; a multiple of four fills four columns. A lone card on the last row reads as a mistake. */}
          <div className={`mt-8 grid gap-4 sm:grid-cols-2 ${s.stack[lang].length % 4 === 0 ? "lg:grid-cols-4" : "lg:grid-cols-3"}`}>
            {s.stack[lang].map((item) => (
              <Link
                key={item.title}
                href={destination(item.href)}
                className="group flex flex-col rounded-panel border border-line bg-surface-1 p-(--panel-p) transition-colors duration-(--dur-1) ease-(--ease-out) hover:border-pos"
              >
                <h3 className="text-base font-semibold text-fg">{item.title}</h3>
                <p className="mt-2 flex-1 text-sm leading-relaxed text-fg-muted">{item.body}</p>
                <span className="mt-4 text-tiny text-fg underline decoration-line-control underline-offset-2 group-hover:decoration-fg">{item.cta} →</span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* The ladder repeats here: it is the single clearest statement of the offer. */}
      <section className="border-b border-line">
        <div className="mx-auto grid max-w-shell gap-10 px-4 py-16 sm:px-6 lg:grid-cols-[1fr_1fr]">
          <div>
            <h2 className="u-title text-h2 text-fg">
              {c.ladderTitle}
            </h2>
            <p className="mt-3 max-w-md text-base leading-relaxed text-fg-muted">{c.ladderSub}</p>
            <p className="mt-5 max-w-md border-l-2 border-line-strong pl-4 text-tiny leading-relaxed text-fg-dim">
              {c.ladderFootnote}
            </p>
          </div>
          <div className="border border-line bg-surface-1" data-density="compact">
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
                  const chance = impliedProbability(rung.decimal);
                  return (
                    <Tr key={rung.legs}>
                      <Td label={c.ladderStake} className="nums whitespace-nowrap text-fg-dim">{rung.label[lang]}</Td>
                      <NumCell label={c.ladderReturns} className="text-fg">{money(rung.decimal * 10, lang)}</NumCell>
                      <NumCell label={c.ladderChance} chance={chanceStep(chance)} className="text-fg-muted">
                        {formatPercent(chance, lang, { digits: chance >= 0.01 ? 1 : 2 })}
                      </NumCell>
                    </Tr>
                  );
                })}
              </tbody>
            </Table>
          </div>
        </div>
      </section>

      <section>
        <div className="mx-auto flex max-w-6xl flex-col items-start gap-5 px-5 py-20">
          <LogoMark size={40} className="text-fg" />
          <h2 className="max-w-2xl u-display text-display text-fg">
            {c.finalTitle}
          </h2>
          <p className="max-w-xl text-base text-fg-muted">
            {lang === "pt"
              ? `${s.name.pt} está no plano ${pro.name}${s.sportKeys.includes("nba") ? " (e no Starter)" : ""} — ou comece pelo grátis: um jogo por dia, você escolhe.`
              : `${s.name.en} is in the ${pro.name} plan${s.sportKeys.includes("nba") ? " (and Starter)" : ""} — or start free: one game a day, your pick.`}
          </p>
          <div className="flex flex-wrap gap-3">
            <Link
              href={signupHref}
              className={buttonClass("primary")}
            >
              {c.finalCta}
            </Link>
            <Link
              href={`/planos?lang=${lang}`}
              className={buttonClass()}
            >
              {c.navPricing}
            </Link>
          </div>
        </div>
      </section>

      <MarketingFooter lang={lang} />
    </div>
  );
}
