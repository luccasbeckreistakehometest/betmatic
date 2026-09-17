import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MarketingPage } from "@/components/MarketingShell";
import { currentUser } from "@/lib/server/session";
import { listUserPayments } from "@/lib/server/mercadopago";
import { formatDate, formatMoneyBRL } from "@/lib/format";
import type { Lang } from "@/lib/i18n";
import type { SearchParams } from "@/lib/seo";
import { paymentLabel } from "@/lib/plans";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Pagamento", robots: { index: false, follow: false } };

type Status = "sucesso" | "falhou" | "pendente";

const COPY: Record<Status, Record<Lang, { title: string; body: string }>> = {
  sucesso: {
    pt: { title: "Pagamento recebido", body: "Obrigado! Assim que o Mercado Pago confirmar — com Pix e cartão, em geral em segundos — o plano ou os coins entram na sua conta. Se a página abaixo ainda mostrar “aguardando”, atualize em um minuto." },
    en: { title: "Payment received", body: "Thank you! As soon as Mercado Pago confirms it — usually within seconds for Pix and cards — the plan or coins land in your account. If the status below still says “waiting”, refresh in a minute." },
  },
  falhou: {
    pt: { title: "O pagamento não foi concluído", body: "O Mercado Pago não aprovou esta tentativa, então nada foi liberado e nenhuma cobrança foi confirmada. Você pode tentar de novo com outro meio de pagamento." },
    en: { title: "The payment didn't go through", body: "Mercado Pago didn't approve this attempt, so nothing was unlocked and no charge was confirmed. You can try again with another payment method." },
  },
  pendente: {
    pt: { title: "Pagamento em processamento", body: "O Mercado Pago ainda está processando. Boleto pode levar até 3 dias úteis para compensar; alguns cartões passam por análise. Quando for aprovado, o plano ou os coins entram sozinhos na sua conta." },
    en: { title: "Payment processing", body: "Mercado Pago is still processing it. A boleto can take up to 3 business days to clear, and some cards go through review. Once approved, the plan or coins land in your account automatically." },
  },
};

const STATUS_LABEL: Record<string, Record<Lang, string>> = {
  pending: { pt: "aguardando confirmação", en: "waiting for confirmation" },
  approved: { pt: "aprovado", en: "approved" },
  rejected: { pt: "recusado", en: "declined" },
  refunded: { pt: "estornado", en: "refunded" },
  charged_back: { pt: "contestado", en: "charged back" },
};

export default async function PaymentResult({ params, searchParams }: { params: Promise<{ status: string }>; searchParams: SearchParams }) {
  const { status } = await params;
  if (status !== "sucesso" && status !== "falhou" && status !== "pendente") notFound();
  const q = await searchParams;
  const user = await currentUser();
  const lang: Lang = q.lang === "en" || (q.lang !== "pt" && user?.lang === "en") ? "en" : "pt";
  const c = COPY[status][lang];
  const ref = typeof q.external_reference === "string" && q.external_reference.startsWith("bm:") ? q.external_reference.slice(3) : null;
  const payments = user ? listUserPayments(user.id) : [];
  const payment = (ref ? payments.find((p) => p.id === ref) : null) ?? payments[0] ?? null;

  return (
    <MarketingPage lang={lang} langHrefs={{ pt: `/pagamento/${status}`, en: `/pagamento/${status}?lang=en` }}>
      <div data-testid={`payment-${status}`}>
        <h1 className="text-[clamp(1.7rem,4vw,2.4rem)] font-semibold tracking-[-0.02em] text-white">{c.title}</h1>
        <p className="mt-4 text-[15px] leading-relaxed text-mist-300">{c.body}</p>

        {user && payment && (
          <div className="mt-8 rounded-xl border border-ink-800 bg-ink-900/60 p-5 text-[13.5px] text-mist-300">
            <p>
              {paymentLabel(payment, lang)}
              {" · "}<span className="nums">{formatMoneyBRL(payment.amount, lang, 2)}</span>
              {" · "}{formatDate(payment.createdAt, lang, { year: true })}
            </p>
            <p className="mt-1">
              Status: <strong className="text-mist-100" data-testid="payment-row-status">{STATUS_LABEL[payment.status]?.[lang] ?? payment.status}</strong>
            </p>
            <p className="mt-3 text-[12.5px] text-mist-400">
              {lang === "pt" ? "Plano atual" : "Current plan"}: {user.plan.name}
              {user.planId !== "free" && user.planExpiresAt ? ` · ${lang === "pt" ? "até" : "until"} ${formatDate(user.planExpiresAt, lang, { year: true })}` : ""}
              {" · "}{user.coins} coins
            </p>
          </div>
        )}

        <div className="mt-8 flex flex-wrap gap-3">
          {status === "sucesso" ? (
            <Link href={`/app?lang=${lang}`} className="rounded-lg bg-edge-400 px-5 py-2.5 text-[14px] font-semibold text-ink-950 hover:bg-edge-500">{lang === "pt" ? "Ir para os jogos" : "Go to the games"}</Link>
          ) : (
            <Link href={`/planos?lang=${lang}`} className="rounded-lg bg-edge-400 px-5 py-2.5 text-[14px] font-semibold text-ink-950 hover:bg-edge-500">{lang === "pt" ? "Voltar aos planos" : "Back to plans"}</Link>
          )}
          <Link href={`/app/conta?lang=${lang}`} className="rounded-lg border border-ink-700 px-5 py-2.5 text-[14px] text-mist-200 hover:border-ink-600">{lang === "pt" ? "Minha conta" : "My account"}</Link>
          <Link href={`/contato?lang=${lang}&topic=payment`} className="rounded-lg border border-ink-700 px-5 py-2.5 text-[14px] text-mist-200 hover:border-ink-600">{lang === "pt" ? "Algo errado? Fale com a gente" : "Something wrong? Contact us"}</Link>
        </div>
      </div>
    </MarketingPage>
  );
}
