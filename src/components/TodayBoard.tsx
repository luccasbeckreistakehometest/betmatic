"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Empty, ErrorState, Notice, PageHead, Skeleton } from "@/components/ui";
import { useNavState } from "@/components/Controls";
import { TodayCard, Filled } from "@/components/TodayCard";
import { formatMoney, formatPercent, formatStakeUnits } from "@/lib/format";
import { makeT } from "@/lib/i18n";
import type { TodayView } from "@/app/api/today/route";

/**
 * "Os bilhetes de hoje" — the answer to the only question the generator never answered: which ones,
 * and how much. At most three a night, one per game, with a ceiling on the day that cannot be blown
 * through by accident, and an empty list as a legitimate answer.
 *
 * This screen removes nothing. /app still holds every game and every ticket the system generated,
 * one tap away through the link in the head, and every alternative, band and quarter read is
 * exactly where it was. The short list is a layer, not an amputation — and it is the ~300 tickets
 * that produce the sample that calibrates the three.
 */
export function TodayBoard() {
  const { lang, sport, params } = useNavState();
  const t = makeT(lang);
  const [data, setData] = useState<TodayView | null>(null);
  const [failed, setFailed] = useState(false);
  // A Brasília day in the URL opens that day's answer instead of today's — the same escape hatch
  // /app has had all along, and the only way to look at a list after the night is over.
  const day = /^\d{4}-\d{2}-\d{2}$/.test(params.get("day") ?? "") ? params.get("day")! : "";

  const load = useCallback(async () => {
    setFailed(false);
    const query = `sport=${encodeURIComponent(sport.key)}&lang=${lang}${day ? `&day=${day}` : ""}`;
    const response = await fetch(`/api/today?${query}`, { cache: "no-store" }).catch(() => null);
    if (!response?.ok) { setFailed(true); return; }
    setData((await response.json().catch(() => null)) as TodayView | null);
  }, [sport.key, lang, day]);

  useEffect(() => { const id = setTimeout(() => void load(), 0); return () => clearTimeout(id); }, [load]);

  const items = data?.items ?? [];
  const live = data?.live ?? [];
  const nothing = !!data && !items.length && !live.length;

  return (
    <div className="flex flex-col gap-4" data-testid="today">
      <PageHead
        kicker={lang === "pt" ? "Mesa" : "Desk"}
        title={t("todayTitle")}
        meta={t("todaySubtitle")}
        actions={
          data ? (
            <span className="text-tiny text-fg-dim">
              {items.length ? (
                <span className="nums" data-testid="today-total">
                  <Filled
                    text={items.length === 1 ? t("todayMetaOne") : t("todayMeta")}
                    values={{ n: String(items.length), u: formatStakeUnits(data.totals.units, lang) }}
                  />
                </span>
              ) : null}
            </span>
          ) : null
        }
      />

      {/* The regime, in the open: why the number is the floor and what it is buying. */}
      {data?.mode === "medicao" && (
        <Notice>
          <Filled
            text={t("todayMeasuring")}
            values={{ n: String(data.calibration.settledLegs), x: formatPercent(Math.abs(data.calibration.gapPoints) / 100, lang, { digits: 1 }) }}
          />
        </Notice>
      )}

      {failed && <ErrorState title={t("todayUnavailable")} />}

      {!data && !failed && (
        <div className="flex flex-col gap-3">
          {[0, 1].map((i) => (
            <div key={i} className="flex flex-col gap-2 rounded-panel border border-line bg-surface-1 p-(--panel-p)">
              <Skeleton width="70%" />
              <Skeleton width="40%" />
              <Skeleton width="55%" />
            </div>
          ))}
        </div>
      )}

      {nothing && (
        <section className="flex flex-col gap-3" data-testid="today-none">
          <h2 className="u-title text-h3 text-fg">{t("todayNoneTitle")}</h2>
          <Empty
            rows={0}
            action={
              <span className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                <Link href={{ pathname: "/app", query: { sport: sport.key, lang } }} className="underline underline-offset-2" data-testid="today-none-all">
                  <Filled text={t("todayNoneAll")} values={{ m: String(data?.generated ?? 0) }} />
                </Link>
                <Link href={{ pathname: "/prova", query: { lang } }} className="underline underline-offset-2">{t("todayNoneMethod")}</Link>
              </span>
            }
          >
            <Filled text={t("todayNoneBody")} values={{ n: String(data?.games ?? 0) }} />
          </Empty>
          {data?.bandGated && <p className="text-tiny text-fg-dim">{t("todayPlanBand")}</p>}
        </section>
      )}

      {!!items.length && (
        <div className="flex flex-col gap-3">
          {items.map((item) => (
            <TodayCard key={item.ledgerId} item={item} lang={lang} bankroll={data!.bankrollAmount} smallBankroll={data!.smallBankroll} sportKey={sport.key} day={data!.day} onSaved={() => void load()} />
          ))}
        </div>
      )}

      {!!live.length && (
        <div className="flex flex-col gap-3" data-testid="today-live">
          {live.map((item) => (
            <TodayCard key={item.ledgerId} item={item} lang={lang} bankroll={data!.bankrollAmount} smallBankroll={data!.smallBankroll} sportKey={sport.key} day={data!.day} onSaved={() => void load()} />
          ))}
        </div>
      )}

      {!!items.length && data?.totals.money !== null && data?.totals.money !== undefined && (
        <p className="text-tiny text-fg-dim nums">{formatMoney(data.totals.money, lang)}</p>
      )}

      <p className="max-w-measure-app text-tiny text-fg-muted">{t("todayFooter")}</p>

      <p className="text-tiny text-fg-dim">
        <Link href={{ pathname: "/app", query: { sport: sport.key, lang } }} className="underline underline-offset-2" data-testid="today-all">
          {t("todayAllTickets")}
        </Link>
      </p>
    </div>
  );
}
