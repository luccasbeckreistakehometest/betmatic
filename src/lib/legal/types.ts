import type { Lang } from "@/lib/i18n";
import { legalIdentity, supportChannels } from "@/lib/support";

/** Paragraphs may carry [text](/path) links; `list` renders as bullets. */
export type LegalBlock = string | { list: string[] };
export interface LegalSection { title: string; body: LegalBlock[] }
export interface LegalDoc { title: string; description: string; intro: string; sections: LegalSection[] }

/** Date shown as "última atualização" and stored with each signup's consent (users.TERMS_VERSION). */
export const LEGAL_UPDATED = "2026-09-17";

export const CONTACT_PATH: Record<Lang, string> = { pt: "/contato", en: "/contato?lang=en" };

/**
 * Who is responsible, from env only. Missing lines are left out; the contact form is always there.
 */
export function identityBlock(lang: Lang): LegalBlock[] {
  const id = legalIdentity();
  const support = supportChannels();
  const pt = lang === "pt";
  const lines: string[] = [];
  if (id.name) lines.push(`${pt ? "Responsável" : "Operator"}: ${id.name}`);
  if (id.document) lines.push(`${pt ? "CPF/CNPJ" : "Tax ID (CPF/CNPJ)"}: ${id.document}`);
  if (id.address) lines.push(`${pt ? "Endereço" : "Address"}: ${id.address}`);
  if (id.email) lines.push(`E-mail: ${id.email}`);
  if (support.email && support.email !== id.email) lines.push(`${pt ? "Suporte" : "Support"}: ${support.email}`);
  const out: LegalBlock[] = [];
  if (lines.length) out.push({ list: lines });
  out.push(
    pt
      ? `Para qualquer assunto — dúvidas, pedidos sobre seus dados, reembolso — use o [formulário de contato](${CONTACT_PATH.pt}). Respondemos em até 5 dias úteis; pedidos sobre dados pessoais, em até 15 dias.`
      : `For anything — questions, requests about your data, refunds — use the [contact form](${CONTACT_PATH.en}). We answer within 5 business days; personal-data requests within 15 days.`,
  );
  return out;
}

/** "o responsável pelo Betmatic" unless LEGAL_NAME is set. */
export function controllerName(lang: Lang): string {
  return legalIdentity().name ?? (lang === "pt" ? "o responsável pelo Betmatic, identificado acima quando disponível" : "the operator of Betmatic, named above when available");
}
