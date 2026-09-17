"use client";

import { useEffect, useState } from "react";
import { Empty, Panel } from "@/components/ui";
import { useNavState } from "@/components/Controls";

interface Payload { code: string; invited: number; coinsEarned: number; coinsPerInvite: number; link: string; error?: string }

const C = {
  pt: { title: "Indique e ganhe", intro: (n: number) => `Cada amigo que criar conta pelo seu link ganha ${n} coins — e você também. Coins geram bilhetes.`, link: "Seu link", copy: "Copiar", copied: "Copiado", wa: "Mandar no WhatsApp", invited: "indicados", earned: "coins ganhos", signIn: "Entre na sua conta para pegar seu link.",
    waText: (link: string) => `Tô usando o Betmatic pra montar bilhete com dado de verdade e histórico público. Cria a conta pelo meu link que a gente ganha coins: ${link}` },
  en: { title: "Invite & earn", intro: (n: number) => `Every friend who signs up through your link gets ${n} coins — and so do you. Coins build tickets.`, link: "Your link", copy: "Copy", copied: "Copied", wa: "Share on WhatsApp", invited: "invited", earned: "coins earned", signIn: "Sign in to get your link.",
    waText: (link: string) => `I'm using Betmatic to build tickets from real data with a public track record. Sign up through my link and we both get coins: ${link}` },
};

export function ReferralPanel() {
  const { lang } = useNavState();
  const c = C[lang];
  const [data, setData] = useState<Payload | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => { const id = setTimeout(() => { fetch("/api/referral", { cache: "no-store" }).then((r) => r.json()).then(setData); }, 0); return () => clearTimeout(id); }, []);
  if (data?.error) return <Panel title={c.title}><Empty>{c.signIn}</Empty></Panel>;
  return (
    <Panel title={c.title} meta={data ? `${data.invited} ${c.invited} · ${data.coinsEarned} ${c.earned}` : undefined}>
      <p className="text-[13px] text-mist-400">{c.intro(data?.coinsPerInvite ?? 5)}</p>
      {data && (
        <div className="mt-4 flex flex-wrap items-center gap-2" data-testid="referral">
          <span className="text-[12px] text-mist-500">{c.link}</span>
          <code className="nums rounded-lg border border-ink-700 bg-ink-900 px-3 py-2 text-[13px] text-mist-100" data-testid="referral-link">{data.link}</code>
          <button onClick={() => { navigator.clipboard?.writeText(data.link).catch(() => {}); setCopied(true); setTimeout(() => setCopied(false), 1500); }} className="rounded-lg border border-ink-700 px-3 py-2 text-[12px] text-mist-300 hover:border-ink-600 hover:text-mist-100">{copied ? c.copied : c.copy}</button>
          <a href={`https://wa.me/?text=${encodeURIComponent(c.waText(data.link))}`} target="_blank" rel="noopener noreferrer" className="rounded-lg bg-signal-400/15 px-3 py-2 text-[12px] font-semibold text-signal-400 hover:bg-signal-400/25">{c.wa}</a>
        </div>
      )}
    </Panel>
  );
}
