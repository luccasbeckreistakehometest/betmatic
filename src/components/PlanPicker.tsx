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
        <span className="text-tiny u-label text-fg-dim" id="period-label">{c.period}</span>
        <div role="radiogroup" aria-labelledby="period-label" className="flex flex-wrap overflow-hidden rounded-control border border-line-strong">
          {PERIODS.map((p) => (
            <button
              key={p}
              type="button"
              role="radio"
              aria-checked={period === p}
              data-testid={`period-${p}`}
              onClick={() => setPeriod(p)}
              className={`px-3 py-1.5 text-tiny transition-colors duration-(--dur-1) ease-(--ease-out) ${period === p ? "bg-action font-semibold text-action-fg" : "bg-surface-1 text-fg-muted hover:text-fg"}`}
            >
              {PERIOD[p].label[lang]}
              {PERIOD[p].discount > 0 && <span className="ml-1 text-micro opacity-80">−{Math.round(PERIOD[p].discount * 100)}%</span>}
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
            <div key={plan.id} data-testid={`plan-${plan.id}`} className={`relative flex flex-col rounded-panel border p-6 ${featured ? "border-line-strong bg-surface-2" : "border-line bg-surface-1"}`}>
              {featured && <span className="absolute -top-2.5 left-5 bg-action px-1.5 py-0.5 text-micro u-label text-action-fg">{c.popular}</span>}
              <h3 className="text-base font-semibold text-fg">{plan.name}</h3>
              <p className="mt-1 text-tiny text-fg-dim">{plan.tagline[lang]}</p>
              {plan.monthlyPrice === 0 ? (
                <p className="mt-4 text-h3 leading-none text-fg">{c.free}</p>
              ) : (
                <div className="mt-4">
                  <p className="flex items-baseline gap-1">
                    <span className="nums text-h3 leading-none text-fg" data-testid={`price-${plan.id}`}>{formatMoneyBRL(total / months, lang)}</span>
                    <span className="text-tiny text-fg-dim">{c.perMonth}</span>
                  </p>
                  {months > 1 && (
                    <p className="nums mt-1 text-tiny text-fg-muted">{formatMoneyBRL(total, lang)} {c.total} · {months} {lang === "pt" ? "meses" : "months"}</p>
                  )}
                </div>
              )}
              <ul className="mt-5 flex flex-1 flex-col gap-2">
                {plan.highlights[lang].map((item) => (
                  <li key={item} className="flex gap-2 text-tiny leading-snug text-fg-muted"><span className="mt-[3px] text-fg-faint" aria-hidden>—</span>{item}</li>
                ))}
              </ul>
              {isCurrent && <p className="mt-4 text-tiny text-pos">{c.current}</p>}
              {plan.monthlyPrice === 0 ? (
                !signedIn && <Link href={signupFor({})} className="mt-6 inline-flex h-10 items-center justify-center rounded-control border border-line-control px-4 text-sm font-medium text-fg transition-colors duration-(--dur-1) ease-(--ease-out) hover:bg-surface-2">{c.startFree}</Link>
              ) : signedIn ? (
                <button
                  type="button"
                  data-testid={`buy-${plan.id}`}
                  disabled={!!busy || !paymentsReady}
                  onClick={() => void checkout({ kind: "plan", planId: plan.id, period }, plan.id)}
                  className={`mt-6 inline-flex h-10 items-center justify-center rounded-control px-4 text-sm font-medium transition-colors duration-(--dur-1) ease-(--ease-out) disabled:cursor-not-allowed disabled:bg-surface-3 disabled:text-fg-faint ${featured ? "bg-action text-action-fg hover:bg-action-hover" : "border border-line-control text-fg hover:bg-surface-2"}`}
                >
                  {busy === plan.id ? c.working : c.choose}
                </button>
              ) : (
                <Link
                  href={signupFor({ plan: plan.id, period })}
                  data-testid={`buy-${plan.id}`}
                  className={`mt-6 inline-flex h-10 items-center justify-center rounded-control px-4 text-sm font-medium transition-colors duration-(--dur-1) ease-(--ease-out) ${featured ? "bg-action text-action-fg hover:bg-action-hover" : "border border-line-control text-fg hover:bg-surface-2"}`}
                >
                  {c.choose}
                </Link>
              )}
            </div>
          );
        })}
      </div>

      <p className="text-tiny text-fg-muted" data-testid="prepaid-note">{PREPAID_NOTE[lang]} {c.extends}</p>
      {!paymentsReady && <p className="text-tiny text-warn">{c.paymentsOff}</p>}
      {error && <p className="text-sm text-neg" role="alert" data-testid="checkout-error">{error}</p>}

      <section className="rounded-panel border border-line bg-surface-1 p-(--panel-p)">
        <h2 className="text-base font-semibold text-fg">{c.coinsTitle}</h2>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-fg-muted">{c.coinsSub}</p>
        <div className="mt-5 flex flex-wrap gap-3">
          {COIN_PACKS.map((pack) => (
            <div key={pack.id} className="flex min-w-[10rem] flex-col rounded-panel border border-line bg-surface-2 px-5 py-3">
              <p className="nums text-base font-semibold text-fg">{pack.coins + pack.bonus}<span className="ml-1 text-label font-normal text-fg-dim">coins</span></p>
              {pack.bonus > 0 && <p className="nums text-micro text-pos">+{pack.bonus} {c.bonus}</p>}
              <p className="nums mt-1 text-tiny text-fg-muted">{formatMoneyBRL(pack.price, lang)}</p>
              {signedIn ? (
                <button type="button" data-testid={`buy-${pack.id}`} disabled={!!busy || !paymentsReady} onClick={() => void checkout({ kind: "coins", packId: pack.id }, pack.id)} className="mt-3 inline-flex items-center justify-center gap-2 h-(--row-h) rounded-control px-3 text-sm font-medium whitespace-nowrap border border-line-control text-fg transition-colors duration-(--dur-1) ease-(--ease-out) hover:bg-surface-2 active:bg-surface-3 disabled:cursor-not-allowed disabled:border-line disabled:text-fg-faint">
                  {busy === pack.id ? c.working : c.buy}
                </button>
              ) : (
                <Link href={signupFor({ pack: pack.id })} data-testid={`buy-${pack.id}`} className="mt-3 inline-flex items-center justify-center gap-2 h-(--row-h) rounded-control px-3 text-sm font-medium whitespace-nowrap border border-line-control text-fg transition-colors duration-(--dur-1) ease-(--ease-out) hover:bg-surface-2 active:bg-surface-3 disabled:cursor-not-allowed disabled:border-line disabled:text-fg-faint">{c.buy}</Link>
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
