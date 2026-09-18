"use client";

import { useState } from "react";
import Link from "next/link";
import { COIN_PACKS, PERIOD, PLANS, PREPAID_NOTE, periodPrice, type BillingPeriod } from "@/lib/plans";
import { formatMoneyBRL } from "@/lib/format";
import type { Lang } from "@/lib/i18n";

const COPY = {
  pt: {
    period: "Período", perMonth: "/mês", total: "total", free: "Grátis", choose: "Escolher", current: "Seu plano atual",
    startFree: "Começar de graça", coinsTitle: "Pacotes de coins",
    coinsSub: "Coins pagam o que é feito só pra você: análise do seu bilhete (8), análise profunda (14; 8 no Max), múltipla sob medida (12), leitura do analista no raio-x do jogador (5) e raio-x de tipster além do limite do plano (6). Não expiram.",
    buy: "Comprar", bonus: "bônus", working: "Abrindo o pagamento…", popular: "Mais escolhido", save: "economize",
    paymentsOff: "Os pagamentos ainda não estão disponíveis. Fale com a gente pelo formulário de contato.",
    extends: "Comprar o mesmo plano de novo soma o novo período ao que falta.",
  },
  en: {
    period: "Period", perMonth: "/mo", total: "total", free: "Free", choose: "Choose", current: "Your current plan",
    startFree: "Start free", coinsTitle: "Coin packs",
    coinsSub: "Coins pay for work done just for you: a slip analysis (8), a deep analysis (14; 8 on Max), a custom parlay (12), the analyst read on a player deep dive (5) and a tipster audit past your plan's allowance (6). They don't expire.",
    buy: "Buy", bonus: "bonus", working: "Opening checkout…", popular: "Most popular", save: "save",
    paymentsOff: "Payments aren't available yet. Reach us through the contact form.",
    extends: "Buying the same plan again adds the new period to the time you have left.",
  },
};

const PERIODS: BillingPeriod[] = ["monthly", "quarterly", "semiannual", "annual"];

/**
 * Plan and coin purchase. Signed-out visitors go through signup carrying their choice; signed-in
 * users go straight to Mercado Pago. Prices are BRL, prepaid, no auto-renewal.
 */
export function PlanPicker({ lang, signedIn, currentPlanId, paymentsReady, initialPeriod = "monthly" }: {
  lang: Lang;
  signedIn: boolean;
  currentPlanId: string | null;
  paymentsReady: boolean;
  initialPeriod?: BillingPeriod;
}) {
  const c = COPY[lang];
  const [period, setPeriod] = useState<BillingPeriod>(initialPeriod);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function checkout(body: Record<string, string>, key: string) {
    setBusy(key);
    setError(null);
    try {
      const r = await fetch(`/api/billing/checkout?lang=${lang}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      if (r.ok && typeof j.url === "string" && /^https?:\/\//.test(j.url)) {
        window.location.assign(j.url);
        return;
      }
      setError(j.message ?? c.paymentsOff);
    } catch {
      setError(lang === "pt" ? "Sem conexão. Tente de novo." : "No connection. Try again.");
    }
    setBusy(null);
  }

  const signupFor = (params: Record<string, string>) => `/signup?${new URLSearchParams({ lang, ...params }).toString()}`;

  return (
    <div className="flex flex-col gap-10" data-testid="plan-picker">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-[12px] uppercase tracking-wider text-mist-500" id="period-label">{c.period}</span>
        <div role="radiogroup" aria-labelledby="period-label" className="flex flex-wrap overflow-hidden rounded-lg border border-ink-700">
          {PERIODS.map((p) => (
            <button
              key={p}
              type="button"
              role="radio"
              aria-checked={period === p}
              data-testid={`period-${p}`}
              onClick={() => setPeriod(p)}
              className={`px-3 py-1.5 text-[12.5px] transition ${period === p ? "bg-edge-400 font-semibold text-ink-950" : "bg-ink-900 text-mist-300 hover:text-white"}`}
            >
              {PERIOD[p].label[lang]}
              {PERIOD[p].discount > 0 && <span className="ml-1 text-[10.5px] opacity-80">−{Math.round(PERIOD[p].discount * 100)}%</span>}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {PLANS.map((plan) => {
          const featured = plan.id === "pro";
          const total = periodPrice(plan.monthlyPrice, period);
          const months = PERIOD[period].months;
          const isCurrent = currentPlanId === plan.id;
          return (
            <div key={plan.id} data-testid={`plan-${plan.id}`} className={`relative flex flex-col rounded-2xl border p-6 ${featured ? "border-edge-400/50 bg-edge-400/[0.04]" : "border-ink-800 bg-ink-900/60"}`}>
              {featured && <span className="absolute -top-2.5 left-6 rounded bg-edge-400 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-ink-950">{c.popular}</span>}
              <h3 className="text-[15px] font-semibold text-white">{plan.name}</h3>
              <p className="mt-1 text-[12px] text-mist-500">{plan.tagline[lang]}</p>
              {plan.monthlyPrice === 0 ? (
                <p className="mt-4 text-[2rem] font-semibold leading-none text-white">{c.free}</p>
              ) : (
                <div className="mt-4">
                  <p className="flex items-baseline gap-1">
                    <span className="nums text-[1.9rem] font-semibold leading-none text-white" data-testid={`price-${plan.id}`}>{formatMoneyBRL(total / months, lang)}</span>
                    <span className="text-[12px] text-mist-500">{c.perMonth}</span>
                  </p>
                  {months > 1 && (
                    <p className="nums mt-1 text-[12px] text-mist-400">{formatMoneyBRL(total, lang)} {c.total} · {months} {lang === "pt" ? "meses" : "months"}</p>
                  )}
                </div>
              )}
              <ul className="mt-5 flex flex-1 flex-col gap-2">
                {plan.highlights[lang].map((item) => (
                  <li key={item} className="flex gap-2 text-[12.5px] leading-snug text-mist-300"><span className="mt-[3px] text-edge-400" aria-hidden>—</span>{item}</li>
                ))}
              </ul>
              {isCurrent && <p className="mt-4 text-[11.5px] text-edge-400">{c.current}</p>}
              {plan.monthlyPrice === 0 ? (
                !signedIn && <Link href={signupFor({})} className="mt-6 rounded-lg border border-ink-700 px-4 py-2.5 text-center text-[13px] font-semibold text-mist-200 hover:border-ink-600">{c.startFree}</Link>
              ) : signedIn ? (
                <button
                  type="button"
                  data-testid={`buy-${plan.id}`}
                  disabled={!!busy || !paymentsReady}
                  onClick={() => void checkout({ kind: "plan", planId: plan.id, period }, plan.id)}
                  className={`mt-6 rounded-lg px-4 py-2.5 text-center text-[13px] font-semibold transition disabled:opacity-50 ${featured ? "bg-edge-400 text-ink-950 hover:bg-edge-500" : "border border-ink-700 text-mist-200 hover:border-ink-600 hover:text-white"}`}
                >
                  {busy === plan.id ? c.working : c.choose}
                </button>
              ) : (
                <Link
                  href={signupFor({ plan: plan.id, period })}
                  data-testid={`buy-${plan.id}`}
                  className={`mt-6 rounded-lg px-4 py-2.5 text-center text-[13px] font-semibold transition ${featured ? "bg-edge-400 text-ink-950 hover:bg-edge-500" : "border border-ink-700 text-mist-200 hover:border-ink-600 hover:text-white"}`}
                >
                  {c.choose}
                </Link>
              )}
            </div>
          );
        })}
      </div>

      <p className="text-[12.5px] text-mist-400" data-testid="prepaid-note">{PREPAID_NOTE[lang]} {c.extends}</p>
      {!paymentsReady && <p className="text-[12.5px] text-warn-400">{c.paymentsOff}</p>}
      {error && <p className="text-[13px] text-alert-400" role="alert" data-testid="checkout-error">{error}</p>}

      <section className="rounded-2xl border border-ink-800 bg-ink-900/60 p-6">
        <h2 className="text-[15px] font-semibold text-white">{c.coinsTitle}</h2>
        <p className="mt-2 max-w-3xl text-[13px] leading-relaxed text-mist-400">{c.coinsSub}</p>
        <div className="mt-5 flex flex-wrap gap-3">
          {COIN_PACKS.map((pack) => (
            <div key={pack.id} className="flex min-w-[10rem] flex-col rounded-xl border border-ink-800 bg-ink-850/60 px-5 py-3">
              <p className="nums text-[15px] font-semibold text-white">{pack.coins + pack.bonus}<span className="ml-1 text-[11px] font-normal text-mist-500">coins</span></p>
              {pack.bonus > 0 && <p className="nums text-[10px] text-edge-400">+{pack.bonus} {c.bonus}</p>}
              <p className="nums mt-1 text-[12px] text-mist-300">{formatMoneyBRL(pack.price, lang)}</p>
              {signedIn ? (
                <button type="button" data-testid={`buy-${pack.id}`} disabled={!!busy || !paymentsReady} onClick={() => void checkout({ kind: "coins", packId: pack.id }, pack.id)} className="mt-3 rounded-lg border border-ink-700 px-3 py-1.5 text-[12.5px] text-mist-200 transition hover:border-edge-400/50 disabled:opacity-50">
                  {busy === pack.id ? c.working : c.buy}
                </button>
              ) : (
                <Link href={signupFor({ pack: pack.id })} data-testid={`buy-${pack.id}`} className="mt-3 rounded-lg border border-ink-700 px-3 py-1.5 text-center text-[12.5px] text-mist-200 hover:border-edge-400/50">{c.buy}</Link>
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
