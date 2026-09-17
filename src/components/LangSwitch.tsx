import Link from "next/link";
import { LANGS, type Lang } from "@/lib/i18n";

/** Language toggle for server-rendered pages: each option is a real link to that page's other language. */
export function LangSwitch({ lang, hrefs }: { lang: Lang; hrefs: Record<Lang, string> }) {
  return (
    <div className="flex overflow-hidden rounded-lg border border-ink-700" role="group" aria-label={lang === "pt" ? "Idioma" : "Language"}>
      {LANGS.map((l) => (
        <Link
          key={l.key}
          href={hrefs[l.key]}
          hrefLang={l.key === "pt" ? "pt-BR" : "en"}
          aria-current={lang === l.key ? "true" : undefined}
          aria-label={l.label}
          className={`px-2 py-1 text-[11px] font-medium transition ${
            lang === l.key ? "bg-ink-700 text-mist-100" : "bg-ink-900 text-mist-500 hover:text-mist-200"
          }`}
        >
          {l.flag}
        </Link>
      ))}
    </div>
  );
}
