import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { DateNav } from "@/components/DateNav";
import { GameCard } from "@/components/GameCard";
import { RememberSport } from "@/components/RememberSport";
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
    <div className="flex flex-col gap-6">
      <RememberSport sportKey={sport.key} />
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-white">
            {t("slate")} <span className="text-mist-500">· {sport.label[lang]}</span>
          </h1>
          <p className="mt-1 text-sm text-mist-400">
            {games.length ? `${games.length} ${games.length === 1 ? t("game") : t("games")} · ` : ""}
            {t("slateHint")}
          </p>
        </div>
        <DateNav dateKey={slate?.dateKey ?? requested} label={formatDayKey(slate?.dateKey ?? requested, lang)} />
      </div>

      {slate?.shifted && (
        <div className="rounded-xl border border-warn-400/25 bg-warn-400/5 px-4 py-3 text-sm text-warn-400">
          {t("noGamesOn")} {formatDayKey(slate.requestedKey, lang)} — {t("showingNearest")},{" "}
          <span className="font-semibold">{formatDayKey(slate.dateKey, lang)}</span>.
        </div>
      )}

      {failed && (
        <div className="rounded-xl border border-alert-400/25 bg-alert-400/5 px-4 py-3 text-sm text-alert-400" role="alert">
          {t("slateUnavailable")}
        </div>
      )}

      {!failed && games.length === 0 && (
        <div className="rounded-xl border border-ink-800 bg-ink-900/60 px-5 py-10 text-center text-sm text-mist-400">
          {t("noGamesNearby")}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-tour="games">
        {games.map((game) => (
          <GameCard key={game.id} game={game} lang={lang} sportKey={sport.key} />
        ))}
      </div>
    </div>
  );
}
