import { publicClv } from "@/lib/server/leg-prices";
import { CLV_MIN_SAMPLE } from "@/lib/ledger/clv";
import type { Lang } from "@/lib/i18n";

const C = {
  pt: {
    title: "O mercado concordou com a gente?",
    body: "Toda perna é comparada com a odd de fechamento, a do apito inicial, sem a margem da casa. Pegar preço melhor que o fechamento com frequência é o sinal mais honesto de que a análise presta, mais do que acerto em amostra curta.",
    mean: "CLV médio", beat: "pernas que bateram o fechamento", n: "pernas com fechamento", moved: "linha mudou",
    movedNote: (n: number, f: number) => `${n === 1 ? "1 perna teve" : `${n} pernas tiveram`} a linha alterada antes do jogo (${f} a nosso favor); ${n === 1 ? "essa não entra" : "essas não entram"} na média.`,
    small: "Amostra pequena: {n} pernas com fechamento. O número aparece a partir de {min}.", market: "Por mercado",
    markets: { moneyline: "vencedor", total: "total do jogo" } as Record<string, string>,
  },
  en: {
    title: "Did the market agree with us?",
    body: "Every leg is compared with the closing price at kickoff, with the book's margin removed. Beating the close often is the most honest sign that the analysis is any good, more than a hit rate over a short sample.",
    mean: "Mean CLV", beat: "legs that beat the close", n: "legs with a close", moved: "line moved",
    movedNote: (n: number, f: number) => `${n === 1 ? "1 leg had its" : `${n} legs had their`} line changed before the game (${f} in our favor); ${n === 1 ? "it stays" : "those stay"} out of the mean.`,
    small: "Small sample: {n} legs with a close. The number appears from {min}.", market: "By market",
    markets: { moneyline: "moneyline", total: "game total" } as Record<string, string>,
  },
};

const pct = (n: number) => `${n > 0 ? "+" : ""}${(n * 100).toFixed(1)}%`;

/** Closing line value on the public record. The number stays hidden until the sample means something. */
export function ClvBlock({ lang }: { lang: Lang }) {
  const c = C[lang];
  let s;
  try { s = publicClv(); } catch { return null; }
  return (
    <div className="mt-8 rounded-panel border border-line bg-surface-1 p-(--panel-p)" data-testid="clv-block">
      <p className="text-label u-label text-fg-dim">CLV</p>
      <h2 className="mt-1 text-body font-semibold text-fg">{c.title}</h2>
      <p className="mt-2 max-w-3xl text-sm leading-relaxed text-fg-muted">{c.body}</p>
      {s.publishable ? (
        <>
          <div className="mt-4 grid grid-cols-3 gap-px overflow-hidden rounded-control border border-line bg-surface-3">
            {[[c.mean, pct(s.mean), s.mean > 0 ? "text-focus" : s.mean < 0 ? "text-warn" : "text-fg"], [c.beat, `${(s.beat * 100).toFixed(0)}%`, "text-fg"], [c.n, String(s.n), "text-fg"]].map(([k, v, tone]) => (
              <div key={k} className="bg-surface-1 px-3 py-3"><div className="text-micro u-label text-fg-dim">{k}</div><div className={`nums mt-1 text-lead font-semibold ${tone}`}>{v}</div></div>
            ))}
          </div>
          {s.byMarket.length > 0 && (
            <div className="mt-4">
              <p className="text-label u-label text-fg-dim">{c.market}</p>
              <ul className="mt-1.5 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2" data-testid="clv-markets">
                {s.byMarket.slice(0, 8).map((m) => (
                  <li key={m.market} className="flex justify-between gap-3"><span className="text-fg-muted">{c.markets[m.market] ?? m.market}</span><span className="nums text-fg-muted">{pct(m.mean)} · {(m.beat * 100).toFixed(0)}% · n={m.n}</span></li>
                ))}
              </ul>
            </div>
          )}
        </>
      ) : (
        <p className="mt-3 text-sm text-fg-muted" data-testid="clv-small">{c.small.replace("{n}", String(s.n)).replace("{min}", String(CLV_MIN_SAMPLE))}</p>
      )}
      {s.moved > 0 && <p className="mt-3 text-tiny text-fg-dim">{c.movedNote(s.moved, s.movedFavor)}</p>}
    </div>
  );
}
