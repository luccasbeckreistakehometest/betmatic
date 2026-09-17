import type { Metadata } from "next";
import Link from "next/link";
import { ProofStrip } from "@/components/ProofStrip";
import { notFound } from "next/navigation";
import { LogoMark } from "@/components/Logo";
import { MarketingFooter, MarketingHeader } from "@/components/MarketingShell";
import { pageMetadata } from "@/lib/seo";
import { formatMoneyBRL } from "@/lib/format";
import { SPORT_LANDINGS, findSportLanding } from "@/lib/sport-landing";
import { landingCopy, LADDER } from "@/lib/landing-copy";
import { impliedProbability } from "@/lib/odds";
import { PLANS } from "@/lib/plans";

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

  return (
    <div className="flex min-h-full flex-col bg-ink-950">
      <MarketingHeader
        lang={lang}
        langHrefs={{ pt: `/${s.slug.pt}`, en: `/${s.slug.en}` }}
        nav={
          <nav className="ml-2 hidden items-center gap-4 text-[13px] text-mist-400 md:flex">
            {SPORT_LANDINGS.map((other) => (
              <Link
                key={other.slug[lang]}
                href={`/${other.slug[lang]}`}
                className={other.slug[lang] === sport ? "text-edge-400" : "transition hover:text-mist-100"}
              >
                {other.name[lang]}
              </Link>
            ))}
            <Link href={`/planos${lang === "en" ? "?lang=en" : ""}`} className="transition hover:text-mist-100">{c.navPricing}</Link>
          </nav>
        }
      />

      <section className="relative overflow-hidden border-b border-ink-800/80">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.055]"
          style={{
            backgroundImage:
              "linear-gradient(to right, #7d8aa0 1px, transparent 1px), linear-gradient(to bottom, #7d8aa0 1px, transparent 1px)",
            backgroundSize: "72px 72px",
          }}
        />
        <div className="relative mx-auto max-w-6xl px-5 py-16 lg:py-20">
          <div className="flex flex-wrap items-center gap-2">
            {s.leagues.map((league) => (
              <span
                key={league}
                className="rounded border border-ink-700 bg-ink-900 px-2 py-0.5 text-[11px] text-mist-400"
              >
                {league}
              </span>
            ))}
          </div>
          <h1 className="mt-5 max-w-3xl text-[clamp(2.2rem,5.4vw,3.8rem)] font-semibold leading-[1.02] tracking-[-0.035em] text-white">
            {s.title[lang]}
          </h1>
          <p className="mt-6 max-w-2xl text-[15.5px] leading-relaxed text-mist-300">{s.sub[lang]}</p>
          <div className="mt-8 flex flex-wrap items-center gap-4">
            <Link
              href={appPath}
              data-testid="sport-cta"
              className="rounded-xl bg-edge-400 px-6 py-3 text-[15px] font-semibold text-ink-950 transition hover:bg-edge-500"
            >
              {s.cta[lang]}
            </Link>
            <span className="text-[12px] text-mist-500">{c.heroCtaSub}</span>
          </div>
        </div>
      </section>

      <ProofStrip lang={lang} sportKeys={s.sportKeys} />

      <section className="border-b border-ink-800/80">
        <div className="mx-auto max-w-6xl px-5 py-16">
          <div className={`grid gap-px overflow-hidden rounded-2xl border border-ink-800 bg-ink-800 ${s.angle[lang].length > 3 ? "md:grid-cols-2 lg:grid-cols-4" : "md:grid-cols-3"}`}>
            {s.angle[lang].map((item, i) => (
              <div key={item.title} className="flex flex-col bg-ink-900/80 p-6">
                <span className="nums text-[11px] text-edge-400">{String(i + 1).padStart(2, "0")}</span>
                <h2 className="mt-3 text-[15px] font-semibold text-white">{item.title}</h2>
                <p className="mt-2 text-[13px] leading-relaxed text-mist-400">{item.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-b border-ink-800/80">
        <div className="mx-auto max-w-6xl px-5 py-16">
          <h2 className="text-[clamp(1.5rem,3vw,2.1rem)] font-semibold tracking-[-0.02em] text-white">
            {s.marketsTitle[lang]}
          </h2>
          <div className="mt-6 flex flex-wrap gap-2">
            {s.markets[lang].map((market) => (
              <span
                key={market}
                className="rounded-lg border border-ink-800 bg-ink-900/70 px-3 py-1.5 text-[12.5px] text-mist-200"
              >
                {market}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* The ladder repeats here: it is the single clearest statement of the offer. */}
      <section className="border-b border-ink-800/80">
        <div className="mx-auto grid max-w-6xl gap-10 px-5 py-16 lg:grid-cols-[1fr_1fr]">
          <div>
            <h2 className="text-[clamp(1.5rem,3vw,2.1rem)] font-semibold tracking-[-0.02em] text-white">
              {c.ladderTitle}
            </h2>
            <p className="mt-3 max-w-md text-[14px] leading-relaxed text-mist-400">{c.ladderSub}</p>
            <p className="mt-5 max-w-md border-l-2 border-ink-700 pl-4 text-[12px] leading-relaxed text-mist-500">
              {c.ladderFootnote}
            </p>
          </div>
          <ul className="flex flex-col gap-2.5">
            {LADDER.map((rung) => {
              const payout = rung.decimal * 10;
              const chance = impliedProbability(rung.decimal);
              const width = Math.max(8, (Math.log10(payout) / Math.log10(5400)) * 100);
              return (
                <li key={rung.legs} className="grid grid-cols-[auto_1fr_auto] items-center gap-x-3">
                  <span className="nums w-14 text-[11px] text-mist-500">{rung.label[lang]}</span>
                  <span className="relative flex h-8 items-center">
                    <span
                      className="absolute inset-y-0 left-0 rounded bg-gradient-to-r from-edge-500/70 to-edge-400"
                      style={{ width: `${width}%` }}
                    />
                    <span className="nums relative pl-2.5 text-[13px] font-semibold text-ink-950 mix-blend-luminosity">
                      {money(payout, lang)}
                    </span>
                  </span>
                  <span
                    className={`nums w-14 text-right text-[11.5px] ${
                      chance > 0.2 ? "text-mist-300" : chance > 0.02 ? "text-warn-400" : "text-alert-400"
                    }`}
                  >
                    {chance >= 0.01 ? `${(chance * 100).toFixed(1)}%` : `${(chance * 100).toFixed(2)}%`}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      </section>

      <section>
        <div className="mx-auto flex max-w-6xl flex-col items-start gap-5 px-5 py-20">
          <LogoMark size={44} className="text-edge-400" />
          <h2 className="max-w-2xl text-[clamp(1.7rem,3.6vw,2.6rem)] font-semibold leading-tight tracking-[-0.025em] text-white">
            {c.finalTitle}
          </h2>
          <p className="max-w-xl text-[15px] text-mist-400">
            {lang === "pt"
              ? `${s.name.pt} está no plano ${pro.name}${s.sportKeys.includes("nba") ? " (e no Starter)" : ""} — ou comece pelo grátis: um jogo por dia, você escolhe.`
              : `${s.name.en} is in the ${pro.name} plan${s.sportKeys.includes("nba") ? " (and Starter)" : ""} — or start free: one game a day, your pick.`}
          </p>
          <div className="flex flex-wrap gap-3">
            <Link
              href={signupHref}
              className="rounded-xl bg-edge-400 px-6 py-3 text-[15px] font-semibold text-ink-950 transition hover:bg-edge-500"
            >
              {c.finalCta}
            </Link>
            <Link
              href={`/planos?lang=${lang}`}
              className="rounded-xl border border-ink-700 px-6 py-3 text-[15px] font-semibold text-mist-200 transition hover:border-ink-600 hover:text-white"
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
