"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { PartnerShell } from "./_components/PartnerShell";
import { PartnerApiError, isModuleDisabled, partnerApi, type PartnerStockSummary } from "./_lib/api";
import { PartnerPortalProvider, type PartnerInfo, type PartnerPortalValue, type StockModuleState } from "./_lib/portal";

/** Remembers, for this browser tab, whether the stock area was shown — avoids a menu flicker. */
const NAV_HINT_KEY = "rl-partner-stock-nav";

function readNavHint(): boolean {
  try {
    return window.sessionStorage.getItem(NAV_HINT_KEY) === "1";
  } catch {
    return false;
  }
}

function writeNavHint(enabled: boolean | null): void {
  try {
    if (enabled === null) window.sessionStorage.removeItem(NAV_HINT_KEY);
    else window.sessionStorage.setItem(NAV_HINT_KEY, enabled ? "1" : "0");
  } catch {
    // private mode: the hint is optional
  }
}

export default function PartnerLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [partner, setPartner] = useState<PartnerInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [moduleState, setModuleState] = useState<StockModuleState>("loading");
  const [summary, setSummary] = useState<PartnerStockSummary | null>(null);
  const [summaryError, setSummaryError] = useState<PartnerApiError | null>(null);
  const [navHint, setNavHint] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);

  const showShell = useMemo(() => !pathname?.startsWith("/partners/login"), [pathname]);

  useEffect(() => {
    setNavHint(readNavHint());
  }, []);

  // On the login screen nothing of a previous session may remain in memory.
  useEffect(() => {
    if (showShell) return;
    setPartner(null);
    setSummary(null);
    setSummaryError(null);
    setModuleState("loading");
  }, [showShell]);

  // Session check on every navigation (unchanged behaviour): 401 goes back to the partner login.
  // The stock summary is then asked once per navigation: it tells whether the stock module is
  // enabled for this partner (MODULE_DISABLED keeps the portal exactly as it was).
  useEffect(() => {
    if (!showShell) return;
    let active = true;
    const load = async () => {
      setLoading(true);
      let authenticated = false;
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
          authenticated = true;
        }
      } catch {
        // ignore
      } finally {
        if (active) setLoading(false);
      }
      if (!active || !authenticated) return;

      try {
        const next = await partnerApi.summary();
        if (!active) return;
        setSummary(next);
        setSummaryError(null);
        setModuleState("enabled");
        setNavHint(true);
        writeNavHint(true);
      } catch (err) {
        if (!active) return;
        if (isModuleDisabled(err)) {
          setSummary(null);
          setSummaryError(null);
          setModuleState("disabled");
          setNavHint(false);
          writeNavHint(false);
          return;
        }
        if (err instanceof PartnerApiError && err.code === "UNAUTHORIZED") return; // redirect in progress
        setSummaryError(
          err instanceof PartnerApiError ? err : new PartnerApiError("UNKNOWN", "Une erreur inattendue est survenue. Réessayez dans un instant.", 0)
        );
        // Keep what was already known; never assume the module state from a failure.
        setModuleState((prev) => (prev === "enabled" ? "enabled" : "error"));
      }
    };
    load();
    return () => {
      active = false;
    };
  }, [pathname, router, showShell, refreshTick]);

  const logout = async () => {
    await fetch("/api/partners/auth/logout", { method: "POST" });
    writeNavHint(null);
    setPartner(null);
    setSummary(null);
    setSummaryError(null);
    setModuleState("loading");
    setNavHint(false);
    router.push("/partners/login");
    router.refresh();
  };

  const refreshSummary = useCallback(() => setRefreshTick((t) => t + 1), []);

  const portal = useMemo<PartnerPortalValue>(
    () => ({ partner, partnerLoading: loading, moduleState, summary, summaryError, refreshSummary }),
    [partner, loading, moduleState, summary, summaryError, refreshSummary]
  );

  if (!showShell) {
    return <>{children}</>;
  }

  const showStock = moduleState === "enabled" || (moduleState === "loading" && navHint);

  return (
    <PartnerPortalProvider value={portal}>
      <PartnerShell
        pathname={pathname}
        partner={partner}
        partnerLoading={loading}
        showStock={showStock}
        navPending={moduleState === "loading" && !navHint}
        openRequests={summary?.openRequests ?? 0}
        onLogout={logout}
      >
        {children}
      </PartnerShell>
    </PartnerPortalProvider>
  );
}
