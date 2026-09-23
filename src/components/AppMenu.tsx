"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useSyncExternalStore, type MouseEvent } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@/components/Icon";
import { LangPicker } from "@/components/Controls";
import { Button, Dialog, LinkButton, Sheet, cx, useIsPhone } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { makeT, type Lang } from "@/lib/i18n";
import { NAV_GROUPS, hrefFor, type NavHint, type NavItem } from "@/lib/nav";

/**
 * The one menu. It holds every door in the product, including the ones the rail leaves out, in the
 * four rooms the rail already uses — each room with the line that says what the reader comes there
 * to do, each row with the line that says what the door is for and, where it costs a plan or coins,
 * that price, printed before the tap. A reader should never pay a click to learn a door is locked.
 *
 * Features whose entry is inside something else — a player's name, a price, a settled ticket — have
 * no row, because they have no page. They are named at the end of their room with the place they
 * live, so the list is complete without inventing a door that opens onto nothing.
 *
 * On a phone it is a bottom sheet, inside a thumb's reach; on a desk the same list in a centred
 * dialog. One list, two shapes, never a third copy of the names: both read src/lib/nav.ts, which is
 * the same file the rail reads.
 *
 * Both shapes are the native <dialog>, so the focus trap, Esc and the return of focus to the menu
 * button come from the platform. The phone's own back gesture closes it too: opening pushes a
 * history entry at the same URL, and popping it is what closes the menu — so back dismisses the
 * sheet instead of leaving the page. Everything that leaves the menu — a row, Esc, the backdrop,
 * logout — goes out through that one pop and hands its work over afterwards, so the menu's entry
 * can never sit behind the page the reader asked for, nor race the navigation it was closing for.
 *
 * It renders into a portal at the end of <body> rather than inside the header. A modal belongs
 * there: a dialog's heading must not come before the page's own title in the document, because
 * that is the order a screen reader walks and the order a document query returns.
 */

interface MenuUser {
  name: string;
  role: "user" | "admin";
  coins: number;
  planExpiresAt: string | null;
  plan: { id: string; name: string };
}

/** The client is the client for as long as it lives: nothing to subscribe to. */
const subscribeToNothing = () => () => {};

const ROW = "u-ring-inset flex min-h-11 w-full items-center gap-3 px-3 py-2 text-left transition-colors duration-(--dur-1) ease-(--ease-out)";

function Gate({ label }: { label: string }) {
  return <span className="shrink-0 border border-line px-1.5 py-0.5 text-micro u-label text-fg-dim">{label}</span>;
}

function Row({ item, lang, query, current, onNavigate }: {
  item: NavItem; lang: Lang; query: Record<string, string>; current: boolean; onNavigate: (href: string, event: MouseEvent<HTMLAnchorElement>) => void;
}) {
  const t = makeT(lang);
  const href = hrefFor(item, lang);
  return (
    <Link
      href={{ pathname: href, query: href.startsWith("/app") ? query : { lang } }}
      onClick={(event) => onNavigate(href, event)}
      aria-current={current ? "page" : undefined}
      data-testid={item.testId}
      data-menu-row={href}
      className={cx(ROW, current ? "bg-surface-2" : "hover:bg-surface-2")}
    >
      <Icon name={item.icon} size={16} className={current ? "text-fg" : "text-fg-dim"} />
      <span className="min-w-0 flex-1">
        <span className={cx("block truncate text-sm", current ? "font-medium text-fg" : "text-fg")}>{t(item.key)}</span>
        <span className="block text-tiny leading-snug text-fg-dim">{item.note[lang]}</span>
      </span>
      {item.gate && <Gate label={item.gate[lang]} />}
    </Link>
  );
}

/** A feature with no page of its own: named, explained, and told where it lives. */
function Hint({ hint, lang }: { hint: NavHint; lang: Lang }) {
  return (
    <li className="flex min-h-11 items-start gap-3 px-3 py-2" data-menu-hint={hint.id}>
      <span className="min-w-0 flex-1">
        <span className="block text-sm text-fg-muted">{hint.label[lang]}</span>
        <span className="block text-tiny leading-snug text-fg-dim">{hint.note[lang]}</span>
        <span className="mt-0.5 block text-micro u-label text-fg-dim">{hint.where[lang]}</span>
      </span>
      {hint.gate && <Gate label={hint.gate[lang]} />}
    </li>
  );
}

function MenuBody({ lang, sportKey, user, here, leaving, onNavigate, onLogout }: {
  lang: Lang;
  sportKey: string;
  user: MenuUser | null;
  here: string;
  leaving: boolean;
  onNavigate: (href: string, event: MouseEvent<HTMLAnchorElement>) => void;
  onLogout: () => void;
}) {
  const t = makeT(lang);
  const pathname = usePathname();
  const query = { sport: sportKey, lang };

  return (
    <div className="-mx-(--panel-p) -my-(--panel-p) flex flex-col">
      {user && (
        <Link
          href={{ pathname: "/app/conta", query }}
          onClick={(event) => onNavigate("/app/conta", event)}
          className={cx(ROW, "border-b border-line hover:bg-surface-2")}
          data-testid="menu-identity"
        >
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-fg">{user.name}</span>
            <span className="block text-tiny text-fg-dim">
              {user.plan.name}
              {user.plan.id !== "free" && user.planExpiresAt
                ? ` · ${t("planUntil").replace("{date}", formatDate(user.planExpiresAt, lang, { year: true }))}`
                : ""}
              {" · "}
              <span className="nums">{user.coins}</span> coins
            </span>
          </span>
          <Icon name="chevron-right" size={16} className="shrink-0 text-fg-dim" />
        </Link>
      )}

      {NAV_GROUPS.map((group) => {
        const items = group.items.filter((item) => !item.admin || user?.role === "admin");
        if (!items.length) return null;
        return (
          <nav key={group.id} className="border-b border-line py-1" aria-label={group.label[lang]} data-menu-section={group.id}>
            <p className="px-3 pt-1.5 text-label u-label text-fg-dim">{group.label[lang]}</p>
            <p className="px-3 pb-1 text-tiny text-fg-dim">{group.intent[lang]}</p>
            {items.map((item) => (
              <Row
                key={item.href}
                item={item}
                lang={lang}
                query={query}
                current={pathname === hrefFor(item, lang)}
                onNavigate={onNavigate}
              />
            ))}
            {group.hints && group.hints.length > 0 && (
              <>
                <p className="px-3 pt-2 pb-0.5 text-micro u-label text-fg-dim">{t("menuInside")}</p>
                <ul>{group.hints.map((hint) => <Hint key={hint.id} hint={hint} lang={lang} />)}</ul>
              </>
            )}
          </nav>
        );
      })}

      <div className="flex items-center justify-between gap-2 p-2">
        <LangPicker />
        {user ? (
          <Button variant="secondary" icon="logout" onClick={onLogout} loading={leaving} data-testid="logout" className="ml-auto h-8">
            {t("logout")}
          </Button>
        ) : (
          <div className="ml-auto flex gap-2">
            <LinkButton href={`/login?lang=${lang}&next=${encodeURIComponent(here)}`} className="h-8">{t("login")}</LinkButton>
            <LinkButton variant="primary" href={`/signup?lang=${lang}&next=${encodeURIComponent(here)}`} className="h-8">{t("startFreeCta")}</LinkButton>
          </div>
        )}
      </div>
    </div>
  );
}

export function AppMenu({ open, onClose, lang, sportKey, user, here, leaving = false, onLogout }: {
  open: boolean;
  onClose: () => void;
  lang: Lang;
  sportKey: string;
  user: MenuUser | null;
  here: string;
  leaving?: boolean;
  onLogout: () => void;
}) {
  const t = makeT(lang);
  const phone = useIsPhone();
  const router = useRouter();
  /** True while the history entry this menu pushed is the one on top. */
  const owned = useRef(false);
  /** What the reader asked for on the way out, run once our entry is off the stack. */
  const pending = useRef<(() => void) | null>(null);
  /** A portal needs a document, and the server has none; the same shape useIsPhone uses. */
  const mounted = useSyncExternalStore(subscribeToNothing, () => true, () => false);

  // Always listening, never tied to `open`: the pop is what closes the menu, so the handler has to
  // outlive the closing it causes. `owned` is the guard, so an unrelated back is left alone.
  useEffect(() => {
    const onPop = () => {
      if (!owned.current) return;
      owned.current = false;
      onClose();
      const run = pending.current;
      pending.current = null;
      run?.();
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [onClose]);

  useEffect(() => {
    if (!open || owned.current) return;
    // The same URL, spelled out: Next patches pushState and wants the third argument.
    window.history.pushState({ betmaticMenu: true }, "", window.location.href);
    owned.current = true;
  }, [open]);

  /**
   * The one way out. Esc, the backdrop, the close button, a row and logout all come through here:
   * the entry is popped first and the errand runs after, so nothing the menu does can be undone by
   * a back it triggered itself.
   */
  const leave = useCallback((errand?: () => void) => {
    if (!owned.current) { onClose(); errand?.(); return; }
    pending.current = errand ?? null;
    window.history.back();
  }, [onClose]);

  const close = useCallback(() => leave(), [leave]);

  /**
   * A row is a real <a> — a middle click or a modifier still opens a tab. A plain click leaves by
   * the same door, and the router is handed the destination only once the menu's entry is gone.
   */
  const navigate = useCallback((href: string, event: MouseEvent<HTMLAnchorElement>) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    const url = new URL(event.currentTarget.href, window.location.origin);
    const to = `${url.pathname}${url.search}`;
    leave(() => router.push(to));
  }, [leave, router]);

  /** Logout is not a destination — it drops the session and sends the reader home — so it is an
   *  errand like any other, run after the menu's entry is off the stack rather than against it. */
  const logout = useCallback(() => leave(onLogout), [leave, onLogout]);

  const Shell = phone ? Sheet : Dialog;
  const menu = (
    <Shell open={open} onClose={close} title={t("menuTitle")} closeLabel={t("closeMenu")}>
      <div id="app-menu" data-testid="app-menu">
        <MenuBody lang={lang} sportKey={sportKey} user={user} here={here} leaving={leaving} onNavigate={navigate} onLogout={logout} />
      </div>
    </Shell>
  );
  return mounted ? createPortal(menu, document.body) : null;
}
