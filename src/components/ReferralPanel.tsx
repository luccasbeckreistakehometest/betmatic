"use client";

import { useEffect, useState } from "react";
import { Empty, Panel } from "@/components/ui";
import { useNavState } from "@/components/Controls";

interface Payload { code: string; invited: number; coinsEarned: number; coinsPerInvite: number; link: string; error?: string }

const C = {
  pt: { title: "Indique e ganhe", intro: (n: number) => `Quando um amigo que criou conta pelo seu link faz a primeira compra, ele ganha ${n} coins — e você também. Coins pagam a análise do seu bilhete.`, link: "Seu link", copy: "Copiar", copied: "Copiado", wa: "Mandar no WhatsApp", invited: "indicados", earned: "coins ganhos", signIn: "Entre na sua conta para pegar seu link.",
    waText: (link: string) => `Tô usando o Betmatic pra montar bilhete com dado de verdade e histórico público. Dá pra começar de graça pelo meu link: ${link}` },
  en: { title: "Invite & earn", intro: (n: number) => `When a friend who signed up through your link makes a first purchase, they get ${n} coins — and so do you. Coins pay for slip analyses.`, link: "Your link", copy: "Copy", copied: "Copied", wa: "Share on WhatsApp", invited: "invited", earned: "coins earned", signIn: "Sign in to get your link.",
    waText: (link: string) => `I'm using Betmatic to build tickets from real data with a public track record. You can start free through my link: ${link}` },
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
      <p className="text-sm text-fg-muted">{c.intro(data?.coinsPerInvite ?? 5)}</p>
      {data && (
        <div className="mt-4 flex flex-wrap items-center gap-2" data-testid="referral">
          <span className="text-tiny text-fg-dim">{c.link}</span>
          <code className="nums rounded-control border border-line-strong bg-surface-1 px-3 py-2 text-sm text-fg" data-testid="referral-link">{data.link}</code>
          <button onClick={() => { navigator.clipboard?.writeText(data.link).catch(() => {}); setCopied(true); setTimeout(() => setCopied(false), 1500); }} className="rounded-control border border-line-strong px-3 py-2 text-tiny text-fg-muted hover:border-line-control hover:text-fg">{copied ? c.copied : c.copy}</button>
          <a href={`https://wa.me/?text=${encodeURIComponent(c.waText(data.link))}`} target="_blank" rel="noopener noreferrer" className="rounded-control bg-action px-3 py-2 text-tiny font-semibold text-focus hover:bg-action">{c.wa}</a>
        </div>
      )}
    </Panel>
  );
}
