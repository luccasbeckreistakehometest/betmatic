import type { Lang } from "@/lib/i18n";
import { identityBlock, type LegalDoc } from "@/lib/legal/types";

const PT: () => LegalDoc = () => ({
  title: "Reembolso e direito de arrependimento",
  description: "Como pedir reembolso no Betmatic: 7 dias de arrependimento com devolução integral (CDC art. 49), falhas nossas, estornos e contestações.",
  intro: "Toda compra no Betmatic é feita pela internet, então vale o direito de arrependimento do Código de Defesa do Consumidor. Esta página explica como pedir e o que acontece depois.",
  sections: [
    {
      title: "1. Arrependimento em até 7 dias",
      body: [
        "Você pode desistir de qualquer plano ou pacote de coins em até 7 dias corridos da confirmação do pagamento, sem precisar explicar o motivo (art. 49 do CDC). Devolvemos o valor integral, pelo mesmo meio de pagamento, via Mercado Pago.",
        {
          list: [
            "Peça pelo [formulário de contato](/contato?topic=refund), com o e-mail da conta e, se tiver, o número do pagamento (aparece em Minha conta).",
            "Confirmamos o pedido em até 5 dias úteis e solicitamos o estorno ao Mercado Pago.",
            "O prazo para o dinheiro voltar depende do meio: Pix e saldo costumam ser rápidos; no cartão, o estorno aparece na fatura seguinte ou na outra, conforme o banco.",
            "Com o estorno, o acesso do plano e os coins daquela compra são retirados da conta.",
          ],
        },
      ],
    },
    {
      title: "2. Depois dos 7 dias",
      body: [
        "Os planos são pré-pagos e não renovam sozinhos, então não há cobrança futura para cancelar. Depois do prazo de arrependimento, o período já pago não é reembolsado, salvo nos casos abaixo.",
        {
          list: [
            "Falha nossa: se um problema técnico do Betmatic impedir o uso do plano por mais de 72 horas seguidas, estendemos o período pelo tempo perdido ou devolvemos o valor proporcional, à sua escolha.",
            "Cobrança indevida ou em duplicidade: devolvemos sempre, em qualquer prazo.",
            "Coins: não são convertidos em dinheiro depois dos 7 dias. Uma análise que falhou devolve os coins automaticamente.",
          ],
        },
      ],
    },
    {
      title: "3. Contestação no cartão",
      body: [
        "Fale com a gente antes de contestar: resolvemos mais rápido pelo formulário. Se houver contestação (chargeback) ou estorno feito direto no Mercado Pago, o plano e os coins daquela compra são retirados automaticamente.",
      ],
    },
    { title: "4. Contato", body: identityBlock("pt") },
  ],
});

const EN: () => LegalDoc = () => ({
  title: "Refunds and right of withdrawal",
  description: "How to get a refund from Betmatic: a 7-day full-refund withdrawal right (Brazilian Consumer Code art. 49), our failures, reversals and chargebacks.",
  intro: "Every Betmatic purchase happens online, so the Brazilian Consumer Code's right of withdrawal applies. This page explains how to ask and what happens next.",
  sections: [
    {
      title: "1. Change of mind within 7 days",
      body: [
        "You can cancel any plan or coin pack within 7 calendar days of the payment being confirmed, without giving a reason (Consumer Code art. 49). We refund the full amount to the same payment method through Mercado Pago.",
        {
          list: [
            "Ask through the [contact form](/contato?lang=en&topic=refund) with your account email and, if you have it, the payment number (shown under My account).",
            "We confirm within 5 business days and request the reversal from Mercado Pago.",
            "How fast the money returns depends on the method: Pix and account balance are usually quick; on cards the reversal shows on the next statement or the one after, depending on the bank.",
            "Once reversed, that purchase's plan access and coins are removed from the account.",
          ],
        },
      ],
    },
    {
      title: "2. After 7 days",
      body: [
        "Plans are prepaid and never renew by themselves, so there is no future charge to cancel. After the withdrawal window, time already paid for is not refunded, except as below.",
        {
          list: [
            "Our failure: if a technical problem on our side keeps you from using a paid plan for more than 72 hours in a row, we extend your period by the time lost or refund the proportional amount, your choice.",
            "Wrong or duplicate charge: always refunded, whenever you notice it.",
            "Coins: not converted to cash after 7 days. A failed analysis returns its coins automatically.",
          ],
        },
      ],
    },
    {
      title: "3. Card disputes",
      body: [
        "Please contact us before disputing a charge: the form is faster. If a chargeback or a reversal made directly at Mercado Pago happens, that purchase's plan and coins are removed automatically.",
      ],
    },
    { title: "4. Contact", body: identityBlock("en") },
  ],
});

export function refundsDoc(lang: Lang): LegalDoc {
  return lang === "pt" ? PT() : EN();
}
