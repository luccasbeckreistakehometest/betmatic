"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { LangPicker, PRIMARY_NAV, SECONDARY_NAV, useNavState } from "@/components/Controls";
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
 * Account corner of the app header: balance, plan, and one menu that holds everything else — on
 * phones the whole navigation, on desktop the secondary pages. Logout lives here on every size.
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
    `block rounded-lg px-3 py-2 text-[13px] transition ${pathname === href ? "bg-ink-800 text-mist-100" : "text-mist-300 hover:bg-ink-850 hover:text-mist-100"}`;

  return (
    <div className="relative flex items-center gap-2" ref={panel}>
      {!me ? (
        <div className="h-6 w-16 animate-pulse rounded bg-ink-800" />
      ) : user ? (
        <div className="flex items-center gap-2 text-[11px]" data-tour="account" data-testid="account">
          <Link href={`/app/conta?lang=${lang}`} className="nums flex items-center gap-1.5 text-mist-300" title={t("coins")} aria-label={`${user.coins} ${t("coins")}`}>
            <span className="size-1.5 rounded-full bg-edge-400" aria-hidden />
            {user.coins}
          </Link>
          <span className="hidden rounded border border-ink-700 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-mist-400 sm:inline">
            {user.plan.name}
          </span>
          {user.role === "admin" && (
            <Link href="/admin" className="hidden text-warn-400 transition hover:text-warn-400/80 sm:inline">
              admin
            </Link>
          )}
        </div>
      ) : (
        <Link
          href={`/login?lang=${lang}&next=${encodeURIComponent(here)}`}
          data-tour="account"
          data-testid="header-login"
          className="whitespace-nowrap rounded-lg border border-ink-700 px-2.5 py-1 text-[12px] text-mist-300 transition hover:border-ink-600 hover:text-white"
        >
          {t("login")}
        </Link>
      )}

      <LangPicker className="hidden sm:flex" />

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="app-menu"
        aria-label={open ? t("closeMenu") : t("menu")}
        data-testid="menu-button"
        className="grid size-8 place-items-center rounded-lg border border-ink-700 text-mist-300 transition hover:border-ink-600 hover:text-white"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          {open ? (
            <path d="M3.5 3.5l9 9m0-9l-9 9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          ) : (
            <path d="M2.5 4h11M2.5 8h11M2.5 12h11" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          )}
        </svg>
      </button>

      {open && (
        <div
          id="app-menu"
          data-testid="app-menu"
          className="absolute right-0 top-full z-50 mt-2 max-h-[calc(100dvh-5rem)] w-[min(88vw,19rem)] overflow-y-auto rounded-xl border border-ink-700 bg-ink-900 p-2 shadow-2xl"
        >
          {user && (
            <div className="border-b border-ink-800 px-3 pb-2.5 pt-1.5">
              <p className="truncate text-[13px] font-medium text-mist-100">{user.name}</p>
              <p className="mt-0.5 text-[11.5px] text-mist-400">
                {user.plan.name}
                {user.plan.id !== "free" && user.planExpiresAt
                  ? ` · ${t("planUntil").replace("{date}", formatDate(user.planExpiresAt, lang, { year: true }))}`
                  : ""}
                {" · "}
                <span className="nums">{user.coins}</span> coins
              </p>
            </div>
          )}
          <nav className="flex flex-col py-1.5 lg:hidden" aria-label={t("menu")}>
            {PRIMARY_NAV.map((item) => (
              <Link key={item.href} href={{ pathname: item.href, query }} onClick={() => setOpen(false)} className={linkClass(item.href)}>
                {t(item.key)}
              </Link>
            ))}
          </nav>
          <nav className="flex flex-col border-t border-ink-800 py-1.5 lg:border-t-0" aria-label={t("navMore")}>
            {SECONDARY_NAV.map((item) => (
              <Link
                key={item.href}
                href={{ pathname: item.href, query: item.href.startsWith("/app") ? query : { lang } }}
                onClick={() => setOpen(false)}
                className={linkClass(item.href)}
              >
                {t(item.key)}
              </Link>
            ))}
            <Link href={`/contato?lang=${lang}`} onClick={() => setOpen(false)} className={linkClass("/contato")}>
              {t("contact")}
            </Link>
            {user?.role === "admin" && (
              <Link href="/admin" onClick={() => setOpen(false)} className={`${linkClass("/admin")} text-warn-400`}>
                Admin
              </Link>
            )}
          </nav>
          <div className="flex items-center justify-between gap-2 border-t border-ink-800 px-3 pb-1 pt-2.5">
            <LangPicker className="sm:hidden" />
            {user ? (
              <button
                type="button"
                onClick={() => void logout()}
                disabled={leaving}
                data-testid="logout"
                className="ml-auto rounded-lg border border-ink-700 px-3 py-1.5 text-[12.5px] text-mist-200 transition hover:border-alert-400/50 hover:text-alert-400 disabled:opacity-50"
              >
                {t("logout")}
              </button>
            ) : (
              <div className="ml-auto flex gap-2">
                <Link href={`/login?lang=${lang}&next=${encodeURIComponent(here)}`} className="rounded-lg border border-ink-700 px-3 py-1.5 text-[12.5px] text-mist-200">
                  {t("login")}
                </Link>
                <Link href={`/signup?lang=${lang}&next=${encodeURIComponent(here)}`} className="rounded-lg bg-edge-400 px-3 py-1.5 text-[12.5px] font-semibold text-ink-950">
                  {t("startFreeCta")}
                </Link>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
