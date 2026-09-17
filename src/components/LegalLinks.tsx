import Link from "next/link";
import type { Lang } from "@/lib/i18n";

export const LEGAL_LINKS: { href: { pt: string; en: string }; label: { pt: string; en: string } }[] = [
  { href: { pt: "/termos", en: "/terms" }, label: { pt: "Termos de uso", en: "Terms of use" } },
  { href: { pt: "/privacidade", en: "/privacy" }, label: { pt: "Privacidade (LGPD)", en: "Privacy (LGPD)" } },
  { href: { pt: "/reembolso", en: "/refunds" }, label: { pt: "Reembolso e arrependimento", en: "Refunds and withdrawal" } },
  { href: { pt: "/cookies", en: "/cookies?lang=en" }, label: { pt: "Cookies", en: "Cookies" } },
  { href: { pt: "/jogo-responsavel", en: "/responsible-gambling" }, label: { pt: "Jogo responsável", en: "Responsible gambling" } },
  { href: { pt: "/contato", en: "/contato?lang=en" }, label: { pt: "Contato", en: "Contact" } },
];

/** Footer links to every legal page and the contact form. Works in server and client trees. */
export function LegalLinks({ lang, className = "" }: { lang: Lang; className?: string }) {
  return (
    <nav aria-label={lang === "pt" ? "Informações legais" : "Legal"} className={`flex flex-wrap gap-x-4 gap-y-1.5 text-[12px] ${className}`}>
      {LEGAL_LINKS.map((l) => (
        <Link key={l.href.pt} href={l.href[lang]} className="text-mist-400 underline-offset-2 transition hover:text-mist-100 hover:underline">
          {l.label[lang]}
        </Link>
      ))}
    </nav>
  );
}
