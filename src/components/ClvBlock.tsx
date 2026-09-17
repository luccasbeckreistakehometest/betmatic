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
    <div className="mt-8 rounded-xl border border-ink-800 bg-ink-900/50 p-5" data-testid="clv-block">
      <p className="text-[11px] uppercase tracking-[0.18em] text-signal-400">CLV</p>
      <h2 className="mt-1 text-[16px] font-semibold text-white">{c.title}</h2>
      <p className="mt-2 max-w-3xl text-[13.5px] leading-relaxed text-mist-400">{c.body}</p>
      {s.publishable ? (
        <>
          <div className="mt-4 grid grid-cols-3 gap-px overflow-hidden rounded-lg border border-ink-800 bg-ink-800">
            {[[c.mean, pct(s.mean), s.mean > 0 ? "text-signal-400" : s.mean < 0 ? "text-warn-400" : "text-mist-200"], [c.beat, `${(s.beat * 100).toFixed(0)}%`, "text-mist-100"], [c.n, String(s.n), "text-mist-100"]].map(([k, v, tone]) => (
              <div key={k} className="bg-ink-900 px-3 py-3"><div className="text-[10px] uppercase tracking-wider text-mist-500">{k}</div><div className={`nums mt-1 text-xl font-semibold ${tone}`}>{v}</div></div>
            ))}
          </div>
          {s.byMarket.length > 0 && (
            <div className="mt-4">
              <p className="text-[11px] uppercase tracking-wider text-mist-500">{c.market}</p>
              <ul className="mt-1.5 grid gap-x-6 gap-y-1 text-[13px] sm:grid-cols-2" data-testid="clv-markets">
                {s.byMarket.slice(0, 8).map((m) => (
                  <li key={m.market} className="flex justify-between gap-3"><span className="text-mist-300">{c.markets[m.market] ?? m.market}</span><span className="nums text-mist-400">{pct(m.mean)} · {(m.beat * 100).toFixed(0)}% · n={m.n}</span></li>
                ))}
              </ul>
            </div>
          )}
        </>
      ) : (
        <p className="mt-3 text-[13px] text-mist-300" data-testid="clv-small">{c.small.replace("{n}", String(s.n)).replace("{min}", String(CLV_MIN_SAMPLE))}</p>
      )}
      {s.moved > 0 && <p className="mt-3 text-[12px] text-mist-500">{c.movedNote(s.moved, s.movedFavor)}</p>}
    </div>
  );
}
