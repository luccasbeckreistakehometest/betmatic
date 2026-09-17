"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Lang } from "@/lib/i18n";

const KEY = "bm_whats_new_r3";

const ITEMS: { href: (sport: string, lang: Lang) => string; pt: [string, string]; en: [string, string] }[] = [
  { href: (s, l) => `/app?sport=${s}&lang=${l}`, pt: ["Plano B nos bilhetes", "até duas alternativas embaixo de cada um"], en: ["A plan B on tickets", "up to two alternatives under each one"] },
  { href: (s, l) => `/app?sport=${s}&lang=${l}`, pt: ["Vigia de escalação", "jogador no banco vira selo na perna"], en: ["Lineup watch", "a benched player turns into a badge"] },
  { href: (s, l) => `/app/bankroll?sport=${s}&lang=${l}`, pt: ["Manda o print", "seu bilhete da casa entra na banca"], en: ["Snap your slip", "your book slip goes into the bankroll"] },
  { href: (s, l) => `/app/tipster?sport=${s}&lang=${l}`, pt: ["Raio-x do tipster", "o acerto real antes de pagar VIP"], en: ["Tipster audit", "the real record before you pay"] },
  { href: (s, l) => `/app?sport=${s}&lang=${l}`, pt: ["Raio-x do jogador", "qualquer linha, minutagem, com e sem"], en: ["Player deep dive", "any line, minutes, with/without"] },
  { href: (s, l) => `/app?sport=${s}&lang=${l}`, pt: ["Ao vivo", "cada perna com a chance que resta"], en: ["Live", "every leg with the chance left"] },
  { href: (s, l) => `/app/parlays/custom?sport=${s}&lang=${l}`, pt: ["Múltipla sob medida", "você diz quanto quer que pague"], en: ["Custom parlay", "you name the payout"] },
  { href: (s, l) => `/app/report?sport=${s}&lang=${l}`, pt: ["Relatório da semana", "um espelho de como você apostou"], en: ["Weekly report", "a mirror of how you bet"] },
  { href: (_s, l) => `/prova?lang=${l}`, pt: ["CLV na prova pública", "o mercado concordou com a gente?"], en: ["CLV on the record", "did the market agree with us?"] },
];

/** A dismissible row of what is new, on the slate. The dismissal is a per-browser convenience. */
export function WhatsNew({ lang, sportKey }: { lang: Lang; sportKey: string }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => {
      let dismissed = false;
      try { dismissed = localStorage.getItem(KEY) === "1"; } catch { /* storage blocked: show it */ }
      setOpen(!dismissed);
    }, 0);
    return () => clearTimeout(id);
  }, []);
  if (!open) return null;
  const close = () => {
    try { localStorage.setItem(KEY, "1"); } catch { /* storage blocked */ }
    setOpen(false);
  };
  return (
    <section className="rounded-xl border border-edge-400/25 bg-gradient-to-r from-edge-400/[0.06] to-transparent px-4 py-3" data-testid="whats-new">
      <div className="flex items-center gap-2">
        <span className="rounded bg-edge-400/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-edge-400">{lang === "pt" ? "Novo" : "New"}</span>
        <p className="text-[12.5px] text-mist-200">{lang === "pt" ? "O que mudou no Betmatic" : "What's new in Betmatic"}</p>
        <button type="button" onClick={close} className="ml-auto text-[11px] text-mist-500 hover:text-mist-300" data-testid="whats-new-close">{lang === "pt" ? "Fechar" : "Close"}</button>
      </div>
      <ul className="mt-2 flex gap-2 overflow-x-auto pb-1">
        {ITEMS.map((item) => {
          const [title, body] = item[lang];
          return (
            <li key={title} className="shrink-0">
              <Link href={item.href(sportKey, lang)} className="block w-44 rounded-lg border border-ink-800 bg-ink-900/70 px-3 py-2 hover:border-edge-400/50">
                <span className="block text-[12px] font-semibold text-mist-100">{title}</span>
                <span className="block text-[11px] leading-snug text-mist-500">{body}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
