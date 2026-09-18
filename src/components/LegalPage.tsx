import Link from "next/link";
import type { ReactNode } from "react";
import { MarketingPage } from "@/components/MarketingShell";
import { formatDate } from "@/lib/format";
import { LEGAL_UPDATED, type LegalBlock, type LegalDoc } from "@/lib/legal/types";
import type { Lang } from "@/lib/i18n";

/** Renders [text](href) inside a paragraph; internal paths use Link, external ones open a new tab. */
export function RichText({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  const re = /\[([^\]]+)\]\(([^)]+)\)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const [, label, href] = m;
    parts.push(
      href.startsWith("/") ? (
        <Link key={m.index} href={href} className="text-fg underline decoration-line-control underline-offset-2 hover:decoration-fg">{label}</Link>
      ) : (
        <a key={m.index} href={href} target="_blank" rel="noopener noreferrer" className="text-fg underline decoration-line-control underline-offset-2 hover:decoration-fg">{label}</a>
      ),
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}

function Block({ block }: { block: LegalBlock }) {
  if (typeof block === "string") return <p className="mt-3 max-w-measure-legal text-body text-fg-muted"><RichText text={block} /></p>;
  return (
    <ul className="mt-3 flex max-w-measure-legal list-disc flex-col gap-2 pl-5 text-body text-fg-muted marker:text-fg-dim">
      {block.list.map((item) => <li key={item}><RichText text={item} /></li>)}
    </ul>
  );
}

export function LegalPage({ doc, lang, langHrefs, testId }: { doc: LegalDoc; lang: Lang; langHrefs: Record<Lang, string>; testId: string }) {
  return (
    <MarketingPage lang={lang} langHrefs={langHrefs}>
      <article data-testid={testId}>
        <h1 className="u-display text-display text-fg">{doc.title}</h1>
        <p className="mt-2 text-tiny text-fg-dim">
          {lang === "pt" ? "Última atualização" : "Last updated"}: {formatDate(`${LEGAL_UPDATED}T12:00:00Z`, lang, { year: true })}
        </p>
        <p className="mt-6 max-w-measure-legal text-body text-fg">{doc.intro}</p>
        {doc.sections.map((section) => (
          <section key={section.title} className="mt-9">
            <h2 className="u-title border-b border-line pb-2 text-lead text-fg">{section.title}</h2>
            {section.body.map((block, i) => <Block key={i} block={block} />)}
          </section>
        ))}
      </article>
    </MarketingPage>
  );
}
