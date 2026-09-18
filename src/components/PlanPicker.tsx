"use client";

import { useState } from "react";
import { COIN_PACKS, PERIOD, PLANS, PREPAID_NOTE, periodPrice, type BillingPeriod } from "@/lib/plans";
import { formatMoneyBRL } from "@/lib/format";
import { planRows } from "@/lib/plan-rows";
import { Button, LinkButton, NumCell, Table, Td, Th, Tr } from "@/components/ui";
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
        <div role="radiogroup" aria-labelledby="period-label" className="flex flex-wrap overflow-hidden rounded-control border border-line-control">
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

      {/* The landing compares the tiers in a table; the page where money changes hands must not
          go back to four cards of unequal height, where a Free column ends in 180px of nothing. */}
      <div className="border border-line bg-surface-1" data-density="default">
        <Table caption={c.coinsTitle} collapse={false}>
          <thead>
            <tr>
              <Th className="min-w-36">{lang === "pt" ? "O que muda" : "What differs"}</Th>
              {PLANS.map((plan) => (
                <Th key={plan.id} numeric className="min-w-28">
                  {plan.name}
                  {plan.id === "pro" && <span className="ml-1.5 text-micro u-label text-fg-dim">{c.popular}</span>}
                </Th>
              ))}
            </tr>
          </thead>
          <tbody>
            <Tr>
              <Td label={lang === "pt" ? "O que muda" : "What differs"} className="text-fg-muted">{c.perMonth.replace("/", "")}</Td>
              {PLANS.map((plan) => {
                const total = periodPrice(plan.monthlyPrice, period);
                const months = PERIOD[period].months;
                return (
                  <NumCell key={plan.id} label={plan.name} className="text-fg">
                    <span data-testid={`price-${plan.id}`}>{plan.monthlyPrice === 0 ? c.free : formatMoneyBRL(total / months, lang)}</span>
                    {plan.monthlyPrice > 0 && months > 1 && (
                      <span className="mt-0.5 block text-micro font-normal text-fg-dim">{formatMoneyBRL(total, lang)} {c.total}</span>
                    )}
                  </NumCell>
                );
              })}
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
                      <li key={item} className="flex gap-1.5"><span aria-hidden="true" className="text-fg-dim">—</span>{item}</li>
                    ))}
                  </ul>
                </Td>
              ))}
            </Tr>
            <Tr>
              <Td label="" />
              {PLANS.map((plan) => (
                <Td key={plan.id} numeric label={plan.name} className="align-top">
                  {currentPlanId === plan.id ? (
                    <span className="text-tiny text-fg-muted">{c.current}</span>
                  ) : plan.monthlyPrice === 0 ? (
                    signedIn ? <span className="text-tiny text-fg-dim">—</span> : <LinkButton href={signupFor({})}>{c.startFree}</LinkButton>
                  ) : signedIn ? (
                    <Button
                      variant={plan.id === "pro" ? "primary" : "secondary"}
                      data-testid={`buy-${plan.id}`}
                      disabled={!!busy || !paymentsReady}
                      loading={busy === plan.id}
                      onClick={() => void checkout({ kind: "plan", planId: plan.id, period }, plan.id)}
                    >
                      {busy === plan.id ? c.working : c.choose}
                    </Button>
                  ) : (
                    <LinkButton
                      variant={plan.id === "pro" ? "primary" : "secondary"}
                      href={signupFor({ plan: plan.id, period })}
                      data-testid={`buy-${plan.id}`}
                    >
                      {c.choose}
                    </LinkButton>
                  )}
                </Td>
              ))}
            </Tr>
          </tbody>
        </Table>
      </div>

      <p className="text-tiny text-fg-muted" data-testid="prepaid-note">{PREPAID_NOTE[lang]} {c.extends}</p>
      {!paymentsReady && <p className="text-tiny text-warn">{c.paymentsOff}</p>}
      {error && <p className="text-sm text-neg" role="alert" data-testid="checkout-error">{error}</p>}

      <section className="rounded-panel border border-line bg-surface-1 p-(--panel-p)">
        <h2 className="text-base font-semibold text-fg">{c.coinsTitle}</h2>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-fg-muted">{c.coinsSub}</p>
        {/* Three prices a buyer compares must sit on one baseline: as cards, "R$ 19" floated 18px
            above "R$ 59" because the first pack has no bonus line. A table cannot do that. */}
        <div className="mt-5 border border-line" data-density="default">
          <Table caption={c.coinsTitle} collapse={false}>
            <thead>
              <tr>
                <Th>Coins</Th>
                <Th numeric>{c.bonus}</Th>
                <Th numeric>{lang === "pt" ? "Preço" : "Price"}</Th>
                <Th numeric className="w-px" />
              </tr>
            </thead>
            <tbody>
              {COIN_PACKS.map((pack) => (
                <Tr key={pack.id}>
                  <Td label="Coins" className="font-medium text-fg"><span className="nums">{pack.coins + pack.bonus}</span></Td>
                  <NumCell label={c.bonus} className={pack.bonus > 0 ? "text-pos" : "text-fg-dim"}>
                    {pack.bonus > 0 ? `+${pack.bonus}` : "—"}
                  </NumCell>
                  <NumCell label={lang === "pt" ? "Preço" : "Price"} className="text-fg">{formatMoneyBRL(pack.price, lang)}</NumCell>
                  <Td numeric label="">
                    {signedIn ? (
                      <Button data-testid={`buy-${pack.id}`} disabled={!!busy || !paymentsReady} loading={busy === pack.id} onClick={() => void checkout({ kind: "coins", packId: pack.id }, pack.id)}>
                        {busy === pack.id ? c.working : c.buy}
                      </Button>
                    ) : (
                      <LinkButton href={signupFor({ pack: pack.id })} data-testid={`buy-${pack.id}`}>{c.buy}</LinkButton>
                    )}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </div>
      </section>
    </div>
  );
}
