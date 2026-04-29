"use client";

import { useEffect, useState } from "react";
import { STOCKX_GET_BUY_ORDER_OPERATION_NAME } from "@/app/lib/constants";

type Props = {
  orderId: string | null;
  onAfterAction?: () => void | Promise<void>;
  apiBasePath?: string;
  /** POST …/orders/:id/<path> — default: stockx/sync (Decathlon), stx/sync (Galaxus). */
  ordersSyncPath?: string;
  sessionFile?: string;
  sessionMetaFile?: string;
  tokenFile?: string;
  persistedHashesFile?: string;
  hashOperationName?: string;
};

export function StockxOrderTools({
  orderId,
  onAfterAction,
  apiBasePath = "/api/galaxus",
  ordersSyncPath,
  sessionFile = ".data/stockx-session-galaxus.json",
  sessionMetaFile = ".data/stockx-session-meta-galaxus.json",
  tokenFile = ".data/stockx-token-galaxus.json",
  persistedHashesFile = ".data/stockx-persisted-hashes-galaxus.json",
  hashOperationName = STOCKX_GET_BUY_ORDER_OPERATION_NAME,
}: Props) {
  const resolvedOrdersSyncPath =
    ordersSyncPath ?? (apiBasePath.includes("decathlon") ? "stockx/sync" : "stx/sync");
  const [busy, setBusy] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [log, setLog] = useState<string | null>(null);
  const [manualToken, setManualToken] = useState<string>("");
  const [manualHash, setManualHash] = useState<string>("");
  const [hashLoaded, setHashLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`${apiBasePath}/stx/hash`, { cache: "no-store" });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || data?.ok === false) return;
        const hash = typeof data?.hash === "string" ? data.hash.trim() : "";
        if (!cancelled) setManualHash(hash);
      } catch {
        // ignore load error; manual entry still possible
      } finally {
        if (!cancelled) setHashLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiBasePath]);

  const after = async () => {
    if (onAfterAction) await onAfterAction();
  };

  const stockxLogin = async () => {
    setBusy("login");
    setLocalError(null);
    setLog(null);
    try {
      const res = await fetch("/api/stockx/playwright", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          forceLogin: false,
          headless: false,
          browser: "firefox",
          persistent: true,
          maxWaitMs: 120000,
          waitForUserClose: false,
          autoNavigate: false,
          startUrl: "https://stockx.com/login",
          reuseTokenFile: true,
          sessionFile,
          sessionMetaFile,
          tokenFile,
          persistedHashesFile,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.ok === false) throw new Error(data?.error ?? "StockX login failed");
      setLog(JSON.stringify(data, null, 2));
      await after();
    } catch (e: any) {
      setLocalError(e?.message ?? "StockX login failed");
    } finally {
      setBusy(null);
    }
  };

  const syncOrders = async () => {
    if (!orderId?.trim()) {
      setLocalError("Select an order first.");
      return;
    }
    setBusy("sync");
    setLocalError(null);
    setLog(null);
    try {
      const res = await fetch(`${apiBasePath}/orders/${orderId}/${resolvedOrdersSyncPath}`, {
        method: "POST",
      });
      const data = await res.json().catch(() => ({}));
      if (!data.ok) throw new Error(data.error ?? "Sync failed");
      setLog(
        JSON.stringify(
          {
            stockxBuyingOrdersEnriched: data.stockxBuyingOrdersEnriched ?? [],
            ok: data.ok,
            sync: data.sync ?? null,
            stockxListWarning: data.stockxListWarning ?? null,
          },
          null,
          2
        )
      );
      await after();
    } catch (e: any) {
      setLocalError(e?.message ?? "Sync failed");
    } finally {
      setBusy(null);
    }
  };

  const saveManualToken = async () => {
    const token = manualToken.trim();
    if (!token) {
      setLocalError("Paste a StockX token first.");
      return;
    }
    setBusy("token");
    setLocalError(null);
    setLog(null);
    try {
      const res = await fetch(`${apiBasePath}/stx/token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.ok === false) throw new Error(data?.error ?? "Save token failed");
      setLog("✅ Token saved for StockX.");
      setManualToken("");
      await after();
    } catch (e: any) {
      setLocalError(e?.message ?? "Save token failed");
    } finally {
      setBusy(null);
    }
  };

  const saveManualHash = async () => {
    const hash = manualHash.trim().toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(hash)) {
      setLocalError("Hash must be 64 hex chars.");
      return;
    }
    setBusy("hash");
    setLocalError(null);
    setLog(null);
    try {
      const res = await fetch(`${apiBasePath}/stx/hash`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hash, operationName: hashOperationName }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.ok === false) throw new Error(data?.error ?? "Save hash failed");
      setManualHash(String(data?.hash ?? hash));
      setLog(`✅ Hash saved (${hashOperationName}).`);
      await after();
    } catch (e: any) {
      setLocalError(e?.message ?? "Save hash failed");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="rounded border border-amber-200 bg-amber-50/90 p-3 space-y-2">
      <div className="text-sm font-medium text-gray-900">StockX — login &amp; sync</div>
      <p className="text-xs text-gray-600">
        Browser login writes the token file on the server. <strong>Sync orders + AWB</strong> links purchase units and
        stores tracking; line status (checkmarks) comes from the refreshed order.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <button
          type="button"
          className="px-3 py-2 rounded bg-violet-600 text-white text-xs disabled:opacity-50"
          onClick={() => void stockxLogin()}
          disabled={busy !== null}
        >
          {busy === "login" ? "Opening…" : "StockX login (browser)"}
        </button>
        <button
          type="button"
          className="px-3 py-2 rounded bg-indigo-600 text-white text-xs disabled:opacity-50"
          onClick={() => void syncOrders()}
          disabled={busy !== null || !orderId}
        >
          {busy === "sync" ? "Syncing…" : "Sync orders + AWB"}
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          className="w-full sm:w-80 px-2 py-1 rounded border border-gray-300 text-xs"
          placeholder="Paste StockX token (manual)"
          value={manualToken}
          onChange={(e) => setManualToken(e.target.value)}
        />
        <button
          type="button"
          className="px-3 py-2 rounded bg-emerald-600 text-white text-xs disabled:opacity-50"
          onClick={() => void saveManualToken()}
          disabled={busy !== null}
        >
          {busy === "token" ? "Saving…" : "Save token"}
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          className="w-full sm:w-[38rem] px-2 py-1 rounded border border-gray-300 text-xs font-mono"
          placeholder={`Persisted hash (${hashOperationName})`}
          value={manualHash}
          onChange={(e) => setManualHash(e.target.value)}
        />
        <button
          type="button"
          className="px-3 py-2 rounded bg-sky-700 text-white text-xs disabled:opacity-50"
          onClick={() => void saveManualHash()}
          disabled={busy !== null}
        >
          {busy === "hash" ? "Saving…" : "Save hash"}
        </button>
        {!hashLoaded ? (
          <span className="text-[11px] text-gray-500">Loading hash…</span>
        ) : null}
      </div>
      {localError ? <div className="text-xs text-red-600">{localError}</div> : null}
      {log ? (
        <pre className="text-[11px] max-h-36 overflow-auto rounded bg-gray-900 p-2 text-gray-100">{log}</pre>
      ) : null}
    </div>
  );
}
