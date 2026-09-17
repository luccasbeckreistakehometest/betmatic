import { Suspense } from "react";
import { notFound } from "next/navigation";
import { PlayerDeepDive } from "@/components/PlayerDeepDive";

export const dynamic = "force-dynamic";

export default async function PlayerPage({ params, searchParams }: PageProps<"/app/player/[athleteId]">) {
  const { athleteId } = await params;
  const query = await searchParams;
  if (!/^\d{1,12}$/.test(athleteId)) notFound();
  const game = typeof query.game === "string" && /^[\w-]{1,40}$/.test(query.game) ? query.game : null;
  return (
    <Suspense fallback={<div className="h-60 animate-pulse rounded-xl bg-ink-900" />}>
      <PlayerDeepDive athleteId={athleteId} gameId={game} />
    </Suspense>
  );
}
