import { headers } from "next/headers";
import { Panel, Skeleton } from "@/components/ui";
import { SlateSkeleton } from "@/components/SlateTable";

/** The slate's frame while the day's games are fetched: never a blank screen between two taps. */
export default async function SlateLoading() {
  const lang = (await headers()).get("x-bm-lang") === "en" ? "en" : "pt";
  return (
    <div className="flex flex-col gap-4" data-density="compact" aria-busy="true">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 border-b border-line-strong pb-3">
        <div className="flex flex-col gap-2">
          <Skeleton width="3rem" />
          <Skeleton width="12rem" className="h-6" />
          <Skeleton width="16rem" />
        </div>
        <Skeleton width="13rem" className="h-(--row-h)" />
      </div>
      <Panel flush>
        <SlateSkeleton lang={lang} />
      </Panel>
    </div>
  );
}
