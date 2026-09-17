import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/Logo";
import { Calculators } from "@/components/Calculators";
import { normaliseLang } from "@/lib/i18n";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Calculadoras de aposta grátis — EV, múltipla, margem da casa | Betmatic",
  description: "Calculadora de valor esperado (+EV), calculadora de múltipla com margem real da casa e conversor de odds. Grátis, sem cadastro.",
};

export default async function ToolsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const q = await searchParams;
  const lang = normaliseLang(typeof q.lang === "string" ? q.lang : undefined);
  return (
    <main className="min-h-screen bg-ink-950 text-mist-100">
      <header className="border-b border-ink-800/80"><div className="mx-auto flex max-w-5xl items-center justify-between px-5 py-4"><Logo /><Link href={{ pathname: "/", query: { lang } }} className="text-[13px] text-mist-400 hover:text-mist-100">← Betmatic</Link></div></header>
      <Calculators lang={lang} />
    </main>
  );
}
