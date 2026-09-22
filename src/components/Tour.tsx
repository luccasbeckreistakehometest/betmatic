"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { useNavState } from "@/components/Controls";
import { buttonClass } from "@/components/ui";

/**
 * First-visit tour over the real interface. Progress and completion are saved on the server (per
 * user, or per anonymous cookie) with the first session's events, so it never replays.
 */
const ALL_STEPS = [
  { anchor: "sport", pt: ["Escolha o esporte", "Basquete (NBA e WNBA) e futebol, com as ligas de cada um. Cada esporte tem seus mercados e seus bilhetes."], en: ["Pick a sport", "Basketball (NBA and WNBA) and soccer, league by league. Each sport has its own markets and tickets."] },
  { anchor: "games", pt: ["Os jogos do dia", "Cada card é um jogo. Alguns já chegam com bilhete pronto — são os destaques do dia, montados sozinhos algumas vezes por dia. Nos outros, abra o jogo e a gente monta na hora, com as odds e o histórico daquele momento."], en: ["Today's games", "Every card is a game. Some arrive with a ticket already built — the day's featured games, picked and built on their own a few times a day. On the rest, open the game and we build it on the spot from that moment's odds and history."] },
  { anchor: "games", pt: ["Alternativas embaixo do bilhete", "Dentro do jogo, o bilhete pode vir com até duas alternativas com a mesma ideia. Se uma perna cair ou a linha mudar, é só abrir ali."], en: ["Backups under the ticket", "Inside a game, a ticket can come with up to two alternatives with the same idea. If a leg breaks or the line moves, open them right there."] },
  { anchor: "games", pt: ["O selo de escalação", "Uma hora antes do jogo a gente confere quem entrou. Se alguém do seu bilhete ficar no banco, a perna ganha um selo vermelho e a alternativa sem ele fica destacada."], en: ["The lineup badge", "An hour before kickoff we check who starts. If someone on your ticket is benched, the leg gets a red badge and the backup without him is highlighted."] },
  { anchor: "games", pt: ["Raio-x do jogador e o ao vivo", "Dentro do jogo, abra um jogador: linha publicada, quantas vezes ele passou dela, minutagem e o rendimento com e sem cada companheiro. Com a bola rolando, o painel ao vivo diz se cada perna já bateu, se caiu ou quanta chance ainda tem."], en: ["Player deep dive and the live panel", "Inside a game, open a player: the posted line, how often he cleared it, his minutes and how he does with and without each teammate. Once the game is on, the live panel says whether each leg has landed, busted or how much chance is left."] },
  { anchor: "nav", pt: ["Múltiplas e histórico", "Combine jogos em múltiplas, monte seu próprio bilhete e acompanhe o histórico do que acertamos e erramos. Na prova pública tem ainda o CLV: cada perna comparada com a odd de fechamento."], en: ["Parlays and track record", "Combine games into parlays, build your own slip, and follow the record of what we got right and wrong. The public record adds CLV: every leg against the closing price."] },
  { anchor: "bankroll", pt: ["Sua banca e a curva", "Salve bilhetes com o valor apostado: liquidação automática, lucro, ROI, e a curva de unidades do histórico inteiro — filtrada por faixa, esporte e evidência."], en: ["Your bankroll and the curve", "Save tickets with the amount you staked: automatic grading, profit, ROI, and the equity curve of the whole record — filtered by band, sport and evidence."] },
  { anchor: "bankroll", ai: true, pt: ["Manda o print do seu bilhete", "Fez a aposta na casa? Na sua banca, mande o print: a gente lê, você confere, e ele é liquidado sozinho no fim do jogo. A imagem não fica guardada."], en: ["Send your slip screenshot", "Placed the bet at the book? In your bankroll, send the screenshot: we read it, you check it, and it grades itself when the game ends. The image is never kept."] },
  { anchor: "alerts", telegram: true, pt: ["Alertas dos seus times", "Siga times e ligas e receba os bilhetes no Telegram assim que saem — ou aqui, na lista de avisos."], en: ["Alerts for your teams", "Follow teams and leagues and get their tickets on Telegram as soon as they are built — or here, in the notice list."] },
  { anchor: "alerts", telegram: false, pt: ["Avisos dos seus times", "Siga times e ligas: quando os bilhetes de um jogo deles saem, o aviso aparece aqui, na sua lista."], en: ["Notices for your teams", "Follow teams and leagues: when one of their games gets tickets, the notice lands here, in your list."] },
  { anchor: "settings", pt: ["Seus limites", "Teto de aposta por dia e por semana, lembrete de tempo, aviso de sequência ruim e uma pausa de 7 ou 30 dias. Aposta não é investimento."], en: ["Your limits", "Daily and weekly stake ceilings, a time reminder, a losing-streak notice and a 7- or 30-day pause. Betting is not investing."] },
  { anchor: "account", pt: ["Seu plano, seus coins e o menu", "O plano define quantos jogos e faixas você vê; coins pagam análises só suas. No menu ficam o raio-x do tipster, o relatório da semana, a conta e os planos."], en: ["Your plan, coins and the menu", "Your plan sets how many games and bands you see; coins pay for analysis made just for you. The menu holds the tipster audit, the weekly report, your account and the plans."] },
] as const;
type Step = (typeof ALL_STEPS)[number];
/** Steps tied to a feature appear only when that feature is on here. */
const visible = (s: Step, flags: { telegram: boolean; ai: boolean }) =>
  (!("telegram" in s) || s.telegram === flags.telegram) && (!("ai" in s) || flags.ai);
type Rect = { top: number; left: number; width: number; height: number };

export function Tour({ telegram = false, ai = false }: { telegram?: boolean; ai?: boolean }) {
  const { lang } = useNavState();
  const STEPS = useMemo(() => ALL_STEPS.filter((s) => visible(s, { telegram, ai })), [telegram, ai]);
  const stepCount = STEPS.length;
  const [state, setState] = useState<"idle" | "welcome" | "running" | "done">("idle");
  const [step, setStep] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);

  const save = useCallback((s: number, completed = false, event?: string) => {
    fetch("/api/tour", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ step: s, completed, event }) }).catch(() => {});
  }, []);

  useEffect(() => {
    fetch("/api/tour", { cache: "no-store" }).then((r) => r.json()).then((j) => {
      if (j.tourCompleted) return setState("done");
      let seen: string | null = "1";
      try { seen = sessionStorage.getItem("bm_tour_seen"); if (!seen) sessionStorage.setItem("bm_tour_seen", "1"); } catch { /* storage blocked */ }
      if (!seen) save(0, false, "visit");
      if (j.tourStep > 0 && j.tourStep < stepCount) { setStep(j.tourStep); setState("running"); }
      else if (!seen) setState("welcome");
    }).catch(() => {});
  }, [save, stepCount]);

  const measure = useCallback(() => {
    // The same anchor can exist twice — the slate is a table on a desk and a list of cards on a
    // phone — so the spotlight goes on the one that is actually drawn at this width.
    const candidates = Array.from(document.querySelectorAll<HTMLElement>(`[data-tour="${STEPS[step].anchor}"]`));
    const el = candidates.find((c) => { const r = c.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
    // Anchors inside the phone menu are hidden: show the card without a spotlight.
    if (!el) return setRect(null);
    const r = el.getBoundingClientRect();
    setRect({ top: r.top - 8, left: r.left - 8, width: r.width + 16, height: r.height + 16 });
  }, [step, STEPS]);

  useLayoutEffect(() => {
    if (state !== "running") return;
    const id = window.setTimeout(measure, 120);
    window.addEventListener("resize", measure); window.addEventListener("scroll", measure, true);
    return () => { window.clearTimeout(id); window.removeEventListener("resize", measure); window.removeEventListener("scroll", measure, true); };
  }, [state, step, measure]);

  if (state === "idle" || state === "done") return null;
  const t = (pt: string, en: string) => (lang === "pt" ? pt : en);

  if (state === "welcome") {
    return (
      <div className="fixed bottom-(--float-b) left-5 z-[85] w-[min(92vw,340px)] rounded-panel border border-line-strong bg-surface-1 p-4 shadow-dialog" data-testid="tour-welcome">
        <p className="text-label u-label text-fg-dim">Betmatic</p>
        <p className="u-title mt-1.5 text-base text-fg">{t("Primeira vez aqui? Um tour de 30 segundos.", "First time here? A 30-second tour.")}</p>
        <div className="mt-3 flex gap-2">
          <button className={buttonClass("primary")} data-testid="tour-start" onClick={() => { setState("running"); setStep(0); save(0, false, "tour_start"); }}>{t("Bora", "Show me")}</button>
          <button className="inline-flex h-(--row-h) items-center rounded-control border border-line-control px-3 text-sm font-medium text-fg transition-colors duration-(--dur-1) hover:bg-surface-2" data-testid="tour-later" onClick={() => { setState("done"); save(0, true, "tour_skip"); }}>{t("Depois", "Later")}</button>
        </div>
      </div>
    );
  }

  const s = STEPS[step];
  const [title, body] = s[lang];
  const last = step === STEPS.length - 1;
  // The card never lands on the phone's tab bar: the bar's height is subtracted from the room below.
  const barHeight = document.querySelector<HTMLElement>("[data-tabbar]")?.getBoundingClientRect().height ?? 0;
  const style = rect ? { top: Math.min(window.innerHeight - barHeight - 200, rect.top + rect.height + 12), left: Math.max(12, Math.min(rect.left, window.innerWidth - 352)) } : { bottom: "var(--float-b)", left: 20 };
  return (
    <>
      <div className="pointer-events-none fixed inset-0 z-[90]">
        <div className="absolute rounded-panel shadow-[0_0_0_9999px_var(--scrim)] outline-2 outline-(--fg) transition-all duration-(--dur-3) ease-(--ease-out) motion-reduce:transition-none" style={rect ?? { top: -9999, left: -9999, width: 0, height: 0 }} />
      </div>
      <div className="fixed z-[91] w-[min(92vw,340px)] rounded-panel border border-line-strong bg-surface-1 p-4 shadow-dialog" style={style} data-testid="tour-step" data-step={step}>
        <p className="text-micro u-label text-fg-dim">{step + 1} / {STEPS.length}</p>
        <p className="u-title mt-1.5 text-base text-fg">{title}</p>
        <p className="mt-1.5 text-sm leading-relaxed text-fg-muted">{body}</p>
        <div className="mt-3 flex items-center justify-between">
          <button className="text-tiny text-fg-dim hover:text-fg-muted" onClick={() => { setState("done"); save(step, true, "tour_skip"); }}>{t("Pular", "Skip")}</button>
          <div className="flex gap-2">
            {step > 0 && <button className="inline-flex h-(--row-h) items-center rounded-control border border-line-control px-3 text-sm font-medium text-fg transition-colors duration-(--dur-1) hover:bg-surface-2" onClick={() => { setStep(step - 1); save(step - 1); }}>{t("Voltar", "Back")}</button>}
            <button className={buttonClass("primary")} data-testid="tour-next" onClick={() => { if (last) { setState("done"); save(step, true, "tour_done"); } else { setStep(step + 1); save(step + 1); } }}>{last ? t("Entendi", "Got it") : t("Próximo", "Next")}</button>
          </div>
        </div>
      </div>
    </>
  );
}
