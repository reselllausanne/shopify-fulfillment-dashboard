"use client";

import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";

type NavLink = { label: string; href: string; badge?: string };
type NavGroup = { label: string; links: NavLink[] };

const NAV_GROUPS: NavGroup[] = [
  {
    label: "Overview",
    links: [
      { label: "Orders (Home)", href: "/" },
      { label: "Dashboard", href: "/dashboard" },
      { label: "Scraped websites", href: "/scraper", badge: "new" },
    ],
  },
  {
    label: "Galaxus",
    links: [
      { label: "Orders", href: "/galaxus" },
      { label: "Dashboard", href: "/galaxus/dashboard" },
      { label: "Management", href: "/galaxus/management" },
      { label: "Pricing", href: "/galaxus/pricing" },
      { label: "Warehouse", href: "/galaxus/warehouse" },
      { label: "Warehouse shipments", href: "/galaxus/warehouse-shipments" },
      { label: "Direct delivery", href: "/galaxus/direct-delivery" },
      { label: "Invoices", href: "/galaxus/invoices" },
      { label: "View DB", href: "/galaxus/db" },
      { label: "Routing issues", href: "/galaxus/routing-issues" },
    ],
  },
  {
    label: "Decathlon",
    links: [
      { label: "Overview", href: "/decathlon" },
      { label: "Orders", href: "/decathlon/orders" },
      { label: "Returns", href: "/decathlon/returns" },
    ],
  },
  {
    label: "Finance",
    links: [
      { label: "Finance admin", href: "/finance/admin" },
      { label: "Financial", href: "/financial" },
      { label: "Cash flow", href: "/cash-flow" },
      { label: "Expenses", href: "/expenses" },
    ],
  },
  {
    label: "Ops",
    links: [
      { label: "Scan", href: "/scan" },
      { label: "Scan stats", href: "/scan/stats" },
      { label: "Restock", href: "/restock" },
      { label: "Returns", href: "/returns" },
    ],
  },
  {
    label: "Partners",
    links: [
      { label: "Dashboard", href: "/partners/dashboard" },
      { label: "Catalog", href: "/partners/catalog" },
      { label: "Orders", href: "/partners/orders" },
      { label: "Invoices", href: "/partners/invoices" },
      { label: "GTIN inbox", href: "/partners/gtin-inbox" },
      { label: "Alternative products", href: "/partners/alternative-products" },
    ],
  },
];

// Routes that render their own auth/portal chrome — no staff nav there.
const HIDE_PREFIXES = ["/login", "/partners/login", "/track"];

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function AppNav() {
  const pathname = usePathname() || "/";
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [openGroup, setOpenGroup] = useState<string | null>(null);

  if (HIDE_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return null;
  }

  const logout = async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      /* ignore */
    }
    router.push("/login");
  };

  return (
    <header className="sticky top-0 z-50 border-b border-slate-200 bg-white/85 backdrop-blur supports-[backdrop-filter]:bg-white/70">
      <nav className="mx-auto flex h-14 max-w-[1600px] items-center gap-1 px-4">
        <Link href="/" className="mr-2 flex items-center gap-2 font-semibold text-slate-900">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-900 text-xs font-bold text-white">
            RO
          </span>
          <span className="hidden sm:inline">Resell Ops</span>
        </Link>

        {/* Desktop groups */}
        <div className="hidden items-center gap-0.5 md:flex">
          {NAV_GROUPS.map((group) => {
            const groupActive = group.links.some((l) => isActive(pathname, l.href));
            return (
              <div key={group.label} className="group relative">
                <button
                  className={`flex items-center gap-1 rounded-lg px-3 py-2 text-sm font-medium transition ${
                    groupActive
                      ? "bg-slate-100 text-slate-900"
                      : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                  }`}
                >
                  {group.label}
                  <svg className="h-3.5 w-3.5 opacity-60" viewBox="0 0 20 20" fill="currentColor">
                    <path
                      fillRule="evenodd"
                      d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.17l3.71-3.94a.75.75 0 1 1 1.08 1.04l-4.25 4.5a.75.75 0 0 1-1.08 0l-4.25-4.5a.75.75 0 0 1 .02-1.06Z"
                      clipRule="evenodd"
                    />
                  </svg>
                </button>
                {/* bridge + panel */}
                <div className="invisible absolute left-0 top-full z-50 pt-1 opacity-0 transition group-hover:visible group-hover:opacity-100">
                  <div className="min-w-[220px] rounded-xl border border-slate-200 bg-white p-1.5 shadow-lg">
                    {group.links.map((link) => {
                      const active = isActive(pathname, link.href);
                      return (
                        <Link
                          key={link.href}
                          href={link.href}
                          className={`flex items-center justify-between rounded-lg px-3 py-2 text-sm transition ${
                            active
                              ? "bg-slate-900 text-white"
                              : "text-slate-700 hover:bg-slate-100"
                          }`}
                        >
                          <span>{link.label}</span>
                          {link.badge ? (
                            <span className="ml-2 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-emerald-700">
                              {link.badge}
                            </span>
                          ) : null}
                        </Link>
                      );
                    })}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={logout}
            className="hidden rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900 md:block"
          >
            Log out
          </button>
          {/* Mobile toggle */}
          <button
            onClick={() => setMobileOpen((v) => !v)}
            className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 md:hidden"
            aria-label="Toggle menu"
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              {mobileOpen ? (
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
              )}
            </svg>
          </button>
        </div>
      </nav>

      {/* Mobile menu */}
      {mobileOpen ? (
        <div className="max-h-[70vh] overflow-y-auto border-t border-slate-200 bg-white px-4 py-3 md:hidden">
          {NAV_GROUPS.map((group) => {
            const expanded = openGroup === group.label;
            return (
              <div key={group.label} className="border-b border-slate-100 last:border-0">
                <button
                  onClick={() => setOpenGroup(expanded ? null : group.label)}
                  className="flex w-full items-center justify-between py-2.5 text-sm font-semibold text-slate-800"
                >
                  {group.label}
                  <svg
                    className={`h-4 w-4 transition ${expanded ? "rotate-180" : ""}`}
                    viewBox="0 0 20 20"
                    fill="currentColor"
                  >
                    <path
                      fillRule="evenodd"
                      d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.17l3.71-3.94a.75.75 0 1 1 1.08 1.04l-4.25 4.5a.75.75 0 0 1-1.08 0l-4.25-4.5a.75.75 0 0 1 .02-1.06Z"
                      clipRule="evenodd"
                    />
                  </svg>
                </button>
                {expanded ? (
                  <div className="pb-2">
                    {group.links.map((link) => {
                      const active = isActive(pathname, link.href);
                      return (
                        <Link
                          key={link.href}
                          href={link.href}
                          onClick={() => setMobileOpen(false)}
                          className={`block rounded-lg px-3 py-2 text-sm ${
                            active ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"
                          }`}
                        >
                          {link.label}
                          {link.badge ? (
                            <span className="ml-2 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-emerald-700">
                              {link.badge}
                            </span>
                          ) : null}
                        </Link>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            );
          })}
          <button
            onClick={logout}
            className="mt-3 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
          >
            Log out
          </button>
        </div>
      ) : null}
    </header>
  );
}
