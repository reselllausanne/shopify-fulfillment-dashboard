"use client";

import Link from "next/link";
import { useEffect, useState, type ComponentType, type ReactNode, type SVGProps } from "react";
import { useTheme } from "@/app/components/ThemeProvider";
import type { PartnerInfo } from "../_lib/portal";
import { Dialog } from "./Dialog";
import {
  BoltIcon,
  BookIcon,
  BoxIcon,
  CartIcon,
  ChartIcon,
  GridIcon,
  HomeIcon,
  LogoutIcon,
  MessageIcon,
  MoonIcon,
  ReceiptIcon,
  SendIcon,
  SunIcon,
  TagIcon,
  TruckIcon,
  WalletIcon,
} from "./icons";
import { FOCUS, HAIRLINE, PAGE_BG, SURFACE, TEXT, TEXT_FAINT, TEXT_MUTED, cx } from "./ui";

type Icon = ComponentType<SVGProps<SVGSVGElement> & { size?: number }>;

type NavItem = {
  href: string;
  label: string;
  /** Shorter label for the mobile tab bar. */
  short?: string;
  icon: Icon;
  exact?: boolean;
  badge?: number;
};

type NavGroup = { id: string; title: string | null; items: NavItem[] };

const HOME: NavItem = { href: "/partners/dashboard", label: "Accueil", icon: HomeIcon, exact: true };

const STOCK_ITEMS: NavItem[] = [
  { href: "/partners/stock", label: "Mon stock", short: "Stock", icon: BoxIcon },
  { href: "/partners/shipments", label: "Envois", icon: TruckIcon },
  { href: "/partners/prices", label: "Prix et canaux", short: "Prix", icon: TagIcon },
  { href: "/partners/sales", label: "Ventes et versements", short: "Ventes", icon: WalletIcon },
  { href: "/partners/requests", label: "Demandes et retraits", short: "Demandes", icon: MessageIcon },
];

const DROPSHIPPING_DASHBOARD: NavItem = { href: "/partners/dropshipping", label: "Tableau dropshipping", icon: ChartIcon };

// Existing dropshipping pages, unchanged.
const DROPSHIPPING_ITEMS: NavItem[] = [
  { href: "/partners/catalog", label: "Catalogue", icon: BookIcon },
  { href: "/partners/orders", label: "Commandes", icon: CartIcon },
  { href: "/partners/galaxus-shipments", label: "Envois Galaxus", icon: SendIcon },
  { href: "/partners/galaxus-direct-delivery", label: "Galaxus Direct", icon: BoltIcon },
  { href: "/partners/invoices", label: "Factures", icon: ReceiptIcon },
];

function isActive(pathname: string | null, item: NavItem): boolean {
  if (!pathname) return false;
  if (pathname === item.href) return true;
  return !item.exact && pathname.startsWith(`${item.href}/`);
}

function buildNav(showStock: boolean, openRequests: number): { groups: NavGroup[]; tabs: NavItem[] } {
  if (!showStock) {
    // Stock module not enabled for this partner: the portal keeps its existing entries only.
    return {
      groups: [
        { id: "home", title: null, items: [HOME] },
        { id: "dropshipping", title: "Dropshipping", items: DROPSHIPPING_ITEMS },
      ],
      tabs: [HOME, DROPSHIPPING_ITEMS[0], DROPSHIPPING_ITEMS[1], DROPSHIPPING_ITEMS[4]],
    };
  }
  const stock = STOCK_ITEMS.map((item) => (item.href === "/partners/requests" && openRequests > 0 ? { ...item, badge: openRequests } : item));
  return {
    groups: [
      { id: "home", title: null, items: [HOME] },
      { id: "stock", title: "Stock en dépôt", items: stock },
      { id: "dropshipping", title: "Dropshipping", items: [DROPSHIPPING_DASHBOARD, ...DROPSHIPPING_ITEMS] },
    ],
    tabs: [HOME, stock[0], stock[2], stock[4]],
  };
}

function BrandMark() {
  return (
    <span
      aria-hidden="true"
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#02C73A] text-[13px] font-bold tracking-tight text-[#04220D]"
    >
      RL
    </span>
  );
}

function Badge({ count }: { count: number }) {
  return (
    <span className="ml-auto inline-flex min-w-[20px] items-center justify-center rounded-full bg-[#FEF9E9] px-1.5 text-[11px] font-semibold leading-5 text-[#8A5B00] ring-1 ring-inset ring-[#FBEBC8] dark:bg-amber-400/10 dark:text-amber-300 dark:ring-amber-400/30">
      {count > 99 ? "99+" : count}
      <span className="sr-only"> {count > 1 ? "demandes ouvertes" : "demande ouverte"}</span>
    </span>
  );
}

function RailLink({ item, active, onNavigate }: { item: NavItem; active: boolean; onNavigate?: () => void }) {
  const IconCmp = item.icon;
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      onClick={onNavigate}
      className={cx(
        "flex min-h-[38px] items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors",
        FOCUS,
        active
          ? "bg-[#E6F9EB] font-semibold text-[#017723] dark:bg-[#02C73A]/10 dark:text-[#5BE584]"
          : "text-[#3D473F] hover:bg-[#F2F4F2] hover:text-[#141A16] dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-slate-100"
      )}
    >
      <IconCmp size={19} className="shrink-0" />
      <span className="truncate">{item.label}</span>
      {item.badge ? <Badge count={item.badge} /> : null}
    </Link>
  );
}

function NavGroups({
  groups,
  pathname,
  pending,
  onNavigate,
}: {
  groups: NavGroup[];
  pathname: string | null;
  pending: boolean;
  onNavigate?: () => void;
}) {
  return (
    <div className="space-y-5">
      {groups.map((group) => (
        <div key={group.id}>
          {group.title ? <div className={cx("mb-1.5 px-2.5 text-[11px] font-semibold uppercase tracking-[0.08em]", TEXT_FAINT)}>{group.title}</div> : null}
          <ul className="space-y-0.5">
            {group.items.map((item) => (
              <li key={item.href}>
                <RailLink item={item} active={isActive(pathname, item)} onNavigate={onNavigate} />
              </li>
            ))}
          </ul>
          {group.id === "home" && pending ? (
            <div aria-hidden="true" className="mt-5 space-y-2 px-2.5">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-4 animate-pulse rounded bg-[#EEF0EE] dark:bg-slate-800" style={{ width: `${70 - i * 12}%` }} />
              ))}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function ThemeButton({ withLabel, className }: { withLabel?: boolean; className?: string }) {
  const { theme, toggleTheme } = useTheme();
  // The stored theme is only known in the browser: render the label after mount.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const dark = mounted && theme === "dark";
  const label = dark ? "Passer en mode clair" : "Passer en mode sombre";
  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={label}
      title={label}
      className={cx(
        "inline-flex min-h-[38px] items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-[#3D473F] transition-colors hover:bg-[#F2F4F2] hover:text-[#141A16] dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-slate-100",
        FOCUS,
        className
      )}
    >
      {dark ? <SunIcon size={19} className="shrink-0" /> : <MoonIcon size={19} className="shrink-0" />}
      {withLabel ? <span>{dark ? "Mode clair" : "Mode sombre"}</span> : null}
    </button>
  );
}

function LogoutButton({ onLogout, className }: { onLogout: () => void; className?: string }) {
  return (
    <button
      type="button"
      onClick={onLogout}
      className={cx(
        "inline-flex min-h-[38px] items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-[#3D473F] transition-colors hover:bg-[#F2F4F2] hover:text-[#141A16] dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-slate-100",
        FOCUS,
        className
      )}
    >
      <LogoutIcon size={19} className="shrink-0" />
      <span>Se déconnecter</span>
    </button>
  );
}

function PartnerIdentity({ partner, loading }: { partner: PartnerInfo | null; loading: boolean }) {
  return (
    <div className="min-w-0">
      <div className={cx("truncate text-sm font-semibold", TEXT)}>{partner ? partner.name : loading ? "Chargement…" : "Espace partenaire"}</div>
      <div className={cx("flex items-center gap-1.5 text-xs", TEXT_FAINT)}>
        <span className="truncate">Espace partenaire</span>
        {partner ? (
          <span className="shrink-0 rounded border border-[#BDEFCB] bg-[#E6F9EB] px-1 font-mono text-[10px] font-semibold leading-4 text-[#017723] dark:border-[#02C73A]/30 dark:bg-[#02C73A]/10 dark:text-[#5BE584]">
            {partner.key}
          </span>
        ) : null}
      </div>
    </div>
  );
}

type PartnerShellProps = {
  children: ReactNode;
  pathname: string | null;
  partner: PartnerInfo | null;
  partnerLoading: boolean;
  /** Stock area visible in the navigation. */
  showStock: boolean;
  /** The portal does not know yet whether the stock area exists for this partner. */
  navPending: boolean;
  openRequests: number;
  onLogout: () => void;
};

/**
 * Shell of the partner area: left rail on desktop, top bar + bottom tab bar on mobile
 * (the "Plus" tab opens the full menu).
 */
export function PartnerShell({ children, pathname, partner, partnerLoading, showStock, navPending, openRequests, onLogout }: PartnerShellProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const { groups, tabs } = buildNav(showStock, openRequests);
  const tabActive = tabs.some((item) => isActive(pathname, item));

  // Close the mobile menu after a navigation.
  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  return (
    <div lang="fr" className={cx("min-h-screen", PAGE_BG, TEXT)}>
      <a
        href="#contenu"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-[#02C73A] focus:px-3 focus:py-2 focus:text-sm focus:font-semibold focus:text-[#04220D]"
      >
        Aller au contenu
      </a>

      {/* Desktop rail */}
      <aside className={cx("fixed inset-y-0 left-0 z-30 hidden w-[15.5rem] flex-col border-r lg:flex", SURFACE, HAIRLINE)}>
        <div className="flex items-center gap-2.5 px-4 pb-4 pt-5">
          <BrandMark />
          <PartnerIdentity partner={partner} loading={partnerLoading} />
        </div>
        <nav aria-label="Navigation principale" className="flex-1 overflow-y-auto px-3 pb-4">
          <NavGroups groups={groups} pathname={pathname} pending={navPending} />
        </nav>
        <div className={cx("flex flex-col border-t px-3 py-3", HAIRLINE)}>
          <ThemeButton withLabel />
          <LogoutButton onLogout={onLogout} />
        </div>
      </aside>

      {/* Mobile top bar */}
      <header className={cx("sticky top-0 z-30 flex items-center gap-2.5 border-b px-4 py-2.5 lg:hidden", SURFACE, HAIRLINE)}>
        <BrandMark />
        <div className="min-w-0 flex-1">
          <PartnerIdentity partner={partner} loading={partnerLoading} />
        </div>
        <ThemeButton className="h-10 w-10 justify-center px-0" />
      </header>

      <main id="contenu" className="pb-24 lg:pb-12 lg:pl-[15.5rem]">
        <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:py-8">{children}</div>
      </main>

      {/* Mobile tab bar */}
      <nav
        aria-label="Rubriques principales"
        className={cx("fixed inset-x-0 bottom-0 z-30 border-t pb-[env(safe-area-inset-bottom)] lg:hidden", SURFACE, HAIRLINE)}
      >
        <ul className="mx-auto grid max-w-md grid-cols-5">
          {tabs.map((item) => {
            const active = isActive(pathname, item);
            const IconCmp = item.icon;
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cx(
                    "relative flex min-h-[56px] flex-col items-center justify-center gap-0.5 px-1 text-[11px] leading-4",
                    FOCUS,
                    "focus-visible:-outline-offset-2",
                    active ? "font-semibold text-[#017723] dark:text-[#5BE584]" : TEXT_MUTED
                  )}
                >
                  <span className="relative">
                    <IconCmp size={21} />
                    {item.badge ? (
                      <span className="absolute -right-1.5 -top-1 h-2 w-2 rounded-full bg-[#E0A100] ring-2 ring-white dark:ring-slate-900" aria-hidden="true" />
                    ) : null}
                  </span>
                  <span className="max-w-full truncate">{item.short ?? item.label}</span>
                  {item.badge ? <span className="sr-only">, {item.badge} en attente de réponse</span> : null}
                </Link>
              </li>
            );
          })}
          <li>
            <button
              type="button"
              onClick={() => setMenuOpen(true)}
              aria-haspopup="dialog"
              aria-expanded={menuOpen}
              className={cx(
                "flex min-h-[56px] w-full flex-col items-center justify-center gap-0.5 px-1 text-[11px] leading-4",
                FOCUS,
                "focus-visible:-outline-offset-2",
                !tabActive ? "font-semibold text-[#017723] dark:text-[#5BE584]" : TEXT_MUTED
              )}
            >
              <GridIcon size={21} />
              <span>Plus</span>
            </button>
          </li>
        </ul>
      </nav>

      <Dialog open={menuOpen} onClose={() => setMenuOpen(false)} title="Menu" variant="sheet">
        <nav aria-label="Toutes les rubriques">
          <NavGroups groups={groups} pathname={pathname} pending={navPending} onNavigate={() => setMenuOpen(false)} />
        </nav>
        <div className={cx("mt-5 flex flex-col border-t pt-3", HAIRLINE)}>
          <ThemeButton withLabel />
          <LogoutButton onLogout={onLogout} />
        </div>
      </Dialog>
    </div>
  );
}
