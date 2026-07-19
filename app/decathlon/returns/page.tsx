"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";

type ReceiptReturn = {
  id: string;
  platform: string;
  externalReturnId: string;
  returnName?: string | null;
  externalOrderId: string;
  externalOrderLineId: string | null;
  productId: string | null;
  productTitle: string | null;
  sku: string | null;
  returnLabelNumber: string | null;
  returnAmount: number | null;
  currency: string;
  returnReasonCode: string | null;
  returnReasonLabel: string | null;
  miraklStatus: string | null;
  localStatus: string;
  processStep: string;
  failureMessage: string | null;
  staffNote: string | null;
  orderName?: string | null;
  returnLabelUrl?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

type Toast = { type: "ok" | "err"; text: string } | null;
type ReturnsTab = "decathlon" | "shopify";
type ShopifyReason = "WRONG_SIZE" | "WRONG_ITEM" | "DAMAGED" | "OTHER";

type RequestedShopifyReturnLine = {
  id: string;
  title: string;
  sku: string | null;
  variantTitle: string | null;
  quantity: number;
  unitAmount: number | null;
  currencyCode: string | null;
  returnReason: string | null;
  returnReasonLabel: string | null;
  customerNote: string | null;
  restockingFeePercent: number | null;
  restockingFeeAmount: number | null;
};

type RequestedShopifyReturn = {
  returnId: string;
  returnName: string;
  status: string;
  createdAt: string | null;
  orderId: string;
  orderName: string;
  lineItems: RequestedShopifyReturnLine[];
  totalAmount: number | null;
  currency: string;
  alreadyTracked: boolean;
};

type ShopifyCreateForm = {
  orderNumber: string;
  reason: ShopifyReason;
  details: string;
};

export default function DecathlonReturnsReceiptPage() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [activeTab, setActiveTab] = useState<ReturnsTab>("decathlon");
  const [scanValue, setScanValue] = useState("");
  const [shopifyScanValue, setShopifyScanValue] = useState("");
  const [decathlonPending, setDecathlonPending] = useState<ReceiptReturn[]>([]);
  const [shopifyPending, setShopifyPending] = useState<ReceiptReturn[]>([]);
  const [shopifyRequested, setShopifyRequested] = useState<RequestedShopifyReturn[]>([]);
  const [loadingShopifyRequested, setLoadingShopifyRequested] = useState(false);
  const [syncingShopify, setSyncingShopify] = useState(false);
  const [shopifyLastSyncAt, setShopifyLastSyncAt] = useState<string | null>(null);
  const [acceptingReturnId, setAcceptingReturnId] = useState<string | null>(null);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [dryRun, setDryRun] = useState(true);
  const [loadingDecathlon, setLoadingDecathlon] = useState(false);
  const [loadingShopify, setLoadingShopify] = useState(false);
  const [syncingDecathlon, setSyncingDecathlon] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [shopifyNotFound, setShopifyNotFound] = useState(false);
  const [selected, setSelected] = useState<ReceiptReturn | null>(null);
  const [physicallyChecked, setPhysicallyChecked] = useState(false);
  const [rejectNote, setRejectNote] = useState("");
  const [busyAction, setBusyAction] = useState(false);
  const [submittingShopify, setSubmittingShopify] = useState(false);
  const [shopifyForm, setShopifyForm] = useState<ShopifyCreateForm>({
    orderNumber: "",
    reason: "OTHER",
    details: "",
  });
  const [toast, setToast] = useState<Toast>(null);

  const focusScan = useCallback(() => {
    window.setTimeout(() => inputRef.current?.focus(), 50);
  }, []);

  const showToast = useCallback((type: "ok" | "err", text: string) => {
    setToast({ type, text });
    window.setTimeout(() => setToast(null), 5000);
  }, []);

  const loadDecathlonPending = useCallback(async () => {
    setLoadingDecathlon(true);
    try {
      const res = await fetch("/api/decathlon/returns/receipt", { cache: "no-store" });
      const data = await res.json();
      if (!data?.ok) throw new Error(data?.error ?? "Load failed");
      setDecathlonPending(Array.isArray(data.returns) ? data.returns : []);
      setLastSyncAt(data.lastSuccessfulSyncAt ?? null);
      setDryRun(Boolean(data.dryRun));
    } catch (error: any) {
      showToast("err", error?.message ?? "Decathlon load failed");
    } finally {
      setLoadingDecathlon(false);
      focusScan();
    }
  }, [focusScan, showToast]);

  const loadShopifyPending = useCallback(async () => {
    setLoadingShopify(true);
    try {
      const res = await fetch("/api/decathlon/returns/receipt?platform=shopify", {
        cache: "no-store",
      });
      const data = await res.json();
      if (!data?.ok) throw new Error(data?.error ?? "Load failed");
      setShopifyPending(Array.isArray(data.returns) ? data.returns : []);
      setShopifyLastSyncAt(data.lastSuccessfulSyncAt ?? null);
    } catch (error: any) {
      showToast("err", error?.message ?? "Shopify load failed");
    } finally {
      setLoadingShopify(false);
    }
  }, [showToast]);

  const loadShopifyRequested = useCallback(async () => {
    setLoadingShopifyRequested(true);
    try {
      const res = await fetch("/api/shopify/returns/requested", { cache: "no-store" });
      const data = await res.json();
      if (!data?.success) throw new Error(data?.message ?? "Load failed");
      setShopifyRequested(Array.isArray(data.returns) ? data.returns : []);
    } catch (error: any) {
      showToast("err", error?.message ?? "Shopify requested returns load failed");
    } finally {
      setLoadingShopifyRequested(false);
    }
  }, [showToast]);

  const loadShopifyLastSync = useCallback(async () => {
    try {
      const res = await fetch("/api/decathlon/returns/receipt?platform=shopify", {
        cache: "no-store",
      });
      const data = await res.json();
      if (data?.ok) {
        setShopifyLastSyncAt(data.lastSuccessfulSyncAt ?? null);
      }
    } catch {
      // ignore
    }
  }, []);

  const runShopifySync = async () => {
    setSyncingShopify(true);
    try {
      const res = await fetch("/api/shopify/returns/requested", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "sync" }),
      });
      const data = await res.json();
      if (!data?.success) {
        throw new Error(data?.message ?? data?.error ?? "Sync failed");
      }
      showToast(
        "ok",
        `Synced ${data.upserted ?? 0} return(s) from Shopify${
          data.requestedCount ? ` · ${data.requestedCount} awaiting approval` : ""
        }`
      );
      setShopifyLastSyncAt(data.syncedAt ?? null);
      await loadShopifyRequested();
      await loadShopifyPending();
      await loadShopifyLastSync();
    } catch (error: any) {
      showToast("err", error?.message ?? "Shopify sync failed");
    } finally {
      setSyncingShopify(false);
    }
  };

  useEffect(() => {
    void loadDecathlonPending();
    void loadShopifyPending();
    void loadShopifyRequested();
    void loadShopifyLastSync();
    focusScan();
  }, [loadDecathlonPending, loadShopifyPending, loadShopifyRequested, loadShopifyLastSync, focusScan]);

  const openReturn = (row: ReceiptReturn) => {
    setSelected(row);
    setPhysicallyChecked(false);
    setRejectNote("");
    setNotFound(false);
    setShopifyNotFound(false);
  };

  const lookupLabel = async (label: string, platform: "decathlon" | "shopify") => {
    const trimmed = label.trim();
    if (!trimmed) return;
    if (platform === "decathlon") setNotFound(false);
    else setShopifyNotFound(false);
    try {
      const res = await fetch(
        `/api/decathlon/returns/receipt?platform=${platform}&label=${encodeURIComponent(trimmed)}`,
        { cache: "no-store" }
      );
      const data = await res.json();
      if (!data?.found) {
        if (platform === "decathlon") setNotFound(true);
        else setShopifyNotFound(true);
        setSelected(null);
        showToast("err", `Return not found on ${platform}.`);
        return;
      }
      openReturn(data.return as ReceiptReturn);
    } catch (error: any) {
      showToast("err", error?.message ?? "Lookup failed");
    } finally {
      if (platform === "decathlon") setScanValue("");
      else setShopifyScanValue("");
      focusScan();
    }
  };

  const onScanSubmit = (event: FormEvent) => {
    event.preventDefault();
    void lookupLabel(scanValue, "decathlon");
  };

  const onShopifyScanSubmit = (event: FormEvent) => {
    event.preventDefault();
    void lookupLabel(shopifyScanValue, "shopify");
  };

  const runDecathlonSync = async () => {
    setSyncingDecathlon(true);
    try {
      const res = await fetch("/api/decathlon/returns/receipt", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "sync" }),
      });
      const data = await res.json();
      if (!data?.ok) throw new Error(data?.error ?? data?.result?.errors?.join("; ") ?? "Sync failed");
      showToast("ok", `Synced ${data.result?.upserted ?? 0} return(s)`);
      await loadDecathlonPending();
    } catch (error: any) {
      showToast("err", error?.message ?? "Sync failed");
    } finally {
      setSyncingDecathlon(false);
      focusScan();
    }
  };

  const postReturnAction = async (action: "confirm" | "reject" | "retry") => {
    if (!selected) return;
    setBusyAction(true);
    try {
      const res = await fetch(`/api/decathlon/returns/receipt/${selected.id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action,
          physicallyChecked: action === "confirm" ? physicallyChecked : undefined,
          staffNote: action === "reject" ? rejectNote : undefined,
        }),
      });
      const data = await res.json();
      if (!data?.ok) {
        showToast("err", data?.message ?? data?.failureMessage ?? data?.error ?? "Action failed");
      } else {
        showToast("ok", data?.message ?? "Done");
        setSelected(null);
      }
      if (selected.platform === "shopify") {
        await loadShopifyPending();
      } else {
        await loadDecathlonPending();
      }
    } catch (error: any) {
      showToast("err", error?.message ?? "Action failed");
    } finally {
      setBusyAction(false);
      focusScan();
    }
  };

  const acceptShopifyRequestedReturn = async (returnId: string) => {
    setAcceptingReturnId(returnId);
    try {
      const res = await fetch("/api/shopify/returns/accept", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ returnId }),
      });
      const data = await res.json();
      if (!res.ok || !data?.success) {
        throw new Error(data?.message ?? data?.error ?? "Accept failed");
      }
      showToast(
        "ok",
        `Accepted ${data.name ?? returnId} — label ${data.returnTrackingNumber ?? "created"}`
      );
      await loadShopifyRequested();
      await loadShopifyPending();
    } catch (error: any) {
      showToast("err", error?.message ?? "Accept failed");
    } finally {
      setAcceptingReturnId(null);
    }
  };

  const submitShopifyReturn = async (event: FormEvent) => {
    event.preventDefault();
    setSubmittingShopify(true);
    try {
      const res = await fetch("/api/shopify/returns/request", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(shopifyForm),
      });
      const data = await res.json();
      if (!res.ok || !data?.success) {
        throw new Error(data?.message ?? data?.error ?? "Shopify return request failed");
      }
      showToast("ok", `Shopify return opened: ${data.name ?? data.returnId}`);
      setShopifyForm({
        orderNumber: "",
        reason: "OTHER",
        details: "",
      });
      await loadShopifyPending();
    } catch (error: any) {
      showToast("err", error?.message ?? "Shopify return request failed");
    } finally {
      setSubmittingShopify(false);
    }
  };

  const renderDecathlonTab = () => (
    <>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Decathlon returns</h2>
          <p className="mt-1 text-sm text-slate-600">
            Scan return label → confirm receipt & refund.{" "}
            {dryRun ? (
              <span className="font-medium text-amber-700">DRY-RUN on</span>
            ) : (
              <span className="font-medium text-red-700">LIVE refunds</span>
            )}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Last sync: {lastSyncAt ? new Date(lastSyncAt).toLocaleString() : "never"}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void runDecathlonSync()}
          disabled={syncingDecathlon}
          className="rounded-md bg-slate-900 px-3 py-2 text-sm text-white disabled:opacity-50"
        >
          {syncingDecathlon ? "Syncing..." : "Sync returns now"}
        </button>
      </div>

      <form onSubmit={onScanSubmit} className="mb-6">
        <label className="mb-2 block text-sm font-medium text-slate-700">
          Scan return label / tracking
        </label>
        <input
          ref={inputRef}
          value={scanValue}
          onChange={(e) => setScanValue(e.target.value)}
          autoFocus
          autoComplete="off"
          placeholder="Scan barcode then Enter"
          className="w-full rounded-md border border-slate-300 bg-white px-4 py-3 text-lg shadow-sm outline-none ring-slate-400 focus:ring-2"
        />
      </form>

      {notFound && (
        <div className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Return not found. Sync Decathlon returns first.
        </div>
      )}

      <div className="rounded-md border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-4 py-3 text-sm font-medium text-slate-700">
          Pending returns {loadingDecathlon ? "(loading...)" : `(${decathlonPending.length})`}
        </div>
        <ul className="divide-y divide-slate-100">
          {decathlonPending.length === 0 && !loadingDecathlon && (
            <li className="px-4 py-6 text-sm text-slate-500">No pending returns.</li>
          )}
          {decathlonPending.map((row) => (
            <li key={row.id}>
              <button
                type="button"
                onClick={() => openReturn(row)}
                className="flex w-full flex-col gap-1 px-4 py-3 text-left hover:bg-slate-50"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-mono text-sm font-medium">
                    {row.returnLabelNumber ?? "(no label)"}
                  </span>
                  <span className="text-xs uppercase tracking-wide text-slate-500">
                    {row.localStatus}
                    {row.miraklStatus ? ` · ${row.miraklStatus}` : ""}
                  </span>
                </div>
                <div className="text-sm text-slate-700">
                  {row.productTitle ?? row.sku ?? row.productId ?? "—"}
                  {row.sku ? ` · SKU ${row.sku}` : ""}
                </div>
                <div className="text-xs text-slate-500">
                  Order {row.externalOrderId}
                  {" · "}
                  {row.returnAmount != null
                    ? `${row.returnAmount.toFixed(2)} ${row.currency}`
                    : "amount n/a"}
                  {" · "}
                  {row.returnReasonLabel ?? row.returnReasonCode ?? "no reason"}
                </div>
                {row.failureMessage && (
                  <div className="text-xs text-red-600">{row.failureMessage}</div>
                )}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </>
  );

  const renderShopifyTab = () => (
    <>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Shopify returns</h2>
          <p className="mt-1 text-sm text-slate-600">
            Sync from Shopify Admin, accept return requests, then scan label for store credit.
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Last sync:{" "}
            {shopifyLastSyncAt ? new Date(shopifyLastSyncAt).toLocaleString() : "never"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              void loadShopifyRequested();
              void loadShopifyPending();
            }}
            disabled={loadingShopifyRequested || loadingShopify || syncingShopify}
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 disabled:opacity-50"
          >
            {loadingShopifyRequested || loadingShopify ? "Refreshing..." : "Refresh lists"}
          </button>
          <button
            type="button"
            onClick={() => void runShopifySync()}
            disabled={syncingShopify || loadingShopifyRequested || loadingShopify}
            className="rounded-md bg-slate-900 px-3 py-2 text-sm text-white disabled:opacity-50"
          >
            {syncingShopify ? "Syncing..." : "Sync from Shopify"}
          </button>
        </div>
      </div>

      <div className="mb-6 rounded-md border border-amber-200 bg-amber-50">
        <div className="border-b border-amber-200 px-4 py-3 text-sm font-medium text-amber-900">
          Return requested in Shopify{" "}
          {loadingShopifyRequested
            ? "(loading...)"
            : `(${shopifyRequested.length})`}
        </div>
        <ul className="divide-y divide-amber-100">
          {shopifyRequested.length === 0 && !loadingShopifyRequested && (
            <li className="px-4 py-6 text-sm text-amber-800">
              No pending Shopify return requests.
            </li>
          )}
          {shopifyRequested.map((row) => (
            <li key={row.returnId} className="px-4 py-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm font-medium text-slate-900">
                      {row.orderName}
                    </span>
                    <span className="text-xs uppercase tracking-wide text-amber-700">
                      {row.returnName} · {row.status}
                    </span>
                  </div>
                  {row.createdAt && (
                    <p className="mt-1 text-xs text-slate-500">
                      Requested {new Date(row.createdAt).toLocaleString()}
                    </p>
                  )}
                  {row.lineItems.map((line) => (
                    <div key={line.id} className="mt-2 text-sm text-slate-700">
                      <div>
                        {line.title}
                        {line.variantTitle ? ` · ${line.variantTitle}` : ""}
                        {line.sku ? ` · SKU ${line.sku}` : ""}
                      </div>
                      <div className="text-xs text-slate-500">
                        Qty {line.quantity}
                        {line.unitAmount != null
                          ? ` · ${line.unitAmount.toFixed(2)} ${line.currencyCode ?? row.currency}`
                          : ""}
                        {line.returnReasonLabel ? ` · ${line.returnReasonLabel}` : ""}
                        {line.customerNote ? ` · "${line.customerNote}"` : ""}
                        {line.restockingFeePercent != null
                          ? ` · restocking ${line.restockingFeePercent}%`
                          : ""}
                        {line.restockingFeeAmount != null
                          ? ` (${line.restockingFeeAmount.toFixed(2)} ${row.currency})`
                          : ""}
                      </div>
                    </div>
                  ))}
                  {row.totalAmount != null && (
                    <p className="mt-2 text-xs text-slate-500">
                      Total {row.totalAmount.toFixed(2)} {row.currency}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => void acceptShopifyRequestedReturn(row.returnId)}
                  disabled={acceptingReturnId === row.returnId}
                  className="shrink-0 rounded-md bg-slate-900 px-3 py-2 text-sm text-white disabled:opacity-50"
                >
                  {acceptingReturnId === row.returnId ? "Accepting..." : "Accept + label"}
                </button>
              </div>
            </li>
          ))}
        </ul>
      </div>

      <form onSubmit={onShopifyScanSubmit} className="mb-6">
        <label className="mb-2 block text-sm font-medium text-slate-700">
          Scan Shopify return label (receipt + store credit)
        </label>
        <input
          value={shopifyScanValue}
          onChange={(e) => setShopifyScanValue(e.target.value)}
          autoComplete="off"
          placeholder="Scan barcode then Enter"
          className="w-full rounded-md border border-slate-300 bg-white px-4 py-3 text-lg shadow-sm outline-none ring-slate-400 focus:ring-2"
        />
      </form>

      {shopifyNotFound && (
        <div className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Shopify return not found for this label.
        </div>
      )}

      <form
        onSubmit={submitShopifyReturn}
        className="mb-6 grid gap-3 rounded-md border border-slate-200 bg-white p-4"
      >
        <div className="grid gap-3 md:grid-cols-1">
          <label className="text-sm">
            <span className="mb-1 block text-slate-600">Order number</span>
            <input
              value={shopifyForm.orderNumber}
              onChange={(e) =>
                setShopifyForm((prev) => ({ ...prev, orderNumber: e.target.value }))
              }
              placeholder="#1234"
              className="w-full rounded-md border border-slate-300 px-3 py-2"
            />
          </label>
        </div>
        <label className="text-sm">
          <span className="mb-1 block text-slate-600">Reason</span>
          <select
            value={shopifyForm.reason}
            onChange={(e) =>
              setShopifyForm((prev) => ({
                ...prev,
                reason: e.target.value as ShopifyReason,
              }))
            }
            className="w-full rounded-md border border-slate-300 px-3 py-2"
          >
            <option value="WRONG_SIZE">Wrong size</option>
            <option value="WRONG_ITEM">Wrong item</option>
            <option value="DAMAGED">Damaged</option>
            <option value="OTHER">Other</option>
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-slate-600">Details</span>
          <textarea
            rows={3}
            value={shopifyForm.details}
            onChange={(e) =>
              setShopifyForm((prev) => ({ ...prev, details: e.target.value }))
            }
            placeholder="Explain why customer wants to return."
            className="w-full rounded-md border border-slate-300 px-3 py-2"
          />
        </label>
        <div className="flex justify-end">
          <button
            type="submit"
            disabled={submittingShopify}
            className="rounded-md bg-slate-900 px-3 py-2 text-sm text-white disabled:opacity-50"
          >
            {submittingShopify ? "Submitting..." : "Create and open Shopify return"}
          </button>
        </div>
      </form>

      <div className="rounded-md border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-4 py-3 text-sm font-medium text-slate-700">
          Shopify pending returns {loadingShopify ? "(loading...)" : `(${shopifyPending.length})`}
        </div>
        <ul className="divide-y divide-slate-100">
          {shopifyPending.length === 0 && !loadingShopify && (
            <li className="px-4 py-6 text-sm text-slate-500">No Shopify returns yet.</li>
          )}
          {shopifyPending.map((row) => (
            <li key={row.id}>
              <button
                type="button"
                onClick={() => openReturn(row)}
                className="flex w-full flex-col gap-1 px-4 py-3 text-left hover:bg-slate-50"
              >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-mono text-sm">
                  {row.orderName ?? row.externalOrderId}
                </span>
                <span className="text-xs uppercase tracking-wide text-slate-500">
                  {row.localStatus}
                  {row.miraklStatus ? ` · ${row.miraklStatus}` : ""}
                </span>
              </div>
              <div className="mt-1 text-sm text-slate-700">
                Return {row.returnName ?? row.externalReturnId}
              </div>
              <div className="mt-1 text-xs text-slate-500">
                Label {row.returnLabelNumber ?? "n/a"}
                {row.returnLabelUrl ? (
                  <>
                    {" · "}
                    <a
                      href={row.returnLabelUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-blue-700 underline"
                      onClick={(e) => e.stopPropagation()}
                    >
                      open label
                    </a>
                  </>
                ) : null}
              </div>
              <div className="mt-1 text-xs text-slate-500">
                {row.returnAmount != null
                  ? `${row.returnAmount.toFixed(2)} ${row.currency}`
                  : "amount n/a"}
                {" · "}
                {row.returnReasonLabel ?? row.returnReasonCode ?? "no reason"}
                {" · "}
                {row.createdAt ? new Date(row.createdAt).toLocaleString() : "created time n/a"}
              </div>
              {row.failureMessage && (
                <div className="mt-1 text-xs text-red-600">{row.failureMessage}</div>
              )}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </>
  );

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="mx-auto max-w-4xl px-4 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight">Returns operations</h1>
          <p className="mt-1 text-sm text-slate-600">
            Decathlon receipt flow + Shopify auto-open returns in one staff page.
          </p>
        </div>

        <div className="mb-6 flex gap-2">
          <button
            type="button"
            onClick={() => setActiveTab("decathlon")}
            className={`rounded-md px-3 py-2 text-sm ${
              activeTab === "decathlon"
                ? "bg-slate-900 text-white"
                : "border border-slate-300 bg-white text-slate-700"
            }`}
          >
            Decathlon
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("shopify")}
            className={`rounded-md px-3 py-2 text-sm ${
              activeTab === "shopify"
                ? "bg-slate-900 text-white"
                : "border border-slate-300 bg-white text-slate-700"
            }`}
          >
            Shopify
          </button>
        </div>

        {toast && (
          <div
            className={`mb-4 rounded-md px-3 py-2 text-sm ${
              toast.type === "ok"
                ? "border border-emerald-300 bg-emerald-50 text-emerald-900"
                : "border border-red-300 bg-red-50 text-red-900"
            }`}
          >
            {toast.text}
          </div>
        )}

        {activeTab === "decathlon" ? renderDecathlonTab() : renderShopifyTab()}
      </div>

      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg bg-white p-5 shadow-xl">
            <h2 className="text-lg font-semibold">
              {selected.platform === "shopify"
                ? "Accept Shopify return"
                : "Confirm Decathlon return"}
            </h2>
            <dl className="mt-4 space-y-2 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500">Platform</dt>
                <dd className="font-medium capitalize">{selected.platform}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500">Return label</dt>
                <dd className="font-mono">{selected.returnLabelNumber ?? "—"}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500">Order ID</dt>
                <dd className="font-mono text-right">{selected.externalOrderId}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500">Product</dt>
                <dd className="text-right">
                  {selected.productTitle ?? "—"}
                  {selected.sku ? ` (${selected.sku})` : ""}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500">
                  {selected.platform === "shopify" ? "Store credit amount" : "Refund amount"}
                </dt>
                <dd className="font-semibold">
                  {selected.returnAmount != null
                    ? `${selected.returnAmount.toFixed(2)} ${selected.currency}`
                    : "—"}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500">Return reason</dt>
                <dd className="text-right">
                  {selected.returnReasonLabel ?? selected.returnReasonCode ?? "—"}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500">Local / Mirakl</dt>
                <dd>
                  {selected.localStatus} / {selected.miraklStatus ?? "—"}
                </dd>
              </div>
              {selected.failureMessage && (
                <div className="rounded-md bg-red-50 px-2 py-1 text-xs text-red-700">
                  {selected.failureMessage}
                </div>
              )}
            </dl>

            <label className="mt-5 flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={physicallyChecked}
                onChange={(e) => setPhysicallyChecked(e.target.checked)}
              />
              <span>I physically checked the returned item</span>
            </label>

            {selected.platform !== "shopify" && (
              <div className="mt-4">
                <label className="mb-1 block text-xs text-slate-500">
                  Staff note (optional, for reject)
                </label>
                <textarea
                  value={rejectNote}
                  onChange={(e) => setRejectNote(e.target.value)}
                  rows={2}
                  className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
                />
              </div>
            )}

            <div className="mt-5 flex flex-col gap-2">
              <button
                type="button"
                disabled={busyAction || !physicallyChecked}
                onClick={() => void postReturnAction("confirm")}
                className="rounded-md bg-emerald-700 px-3 py-2 text-sm font-medium text-white disabled:opacity-40"
              >
                {selected.platform === "shopify"
                  ? "Accept received & issue store credit"
                  : "Confirm received & refund"}
              </button>

              {selected.platform !== "shopify" && (
                <button
                  type="button"
                  disabled={busyAction}
                  onClick={() => void postReturnAction("reject")}
                  className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
                >
                  Not conform / reject
                </button>
              )}
              {selected.platform !== "shopify" && selected.localStatus === "failed" && (
                <button
                  type="button"
                  disabled={busyAction}
                  onClick={() => void postReturnAction("retry")}
                  className="rounded-md bg-amber-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-40"
                >
                  Retry failed step
                </button>
              )}
              <button
                type="button"
                disabled={busyAction}
                onClick={() => {
                  setSelected(null);
                  focusScan();
                }}
                className="rounded-md px-3 py-2 text-sm text-slate-600"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
