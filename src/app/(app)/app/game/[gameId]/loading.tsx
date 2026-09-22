import { headers } from "next/headers";
import { TicketSkeleton } from "@/components/BetsPanel";
import { Panel, Skeleton } from "@/components/ui";

/** The game page's frame while the fixture is fetched: head, team block, two ticket cards. */
export default async function GameLoading() {
  const lang = (await headers()).get("x-bm-lang") === "en" ? "en" : "pt";
  return (
    <div className="flex flex-col gap-5" aria-busy="true">
      <Skeleton width="3.5rem" />
      <div className="flex flex-col gap-2 border-b border-line-strong pb-3">
        <Skeleton width="6rem" />
        <Skeleton width="16rem" className="h-6" />
        <Skeleton width="12rem" />
      </div>
      <div aria-hidden="true" className="flex items-center gap-4 border-y border-line bg-surface-1 px-4 py-4">
        <Skeleton className="size-11 shrink-0" />
        <div className="flex flex-1 flex-col gap-2"><Skeleton width="70%" className="h-4" /><Skeleton width="3rem" /></div>
        <Skeleton width="3rem" />
        <div className="flex flex-1 flex-col items-end gap-2"><Skeleton width="70%" className="h-4" /><Skeleton width="3rem" /></div>
        <Skeleton className="size-11 shrink-0" />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Panel>
          <TicketSkeleton label={lang === "pt" ? "Carregando os bilhetes…" : "Loading tickets…"} />
        </Panel>
        <div className="hidden lg:block">
          <Panel><div className="flex flex-col gap-3"><Skeleton width="60%" /><Skeleton width="40%" /><Skeleton width="50%" /></div></Panel>
        </div>
      </div>
    </div>
  );
}
