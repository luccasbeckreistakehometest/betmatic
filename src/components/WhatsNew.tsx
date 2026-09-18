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
    <section className="border border-line bg-surface-1" data-testid="whats-new">
      <div className="flex items-center gap-2 border-b border-line px-3 py-1.5">
        <span className="text-label u-label text-fg-dim">{lang === "pt" ? "Novo" : "New"}</span>
        <p className="text-tiny text-fg-muted">{lang === "pt" ? "O que mudou no Betmatic" : "What's new in Betmatic"}</p>
        <button
          type="button"
          onClick={close}
          className="ml-auto text-tiny text-fg-dim transition-colors duration-(--dur-1) hover:text-fg"
          data-testid="whats-new-close"
        >
          {lang === "pt" ? "Fechar" : "Close"}
        </button>
      </div>
      {/* A clipped strip says so: the 24px edge fade is the one gradient the system allows (§8.4). */}
      <ul className="u-edge-fade flex divide-x divide-line overflow-x-auto">
        {ITEMS.map((item) => {
          const [title, body] = item[lang];
          return (
            <li key={title} className="shrink-0">
              <Link href={item.href(sportKey, lang)} className="block h-full w-44 px-3 py-2 transition-colors duration-(--dur-1) hover:bg-surface-2">
                <span className="block text-tiny font-medium text-fg">{title}</span>
                <span className="mt-0.5 block text-tiny leading-snug text-fg-dim">{body}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
