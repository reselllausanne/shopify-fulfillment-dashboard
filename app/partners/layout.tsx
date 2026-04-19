"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

type PartnerInfo = {
  id: string;
  key: string;
  name: string;
};

const NAV_ITEMS = [
  { href: "/partners/dashboard", label: "Dashboard" },
  { href: "/partners/catalog", label: "Catalog" },
  { href: "/partners/orders", label: "Orders" },
];

export default function PartnerLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [partner, setPartner] = useState<PartnerInfo | null>(null);
  const [loading, setLoading] = useState(false);

  const showShell = useMemo(() => !pathname?.startsWith("/partners/login"), [pathname]);

  useEffect(() => {
    if (!showShell) return;
    let active = true;
    const load = async () => {
      setLoading(true);
      try {
        const res = await fetch("/api/partners/me", { cache: "no-store" });
        if (res.status === 401) {
          const callbackUrl = encodeURIComponent(pathname ?? "/partners/dashboard");
          router.push(`/partners/login?callbackUrl=${callbackUrl}`);
          return;
        }
        const data = await res.json();
        if (active && data?.ok) {
          setPartner(data.partner ?? null);
        }
      } catch {
        // ignore
      } finally {
        if (active) setLoading(false);
      }
    };
    load();
    return () => {
      active = false;
    };
  }, [pathname, router, showShell]);

  const logout = async () => {
    await fetch("/api/partners/auth/logout", { method: "POST" });
    router.push("/partners/login");
    router.refresh();
  };

  if (!showShell) {
    return <>{children}</>;
  }

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      <header className="bg-slate-950 text-white">
        <div className="mx-auto max-w-6xl px-6 py-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="text-sm uppercase tracking-[0.2em] text-slate-300">Partner Console</div>
              <div className="text-2xl font-semibold">
                {partner ? partner.name : loading ? "Loading…" : "Welcome"}
              </div>
              <div className="text-xs text-slate-400">
                {partner ? `Partner key: ${partner.key}` : "Standalone portal"}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                className="rounded-full border border-slate-800 bg-slate-900 px-4 py-2 text-xs uppercase tracking-wide text-slate-200 hover:border-[#55b3f3] hover:text-white"
                onClick={logout}
              >
                Sign out
              </button>
            </div>
          </div>
          <nav className="mt-5 flex flex-wrap gap-2">
            {NAV_ITEMS.map((item) => {
              const active =
                pathname === item.href || (item.href !== "/partners/dashboard" && pathname?.startsWith(item.href));
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={
                    active
                      ? "rounded-full bg-[#55b3f3] px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-950"
                      : "rounded-full border border-slate-800 px-4 py-2 text-xs uppercase tracking-wide text-slate-300 hover:border-[#55b3f3] hover:text-white"
                  }
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>
        <div className="h-1 w-full bg-gradient-to-r from-[#55b3f3] via-[#7ac6f6] to-transparent" />
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
    </div>
  );
}
