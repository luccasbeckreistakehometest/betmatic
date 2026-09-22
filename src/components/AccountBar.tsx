"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { LangPicker, useNavState } from "@/components/Controls";
import { NAV_GROUPS } from "@/components/AppRail";
import { Icon } from "@/components/Icon";
import { Button, LinkButton, Skeleton, cx } from "@/components/ui";
import { makeT } from "@/lib/i18n";
import { formatDate } from "@/lib/format";

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
 * The account corner of the topbar: balance, plan, language, and the menu that holds every
 * destination — the rail's own list, so a phone (which has five of them in the bottom bar) and a
 * desk (which has all thirteen in the rail) read the same names in the same order. Logout lives
 * here at every size.
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
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void (async () => {
      await Promise.resolve();
      const response = await fetch("/api/auth/me", { cache: "no-store" }).catch(() => null);
      if (response?.ok) setMe(await response.json());
      else setMe({ user: null });
    })();
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    const onClick = (e: MouseEvent) => { if (panel.current && !panel.current.contains(e.target as Node)) setOpen(false); };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onClick);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("mousedown", onClick); };
  }, [open]);

  async function logout() {
    setLeaving(true);
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => null);
    setOpen(false);
    setMe({ user: null });
    router.replace(`/?lang=${lang}`);
    router.refresh();
  }

  const here = `${pathname}${search.toString() ? `?${search.toString()}` : ""}`;
  const query = { sport: sport.key, lang };
  const user = me?.user ?? null;
  const linkClass = (href: string) =>
    cx(
      "flex h-8 items-center gap-2 px-2 text-sm transition-colors duration-(--dur-1)",
      pathname === href ? "bg-surface-2 font-medium text-fg" : "text-fg-muted hover:bg-surface-2 hover:text-fg",
    );

  return (
    <div className="relative flex items-center gap-2" ref={panel}>
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
          {user.role === "admin" && (
            <Link href="/admin" className="hidden text-tiny text-fg-muted transition-colors hover:text-fg sm:inline">
              admin
            </Link>
          )}
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
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="app-menu"
        aria-label={open ? t("closeMenu") : t("menu")}
        data-testid="menu-button"
        className="grid size-8 place-items-center rounded-control border border-line-control text-fg-muted transition-colors duration-(--dur-1) hover:bg-surface-2 hover:text-fg max-md:size-11"
      >
        <Icon name={open ? "close" : "menu"} size={16} />
      </button>

      {open && (
        <div
          id="app-menu"
          data-testid="app-menu"
          className="absolute top-full right-0 z-50 mt-1.5 max-h-[calc(100dvh-5rem)] w-[min(88vw,17.5rem)] overflow-y-auto rounded-panel border border-line bg-surface-1 shadow-pop"
        >
          {user && (
            <div className="border-b border-line px-3 py-2">
              <p className="truncate text-sm font-medium text-fg">{user.name}</p>
              <p className="mt-0.5 text-tiny text-fg-dim">
                {user.plan.name}
                {user.plan.id !== "free" && user.planExpiresAt
                  ? ` · ${t("planUntil").replace("{date}", formatDate(user.planExpiresAt, lang, { year: true }))}`
                  : ""}
                {" · "}
                <span className="nums">{user.coins}</span> coins
              </p>
            </div>
          )}

          {NAV_GROUPS.map((group) => (
            <nav key={group.label.en} className="border-b border-line py-1" aria-label={group.label[lang]}>
              <p className="px-2 pt-1 pb-0.5 text-label u-label text-fg-dim">{group.label[lang]}</p>
              {group.items.map((item) => (
                <Link
                  key={item.href}
                  href={{ pathname: item.href, query: item.href.startsWith("/app") ? query : { lang } }}
                  onClick={() => setOpen(false)}
                  className={linkClass(item.href)}
                >
                  <Icon name={item.icon} size={16} className="text-fg-dim" />
                  {t(item.key)}
                </Link>
              ))}
            </nav>
          ))}

          <nav className="border-b border-line py-1" aria-label={t("navMore")}>
            <Link href={`/contato?lang=${lang}`} onClick={() => setOpen(false)} className={linkClass("/contato")}>
              <Icon name="info" size={16} className="text-fg-dim" />
              {t("contact")}
            </Link>
            {user?.role === "admin" && (
              <Link href="/admin" onClick={() => setOpen(false)} className={linkClass("/admin")}>
                <Icon name="shield" size={16} className="text-fg-dim" />
                Admin
              </Link>
            )}
          </nav>

          <div className="flex items-center justify-between gap-2 p-2">
            <LangPicker className="sm:hidden" />
            {user ? (
              <Button
                variant="secondary"
                icon="logout"
                onClick={() => void logout()}
                loading={leaving}
                data-testid="logout"
                className="ml-auto h-8"
              >
                {t("logout")}
              </Button>
            ) : (
              <div className="ml-auto flex gap-2">
                <LinkButton href={`/login?lang=${lang}&next=${encodeURIComponent(here)}`} className="h-8">
                  {t("login")}
                </LinkButton>
                <LinkButton variant="primary" href={`/signup?lang=${lang}&next=${encodeURIComponent(here)}`} className="h-8">
                  {t("startFreeCta")}
                </LinkButton>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
