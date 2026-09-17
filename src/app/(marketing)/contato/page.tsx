import type { Metadata } from "next";
import { ContactForm } from "@/components/ContactForm";
import { MarketingPage } from "@/components/MarketingShell";
import { currentUser } from "@/lib/server/session";
import { supportChannels } from "@/lib/support";
import { langFrom, langPaths, pageMetadata, type SearchProps } from "@/lib/seo";

export const dynamic = "force-dynamic";

const C = {
  pt: { title: "Fale com a gente", sub: "Dúvidas, pagamento, reembolso, seus dados ou algo que não funciona: escreva aqui e respondemos no seu e-mail.", other: "Também atendemos por:", meta: "Contato do Betmatic: suporte de conta, pagamentos, reembolso e pedidos sobre dados pessoais (LGPD)." },
  en: { title: "Contact us", sub: "Questions, payments, refunds, your data or something broken: write here and we'll reply by email.", other: "You can also reach us at:", meta: "Contact Betmatic: account support, payments, refunds and personal-data (LGPD) requests." },
};

export async function generateMetadata({ searchParams }: SearchProps): Promise<Metadata> {
  const lang = await langFrom(searchParams);
  return pageMetadata({ lang, title: C[lang].title, description: C[lang].meta, paths: langPaths("/contato") });
}

export default async function ContactPage({ searchParams }: SearchProps) {
  const q = await searchParams;
  const lang = await langFrom(searchParams);
  const c = C[lang];
  const user = await currentUser();
  const support = supportChannels();
  return (
    <MarketingPage lang={lang} langHrefs={langPaths("/contato")}>
      <h1 className="text-[clamp(1.8rem,4vw,2.5rem)] font-semibold tracking-[-0.02em] text-white">{c.title}</h1>
      <p className="mt-3 text-[15px] leading-relaxed text-mist-400">{c.sub}</p>
      <div className="relative mt-8">
        <ContactForm lang={lang} defaultName={user?.name ?? ""} defaultEmail={user?.email ?? ""} defaultTopic={typeof q.topic === "string" ? q.topic : "other"} />
      </div>
      {(support.email || support.whatsapp) && (
        <p className="mt-8 flex flex-wrap gap-x-4 gap-y-1 text-[13.5px] text-mist-400">
          {c.other}
          {support.email && <a href={`mailto:${support.email}`} className="text-edge-400 hover:underline">{support.email}</a>}
          {support.whatsapp && <a href={`https://wa.me/${support.whatsapp}`} rel="noopener" className="text-edge-400 hover:underline">WhatsApp</a>}
        </p>
      )}
    </MarketingPage>
  );
}
