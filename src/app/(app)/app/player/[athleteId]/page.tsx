import { Suspense } from "react";
import { notFound } from "next/navigation";
import { PlayerDeepDive } from "@/components/PlayerDeepDive";
import { PanelSkeleton } from "@/components/AppPageHead";

export const dynamic = "force-dynamic";

export default async function PlayerPage({ params, searchParams }: PageProps<"/app/player/[athleteId]">) {
  const { athleteId } = await params;
  const query = await searchParams;
  if (!/^\d{1,12}$/.test(athleteId)) notFound();
  const game = typeof query.game === "string" && /^[\w-]{1,40}$/.test(query.game) ? query.game : null;
  return (
    <Suspense fallback={<PanelSkeleton rows={8} />}>
      <PlayerDeepDive athleteId={athleteId} gameId={game} />
    </Suspense>
  );
}
