"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { LangPicker, useNavState } from "@/components/Controls";
import { AppMenu } from "@/components/AppMenu";
import { Icon } from "@/components/Icon";
import { LinkButton, Skeleton } from "@/components/ui";
import { makeT } from "@/lib/i18n";

interface Me {
  user: {
    name: string;
    role: "user" | "admin";
    coins: number;
    planActive: boolean;
    planExpiresAt: string | null;
    plan: { id: string; name: string };
  } | null;
}

/**
 * The account corner of the topbar: balance, plan, language, and the button that opens the menu.
 * The menu itself is AppMenu — one list for every size, read from src/lib/nav.ts, which is the same
 * file the rail reads. Logout lives inside it, at every size.
 */
export function AccountBar() {
  const { lang, sport } = useNavState();
  const t = makeT(lang);
  const pathname = usePathname();
  const search = useSearchParams();
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [open, setOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    void (async () => {
      await Promise.resolve();
      const response = await fetch("/api/auth/me", { cache: "no-store" }).catch(() => null);
      if (response?.ok) setMe(await response.json());
      else setMe({ user: null });
    })();
  }, []);

  const close = useCallback(() => setOpen(false), []);

  async function logout() {
    setLeaving(true);
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => null);
    setOpen(false);
    setLeaving(false);
    setMe({ user: null });
    router.replace(`/?lang=${lang}`);
    router.refresh();
  }

  const here = `${pathname}${search.toString() ? `?${search.toString()}` : ""}`;
  const user = me?.user ?? null;

  return (
    <div className="relative flex items-center gap-2">
      {!me ? (
        <Skeleton width="4rem" />
      ) : user ? (
        <div className="flex items-center gap-2" data-tour="account" data-testid="account">
          {/* Balance and plan are numbers a person checks, so they are set like numbers. */}
          <Link
            href={`/app/conta?lang=${lang}`}
            className="nums flex items-center justify-center gap-1.5 text-tiny text-fg-muted transition-colors hover:text-fg max-md:min-h-11 max-md:min-w-11 max-md:px-1.5"
            title={t("coins")}
            aria-label={`${user.coins} ${t("coins")}`}
          >
            <span aria-hidden="true" className="size-1.5 rounded-full bg-fg-dim" />
            {user.coins}
          </Link>
          <span className="hidden border border-line px-1.5 py-0.5 text-micro u-label text-fg-dim sm:inline">
            {user.plan.name}
          </span>
        </div>
      ) : (
        <LinkButton
          href={`/login?lang=${lang}&next=${encodeURIComponent(here)}`}
          data-tour="account"
          data-testid="header-login"
          className="h-8"
        >
          {t("login")}
        </LinkButton>
      )}

      <LangPicker className="hidden sm:flex" />

      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-expanded={open}
        aria-controls="app-menu"
        aria-label={t("menu")}
        data-testid="menu-button"
        className="grid size-8 place-items-center rounded-control border border-line-control text-fg-muted transition-colors duration-(--dur-1) hover:bg-surface-2 hover:text-fg max-md:size-11"
      >
        <Icon name="menu" size={16} />
      </button>

      <AppMenu
        open={open}
        onClose={close}
        lang={lang}
        sportKey={sport.key}
        user={user}
        here={here}
        leaving={leaving}
        onLogout={() => void logout()}
      />
    </div>
  );
}
