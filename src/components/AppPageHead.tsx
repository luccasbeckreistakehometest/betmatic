"use client";

import { NAV_GROUPS } from "@/components/AppRail";
import { useNavState } from "@/components/Controls";
import { PageHead, Skeleton } from "@/components/ui";
import { makeT } from "@/lib/i18n";

/**
 * Every screen in the app opens with the same line, and it names itself from the rail rather than
 * from a string typed twice: the kicker is the group the destination lives in, the title is the
 * label the rail shows. Rename a destination once and the page follows.
 */
export function AppPageHead({ href, meta, actions }: { href: string; meta?: string; actions?: React.ReactNode }) {
  const { lang } = useNavState();
  const t = makeT(lang);
  const group = NAV_GROUPS.find((g) => g.items.some((i) => i.href === href));
  const item = group?.items.find((i) => i.href === href);
  if (!item) return null;
  return <PageHead kicker={group?.label[lang]} title={t(item.key)} meta={meta} actions={actions} />;
}

/** A region that is still loading looks like the region, not like a grey pill. */
export function PanelSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div aria-hidden="true" className="rounded-panel border border-line bg-surface-1">
      <div className="border-b border-line px-(--cell-px) py-2">
        <Skeleton width="9rem" />
      </div>
      <div className="flex flex-col">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="flex h-(--row-h) items-center gap-4 px-(--cell-px) u-rule">
            <Skeleton width={`${30 + ((i * 13) % 25)}%`} />
            <Skeleton width="4rem" className="ml-auto" />
          </div>
        ))}
      </div>
    </div>
  );
}
