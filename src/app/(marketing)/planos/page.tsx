import type { Metadata } from "next";
import { MarketingPage } from "@/components/MarketingShell";
import { PlanPicker } from "@/components/PlanPicker";
import { currentUser } from "@/lib/server/session";
import { mpConfigured } from "@/lib/server/mercadopago";
import { normaliseLang } from "@/lib/i18n";
import { langFrom, langPaths, pageMetadata, type SearchProps } from "@/lib/seo";
import { formatDate } from "@/lib/format";
import type { BillingPeriod } from "@/lib/plans";

export const dynamic = "force-dynamic";

const COPY = {
  pt: { title: "Planos e preços", sub: "Escolha o período, pague uma vez e use até o fim. Sem renovação automática, sem fidelidade. Valores em reais (R$), pagos pelo Mercado Pago (Pix, cartão ou boleto).", expires: "Seu plano {plan} vale até {date}.", expired: "Seu plano {plan} venceu em {date}.", checkoutFailed: "Sua conta foi criada, mas o pagamento não abriu. Escolha o plano de novo abaixo; se continuar, fale com a gente pelo contato.", meta: "Planos pré-pagos do Betmatic: basquete e futebol, múltiplas entre jogos e coins para analisar seu bilhete. Pagamento único pelo Mercado Pago, sem renovação automática." },
  en: { title: "Plans and pricing", sub: "Pick a period, pay once and use it to the end. No auto-renewal, no lock-in. Prices are in Brazilian reais (BRL), paid through Mercado Pago.", expires: "Your {plan} plan runs until {date}.", expired: "Your {plan} plan ended on {date}.", checkoutFailed: "Your account is ready, but the payment page did not open. Pick the plan again below; if it keeps failing, reach us through the contact form.", meta: "Betmatic prepaid plans: basketball and soccer, cross-game parlays and coins to analyse your own slip. One-time payment in BRL via Mercado Pago, no auto-renewal." },
};

export async function generateMetadata({ searchParams }: SearchProps): Promise<Metadata> {
  const lang = await langFrom(searchParams);
  return pageMetadata({ lang, title: COPY[lang].title, description: COPY[lang].meta, paths: langPaths("/planos") });
}

const PERIODS = new Set(["monthly", "quarterly", "semiannual", "annual"]);

export default async function PlansPage({ searchParams }: SearchProps) {
  const q = await searchParams;
  const lang = normaliseLang(typeof q.lang === "string" ? q.lang : undefined);
  const c = COPY[lang];
  const user = await currentUser();
  const period = typeof q.period === "string" && PERIODS.has(q.period) ? (q.period as BillingPeriod) : "monthly";
  const status = user && user.planId !== "free" && user.planExpiresAt
    ? (user.planActive ? c.expires : c.expired).replace("{plan}", user.planId.toUpperCase()).replace("{date}", formatDate(user.planExpiresAt, lang, { year: true }))
    : null;

  return (
    <MarketingPage lang={lang} langHrefs={langPaths("/planos")} wide>
      <h1 className="text-[clamp(1.8rem,4vw,2.6rem)] font-semibold tracking-[-0.02em] text-white">{c.title}</h1>
      <p className="mt-3 max-w-2xl text-[14.5px] leading-relaxed text-mist-400">{c.sub}</p>
      {q.checkout === "falhou" && <p role="alert" className="mt-4 rounded-lg border border-warn-400/30 bg-warn-400/5 px-4 py-2.5 text-[13px] text-warn-400" data-testid="checkout-failed">{c.checkoutFailed}</p>}
      {status && <p className="mt-4 rounded-lg border border-ink-800 bg-ink-900/60 px-4 py-2.5 text-[13px] text-mist-200" data-testid="plan-status">{status}</p>}
      <div className="mt-10">
        <PlanPicker lang={lang} signedIn={!!user} currentPlanId={user?.planActive ? user.plan.id : null} paymentsReady={mpConfigured()} initialPeriod={period} />
      </div>
    </MarketingPage>
  );
}
