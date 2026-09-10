import { DateNav } from "@/components/DateNav";
import { GameCard } from "@/components/GameCard";
import { getSlateOrNearest, todayKey } from "@/lib/sources/espn";

export const dynamic = "force-dynamic";

function humanDate(dateKey: string): string {
  const date = new Date(Date.UTC(+dateKey.slice(0, 4), +dateKey.slice(4, 6) - 1, +dateKey.slice(6, 8)));
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

export default async function SlatePage({ searchParams }: PageProps<"/">) {
  const params = await searchParams;
  const raw = typeof params.date === "string" ? params.date.replaceAll("-", "") : todayKey();
  const requested = /^\d{8}$/.test(raw) ? raw : todayKey();

  let slate;
  let error: string | null = null;
  try {
    slate = await getSlateOrNearest(requested);
  } catch (e) {
    error = e instanceof Error ? e.message : "Could not reach the schedule feed.";
  }

  const games = slate?.games ?? [];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-white">Slate</h1>
          <p className="mt-1 text-sm text-mist-400">
            {games.length ? `${games.length} game${games.length === 1 ? "" : "s"} · ` : ""}
            pick a game to gather insider reporting, props and picks.
          </p>
        </div>
        <DateNav dateKey={slate?.dateKey ?? requested} label={humanDate(slate?.dateKey ?? requested)} />
      </div>

      {slate?.shifted && (
        <div className="rounded-xl border border-warn-400/25 bg-warn-400/5 px-4 py-3 text-sm text-warn-400">
          No games on {humanDate(slate.requestedKey)} — showing the nearest slate,{" "}
          <span className="font-semibold">{humanDate(slate.dateKey)}</span>.
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-alert-400/25 bg-alert-400/5 px-4 py-3 text-sm text-alert-400">
          {error}
        </div>
      )}

      {!error && games.length === 0 && (
        <div className="rounded-xl border border-ink-800 bg-ink-900/60 px-5 py-10 text-center text-sm text-mist-400">
          No NBA games found near this date.
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {games.map((game) => (
          <GameCard key={game.id} game={game} />
        ))}
      </div>
    </div>
  );
}
