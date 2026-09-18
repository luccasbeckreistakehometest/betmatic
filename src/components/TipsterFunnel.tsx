import Link from "next/link";
import { MarketingPage } from "@/components/MarketingShell";
import { RED_FLAGS } from "@/lib/tipster/audit";
import type { Lang } from "@/lib/i18n";

const C = {
  pt: {
    eyebrow: "Raio-x do tipster", title: "Seu tipster mostra só os greens? A gente mostra o resto.",
    sub: "Grupo VIP que só posta print de green, cobra caro pra entrar e depois some nas reds? Antes de pagar, cola as mensagens aqui e veja o acerto de verdade, jogo a jogo, contra o placar oficial.",
    steps: [
      { n: "01", t: "Cola as mensagens", b: "Copia do Telegram ou do WhatsApp (ou manda até 5 prints). Dá um nome pra você lembrar de quem é — esse nome fica só com você." },
      { n: "02", t: "A gente confere jogo a jogo", b: "Cada palpite é procurado no jogo certo e liquidado contra o resultado oficial. O que não dá pra conferir fica marcado como não verificável, sem chute." },
      { n: "03", t: "Você vê o que ele não mostra", b: "Acerto real, retorno a 1 unidade, a maior sequência de reds, e quais \"greens\" foram postados depois que o jogo já tinha começado." },
    ],
    privacyTitle: "É privado", privacy: "O nome do tipster nunca aparece em lugar nenhum: nem em página pública, nem no que você compartilhar. O texto colado é descartado depois da leitura; fica só a lista de palpites e o relatório, e você apaga quando quiser.",
    flagsTitle: "Sinais de alerta que a gente procura no texto",
    limits: "No plano Free: 1 raio-x por mês. Nos planos pagos: 3 por semana. Passou do limite? Mais um sai por 6 coins.",
    cta: "Fazer o raio-x", ctaSub: "Grátis pra começar. Sem cartão.",
    note: "O Betmatic não vende palpite de terceiros nem indica grupo. Aposta envolve risco de perda; se você está tentando recuperar dinheiro perdido, pare e procure ajuda.",
  },
  en: {
    eyebrow: "Tipster audit", title: "Your tipster only shows the wins? We show the rest.",
    sub: "A VIP group that posts nothing but winning screenshots, charges a lot to join and goes quiet on the losses? Before you pay, paste the messages here and see the real record, game by game, against the official score.",
    steps: [
      { n: "01", t: "Paste the messages", b: "Copy them from Telegram or WhatsApp (or send up to 5 screenshots). Give it a name you'll remember — that name stays with you." },
      { n: "02", t: "We check game by game", b: "Each pick is matched to the right game and graded against the official result. What can't be checked is marked unverifiable, never guessed." },
      { n: "03", t: "You see what they don't show", b: "The real hit rate, the return at 1 unit, the longest losing run, and which \"wins\" were posted after the game had already started." },
    ],
    privacyTitle: "It's private", privacy: "The tipster's name never shows anywhere: not on a public page, not in anything you share. The pasted text is discarded after reading; only the list of picks and the report stay, and you can delete them whenever you like.",
    flagsTitle: "Red flags we look for in the text",
    limits: "Free plan: 1 audit a month. Paid plans: 3 a week. Past the limit, another one costs 6 coins.",
    cta: "Run an audit", ctaSub: "Free to start. No card.",
    note: "Betmatic doesn't sell third-party picks or recommend any group. Betting carries a risk of loss; if you're trying to win back money you lost, stop and look for help.",
  },
};

/** Public explainer for the tipster audit; the audit itself runs signed in, at /app/tipster. */
export function TipsterFunnel({ lang }: { lang: Lang }) {
  const c = C[lang];
  const next = `/app/tipster?lang=${lang}`;
  return (
    <MarketingPage lang={lang} langHrefs={{ pt: "/raio-x-tipster", en: "/tipster-audit" }} wide>
      <section className="text-fg" data-testid="tipster-funnel">
        <p className="text-label uppercase tracking-[0.18em] text-pos">{c.eyebrow}</p>
        <h1 className="mt-2 max-w-3xl text-h1 font-semibold tracking-tight sm:text-h1">{c.title}</h1>
        <p className="mt-4 max-w-2xl text-base leading-relaxed text-fg-muted">{c.sub}</p>
        <div className="mt-6 flex flex-wrap items-center gap-4">
          <Link href={`/signup?lang=${lang}&next=${encodeURIComponent(next)}`} className="rounded-panel bg-action px-6 py-3 text-base font-semibold text-action-fg hover:bg-action-hover" data-testid="tipster-funnel-cta">{c.cta}</Link>
          <span className="text-tiny text-fg-dim">{c.ctaSub}</span>
        </div>
        <ol className="mt-10 grid gap-px overflow-hidden rounded-panel border border-line bg-surface-3 md:grid-cols-3">
          {c.steps.map((s) => (
            <li key={s.n} className="bg-surface-1 p-6">
              <span className="nums text-[2rem] font-semibold leading-none text-fg-faint">{s.n}</span>
              <h2 className="mt-3 text-base font-semibold text-fg">{s.t}</h2>
              <p className="mt-2 text-sm leading-relaxed text-fg-muted">{s.b}</p>
            </li>
          ))}
        </ol>
        <div className="mt-8 grid gap-4 md:grid-cols-2">
          <div className="rounded-panel border border-line-strong bg-surface-2 p-5">
            <h2 className="text-base font-semibold text-fg">{c.privacyTitle}</h2>
            <p className="mt-2 text-sm leading-relaxed text-fg-muted">{c.privacy}</p>
            <p className="mt-3 text-tiny text-fg-dim">{c.limits}</p>
          </div>
          <div className="rounded-panel border border-line bg-surface-1 p-5">
            <h2 className="text-base font-semibold text-fg">{c.flagsTitle}</h2>
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {RED_FLAGS.map((f) => <li key={f.key} className="rounded-control bg-neg-tint px-2 py-0.5 text-tiny text-neg">{f.label[lang]}</li>)}
            </ul>
          </div>
        </div>
        <p className="mt-8 max-w-3xl text-tiny leading-relaxed text-fg-dim">{c.note}</p>
      </section>
    </MarketingPage>
  );
}
