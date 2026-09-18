import Link from "next/link";
import { LANGS, type Lang } from "@/lib/i18n";

/**
 * Language toggle for server-rendered pages: each option is a real link to that page's other
 * language. A flag is not a language — Portuguese is not Brazil and English is not the United
 * States — so the control says PT and EN, which also survives a monochrome palette (§10.2).
 */
export function LangSwitch({ lang, hrefs }: { lang: Lang; hrefs: Record<Lang, string> }) {
  return (
    <div className="flex overflow-hidden rounded-control border border-line-control" role="group" aria-label={lang === "pt" ? "Idioma" : "Language"}>
      {LANGS.map((l) => (
        <Link
          key={l.key}
          href={hrefs[l.key]}
          hrefLang={l.key === "pt" ? "pt-BR" : "en"}
          aria-current={lang === l.key ? "true" : undefined}
          aria-label={l.label}
          className={`px-1.5 py-1 text-micro u-label transition-colors duration-(--dur-1) ${
            lang === l.key ? "bg-action text-action-fg" : "bg-surface-1 text-fg-dim hover:text-fg"
          }`}
        >
          {l.key.toUpperCase()}
        </Link>
      ))}
    </div>
  );
}
