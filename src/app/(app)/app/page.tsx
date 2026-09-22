import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { DateNav } from "@/components/DateNav";
import { ErrorState, Notice, PageHead, Panel } from "@/components/ui";
import { SlateTable } from "@/components/SlateTable";
import { RememberSport } from "@/components/RememberSport";
import { WhatsNew } from "@/components/WhatsNew";
import { getSlateOrNearest, todayKey } from "@/lib/sources/espn";
import { makeT, normaliseLang } from "@/lib/i18n";
import { getSport } from "@/lib/sports";
import { formatDayKey } from "@/lib/format";
import { SPORT_COOKIE, defaultSportKey, soldSportKey } from "@/lib/server/default-sport";
import { reportError } from "@/lib/server/ops-log";
import { currentUser } from "@/lib/server/session";
import { scrubGame } from "@/lib/server/whitelabel";

export const dynamic = "force-dynamic";

export default async function SlatePage({ searchParams }: PageProps<"/app">) {
  const params = await searchParams;
  const raw = typeof params.date === "string" ? params.date.replaceAll("-", "") : todayKey();
  const requested = /^\d{8}$/.test(raw) ? raw : todayKey();
  const lang = normaliseLang(typeof params.lang === "string" ? params.lang : undefined);

  // No sport in the URL: the one the visitor last used, else one that has games today.
  if (typeof params.sport !== "string") {
    const remembered = soldSportKey((await cookies()).get(SPORT_COOKIE)?.value);
    const key = remembered ?? (await defaultSportKey(requested));
    const next = new URLSearchParams({ sport: key, lang });
    if (typeof params.date === "string") next.set("date", requested);
    redirect(`/app?${next.toString()}`);
  }

  const sport = getSport(params.sport);
  const t = makeT(lang);

  let slate;
  let failed = false;
  try {
    slate = await getSlateOrNearest(requested, false, sport.key);
  } catch (e) {
    failed = true;
    reportError("data.slate", e, { sport: sport.key, date: requested }, "warn");
  }

  const viewer = await currentUser();
  const role = viewer?.role === "admin" ? "admin" : "user";
  const games = (slate?.games ?? []).map((g) => scrubGame(g, role, lang));

  return (
    <div className="flex flex-col gap-4" data-density="compact">
      <RememberSport sportKey={sport.key} />
      {viewer && <WhatsNew lang={lang} sportKey={sport.key} />}

      <PageHead
        kicker={lang === "pt" ? "Mesa" : "Desk"}
        title={`${t("slate")} · ${sport.label[lang]}`}
        meta={
          <>
            {games.length ? <>{games.length} {games.length === 1 ? t("game") : t("games")}<span className="max-md:hidden"> · </span></> : ""}
            <span className={games.length ? "max-md:hidden" : undefined}>{t("slateHint")}</span>
          </>
        }
        actions={<DateNav dateKey={slate?.dateKey ?? requested} label={formatDayKey(slate?.dateKey ?? requested, lang)} />}
      />

      {slate?.shifted && (
        <Notice>
          {t("noGamesOn")} {formatDayKey(slate.requestedKey, lang)} — {t("showingNearest")},{" "}
          <span className="nums">{formatDayKey(slate.dateKey, lang)}</span>.
        </Notice>
      )}

      {failed ? (
        <ErrorState title={t("slateUnavailable")} />
      ) : (
        <Panel flush>
          <SlateTable games={games} lang={lang} sportKey={sport.key} />
        </Panel>
      )}
    </div>
  );
}
