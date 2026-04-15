"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type OrderListItem = {
  id: string;
  galaxusOrderId: string;
  orderNumber?: string | null;
  orderDate: string;
  deliveryType: string | null;
  shippedCount: number;
  fulfilledCount: number;
  warehouseLinesShipped?: number;
  fulfillmentState?: "fulfilled" | "shipped" | "to_process";
  _count?: { lines: number; shipments: number };
  invoiceLinesFullyInvoiced?: number | null;
  invoiceLinesTotal?: number | null;
};

type EligibleLine = {
  id: string;
  lineNumber: number | null;
  supplierPid: string | null;
  buyerPid: string | null;
  gtin: string | null;
  quantity: number;
  unitNetPrice: number | string | null;
  priceLineAmount: number | string | null;
  lineNetAmount: number | string | null;
  description: string | null;
  productName: string | null;
  size: string | null;
  sizeRaw: string | null;
  supplierSku: string | null;
  orderUnit: string | null;
};

type EligibleOrder = {
  id: string;
  galaxusOrderId: string;
  orderNumber?: string | null;
  orderDate: string;
  deliveryType: string | null;
  currencyCode?: string | null;
  recipientName?: string | null;
  recipientAddress1?: string | null;
  recipientPostalCode?: string | null;
  recipientCity?: string | null;
  lines: EligibleLine[];
};

type ShipmentCoverage = {
  ordered: number;
  shipped: number;
  reserved: number;
  remaining: number;
};

type DraftShipment = {
  id: string;
  shipmentId: string;
  dispatchNotificationId: string | null;
  packageId: string | null;
  trackingNumber: string | null;
  delrStatus: string | null;
  createdAt: string;
  orderNumbers: string[];
  itemCount: number;
  anchorOrderId?: string | null;
  anchorOrderNumber?: string | null;
};

type RecentShipment = {
  id: string;
  shipmentId: string;
  dispatchNotificationId: string | null;
  createdAt: string;
  delrStatus: string | null;
  orderNumber: string | null;
  galaxusOrderId: string | null;
  ssccLabelUrl: string | null;
  deliveryNoteUrl: string | null;
};

type SelectedLine = {
  lineId: string;
  sourceOrderId: string;
  quantity: number;
};

type CreatedShipment = {
  id: string;
  orderId: string;
  shipmentId?: string | null;
  dispatchNotificationId?: string | null;
  packageId?: string | null;
  providerKey?: string | null;
  trackingNumber?: string | null;
  delrStatus?: string | null;
};

/** Short label like `[invoiced]` / `[20/22 - 2 left]` / `[not invoiced]`. */
function formatInvoiceStatusTag(o: OrderListItem): string | null {
  if (o.invoiceLinesTotal == null || o.invoiceLinesFullyInvoiced == null) return null;
  const total = o.invoiceLinesTotal;
  if (total <= 0) return null;
  const done = o.invoiceLinesFullyInvoiced;
  if (done >= total) return "invoiced";
  if (done === 0) return "not invoiced";
  const left = total - done;
  return `${done}/${total} - ${left} left`;
}

function formatOrderListDate(iso: string | undefined): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function num(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : NaN;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

function formatMoney(value: unknown, currencyCode?: string | null): string {
  const n = num(value);
  if (!Number.isFinite(n)) return "-";
  const cur = (currencyCode && String(currencyCode).trim()) || "CHF";
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: cur }).format(n);
  } catch {
    return `${n.toFixed(2)} ${cur}`;
  }
}

function displayProductTitle(line: EligibleLine): string {
  const name = String(line.productName ?? "").trim();
  if (name) return name;
  const desc = String(line.description ?? "").trim();
  if (desc) return desc;
  return "-";
}

function displaySize(line: EligibleLine): string {
  const size = String(line.size ?? "").trim();
  const raw = String(line.sizeRaw ?? "").trim();
  if (size && raw && size !== raw) return `${size} (${raw})`;
  return size || raw || "-";
}

function displaySku(line: EligibleLine): string {
  const s = String(line.supplierSku ?? "").trim();
  return s || "-";
}

function isDirectDelivery(order: { deliveryType?: string | null }): boolean {
  return String(order.deliveryType ?? "").toLowerCase() === "direct_delivery";
}

function clampQty(value: number, min: number, max: number): number {
  const v = Number.isFinite(value) ? value : min;
  if (v < min) return min;
  if (v > max) return max;
  return v;
}

function normalizeGtinKey(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (!digits) return "";
  return digits.padStart(14, "0").slice(-14);
}

export default function GalaxusWarehouseShipmentsPage() {
  const actionsRef = useRef<HTMLDivElement | null>(null);
  const [orders, setOrders] = useState<OrderListItem[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [orderSearch, setOrderSearch] = useState("");
  const [debouncedOrderSearch, setDebouncedOrderSearch] = useState("");

  const [selectedOrderId, setSelectedOrderId] = useState("");
  const [eligibleOrders, setEligibleOrders] = useState<EligibleOrder[]>([]);
  const [eligibilityLoading, setEligibilityLoading] = useState(false);
  const [invoiceCoverage, setInvoiceCoverage] = useState<Record<string, { ordered: number; invoiced: number }>>(
    {}
  );
  const [shipmentCoverage, setShipmentCoverage] = useState<Record<string, ShipmentCoverage>>({});
  const [draftShipments, setDraftShipments] = useState<DraftShipment[]>([]);
  const [recentShipments, setRecentShipments] = useState<RecentShipment[]>([]);
  const [selectedLines, setSelectedLines] = useState<Record<string, SelectedLine>>({});
  const [createdShipment, setCreatedShipment] = useState<CreatedShipment | null>(null);

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string>("");
  const [labelResult, setLabelResult] = useState<string>("");
  const [scanInput, setScanInput] = useState("");
  const [scanResult, setScanResult] = useState("");
  const [replaceDrafts, setReplaceDrafts] = useState(false);
  const [trackingHint, setTrackingHint] = useState("");
  const [autoSendAfterCreate, setAutoSendAfterCreate] = useState(false);
  const [autoPrintLabel, setAutoPrintLabel] = useState(true);
  const [autoDownloadDocs, setAutoDownloadDocs] = useState(true);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedOrderSearch(orderSearch.trim()), 300);
    return () => clearTimeout(t);
  }, [orderSearch]);

  const loadOrders = async () => {
    setOrdersLoading(true);
    setError(null);
    try {
      const q = debouncedOrderSearch ? `&q=${encodeURIComponent(debouncedOrderSearch)}` : "";
      const res = await fetch(`/api/galaxus/orders?view=active&limit=200${q}`, { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) throw new Error(data?.error ?? "Failed to load orders");
      const items = Array.isArray(data.items) ? data.items : [];
      const filtered = items.filter((item: any) => {
        if (isDirectDelivery(item)) return false;
        if (String(item?.fulfillmentState ?? "") === "fulfilled") return false;
        const totalLines = Number(item?._count?.lines ?? 0);
        const shippedLines = Number(item?.warehouseLinesShipped ?? 0);
        if (Number.isFinite(totalLines) && totalLines > 0 && shippedLines >= totalLines) return false;
        return true;
      });
      setOrders(filtered);
      if (!selectedOrderId && filtered[0]?.id) {
        setSelectedOrderId(filtered[0].id);
      } else if (selectedOrderId && !filtered.some((item: any) => item.id === selectedOrderId)) {
        setSelectedOrderId(filtered[0]?.id ?? "");
      }
    } catch (err: any) {
      setError(err?.message ?? "Failed to load orders");
    } finally {
      setOrdersLoading(false);
    }
  };

  const loadEligibility = async (orderId: string) => {
    if (!orderId) {
      setEligibleOrders([]);
      setInvoiceCoverage({});
      setShipmentCoverage({});
      return;
    }
    setEligibilityLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/galaxus/warehouse-shipments/eligible?anchorOrderId=${encodeURIComponent(orderId)}`,
        { cache: "no-store" }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) throw new Error(data?.error ?? "Failed to load eligible orders");
      setEligibleOrders(Array.isArray(data.orders) ? data.orders : []);
      setInvoiceCoverage(data.invoiceCoverage ?? {});
      setShipmentCoverage(data.shipmentCoverage ?? {});
    } catch (err: any) {
      setError(err?.message ?? "Failed to load eligible orders");
      setEligibleOrders([]);
      setInvoiceCoverage({});
      setShipmentCoverage({});
    } finally {
      setEligibilityLoading(false);
    }
  };

  const loadDraftShipments = async () => {
    try {
      const res = await fetch("/api/galaxus/warehouse-shipments/drafts", { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) throw new Error(data?.error ?? "Failed to load drafts");
      setDraftShipments(Array.isArray(data.drafts) ? data.drafts : []);
    } catch {
      setDraftShipments([]);
    }
  };

  const loadRecentShipments = async () => {
    try {
      const res = await fetch("/api/galaxus/warehouse-shipments/recent", { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) throw new Error(data?.error ?? "Failed to load recent shipments");
      setRecentShipments(Array.isArray(data.shipments) ? data.shipments : []);
    } catch {
      setRecentShipments([]);
    }
  };

  useEffect(() => {
    void loadOrders();
    void loadDraftShipments();
    void loadRecentShipments();
  }, [debouncedOrderSearch]);

  useEffect(() => {
    setSelectedLines({});
    setCreatedShipment(null);
    setResult("");
    setLabelResult("");
    setScanInput("");
    setScanResult("");
    if (selectedOrderId) void loadEligibility(selectedOrderId);
  }, [selectedOrderId]);

  useEffect(() => {
    if (!createdShipment) return;
    const ref = actionsRef.current;
    if (!ref) return;
    const timeout = setTimeout(() => {
      ref.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
    return () => clearTimeout(timeout);
  }, [createdShipment]);

  const ordersByTab = useMemo(() => orders, [orders]);

  const groupedOrders = useMemo(() => {
    const hasRemaining = (order: EligibleOrder) =>
      (order.lines ?? []).some((line) => {
        const lid = String(line.id ?? "");
        const coverage = shipmentCoverage[lid];
        const ordered = coverage?.ordered ?? num(line.quantity);
        const shipped = coverage?.shipped ?? 0;
        const reserved = coverage?.reserved ?? 0;
        return Math.max(0, ordered - shipped - reserved) > 0;
      });
    const filtered = eligibleOrders.filter(hasRemaining);
    const anchor = filtered.find((order) => order.id === selectedOrderId);
    const others = filtered.filter((order) => order.id !== selectedOrderId);
    return anchor ? [anchor, ...others] : filtered;
  }, [eligibleOrders, selectedOrderId, shipmentCoverage]);

  const selectedItems = useMemo(() => Object.values(selectedLines), [selectedLines]);
  const selectedQty = selectedItems.reduce((acc, item) => acc + Math.max(0, Number(item.quantity ?? 0)), 0);

  const toggleLine = (lineId: string, sourceOrderId: string, remaining: number, checked: boolean) => {
    setSelectedLines((prev) => {
      const next = { ...prev };
      if (!checked) {
        delete next[lineId];
        return next;
      }
      const qty = clampQty(Math.max(1, remaining), 1, Math.max(1, remaining));
      next[lineId] = { lineId, sourceOrderId, quantity: qty };
      return next;
    });
  };

  const updateLineQuantity = (lineId: string, maxQty: number, raw: string) => {
    setSelectedLines((prev) => {
      const entry = prev[lineId];
      if (!entry) return prev;
      const nextQty = clampQty(Number(raw), 1, Math.max(1, maxQty));
      return { ...prev, [lineId]: { ...entry, quantity: nextQty } };
    });
  };

  const clearSelection = () => {
    setSelectedLines({});
  };

  const scanAndSelect = (raw: string) => {
    if (busy !== null) return;
    const cleaned = normalizeGtinKey(raw);
    if (!cleaned) {
      setError("Scan a GTIN to select a line.");
      return;
    }
    setError(null);
    setScanResult("");

    const matches: Array<{
      order: EligibleOrder;
      line: EligibleLine;
      remaining: number;
    }> = [];
    for (const order of groupedOrders) {
      for (const line of order.lines ?? []) {
        const lineKey = normalizeGtinKey(String(line.gtin ?? ""));
        if (!lineKey || lineKey !== cleaned) continue;
        const lid = String(line.id ?? "");
        const orderedQty = invoiceCoverage[lid]?.ordered ?? num(line.quantity);
        const orderedSafe = Number.isFinite(orderedQty) ? orderedQty : 0;
        const invoicedQty = invoiceCoverage[lid]?.invoiced ?? 0;
        const fullyInvoiced = orderedSafe > 0 && invoicedQty >= orderedSafe;
        const shippedQty = shipmentCoverage[lid]?.shipped ?? 0;
        const reservedQty = shipmentCoverage[lid]?.reserved ?? 0;
        const remainingQty =
          shipmentCoverage[lid]?.remaining ?? Math.max(0, orderedSafe - shippedQty - reservedQty);
        if (fullyInvoiced || remainingQty <= 0) continue;
        matches.push({ order, line, remaining: remainingQty });
      }
    }

    if (matches.length === 0) {
      setError(`No remaining line found for GTIN ${cleaned}.`);
      return;
    }

    const target = matches[0];
    const lid = String(target.line.id);
    setSelectedLines((prev) => {
      const existing = prev[lid];
      const nextQty = existing ? clampQty(existing.quantity + 1, 1, Math.max(1, target.remaining)) : 1;
      return {
        ...prev,
        [lid]: {
          lineId: lid,
          sourceOrderId: target.order.id,
          quantity: nextQty,
        },
      };
    });

    const title = displayProductTitle(target.line);
    const size = displaySize(target.line);
    const label = target.order.orderNumber ?? target.order.galaxusOrderId;
    setScanResult(`Added ${title} (${size}) from order ${label}.`);
    setScanInput("");
  };

  const createShipment = async () => {
    if (!selectedOrderId) return;
    if (selectedItems.length === 0) {
      setError("Select at least one line to create a shipment.");
      return;
    }
    let createdId = "";
    setBusy("create");
    setError(null);
    setResult("");
    setCreatedShipment(null);
    try {
      const res = await fetch("/api/galaxus/shipments/composite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          anchorOrderId: selectedOrderId,
          items: selectedItems.map((item) => ({
            lineId: item.lineId,
            sourceOrderId: item.sourceOrderId,
            quantity: item.quantity,
          })),
          confirmReplace: replaceDrafts,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) throw new Error(data?.error ?? "Composite shipment failed");
      const shipment = data.shipment ?? null;
      createdId = shipment?.id ?? "";
      setCreatedShipment(shipment);
      setSelectedLines({});
      setResult(
        autoSendAfterCreate
          ? "Shipment created. Preparing documents + Swiss Post label..."
          : "Shipment created. Download SSCC + delivery note, then generate Swiss Post label."
      );
      await loadEligibility(selectedOrderId);
      await loadOrders();
      await loadDraftShipments();
      await loadRecentShipments();
    } catch (err: any) {
      setError(err?.message ?? "Composite shipment failed");
    } finally {
      setBusy(null);
    }
    if (createdId && autoDownloadDocs) {
      await regenerateSsccLabel(createdId, { open: true });
      await downloadDeliveryNote(createdId);
    }
    if (createdId && autoSendAfterCreate) {
      await generateSwissPostLabel(createdId, {
        autoPrint: autoPrintLabel,
        trackingOverride: "",
      });
    }
  };

  const downloadSsccLabel = (shipmentId?: string) => {
    const id = shipmentId ?? createdShipment?.id;
    if (!id) return;
    window.open(`/api/galaxus/shipments/${id}/label`, "_blank", "noopener,noreferrer");
  };

  const regenerateSsccLabel = async (shipmentId?: string, options?: { open?: boolean }) => {
    const id = shipmentId ?? createdShipment?.id;
    if (!id) return;
    setBusy("sscc-label");
    setError(null);
    try {
      const res = await fetch(`/api/galaxus/shipments/${id}/label`, {
        method: "POST",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) throw new Error(data?.error ?? "SSCC label regeneration failed");
      if (options?.open !== false) {
        window.open(`/api/galaxus/shipments/${id}/label`, "_blank", "noopener,noreferrer");
      }
    } catch (err: any) {
      setError(err?.message ?? "SSCC label regeneration failed");
    } finally {
      setBusy(null);
    }
  };

  const downloadDeliveryNote = async (shipmentId?: string, force = false) => {
    const id = shipmentId ?? createdShipment?.id;
    if (!id) return;
    setBusy("delivery-note");
    setError(null);
    setLabelResult("");
    try {
      const url = `/api/galaxus/shipments/${id}/delivery-note${force ? "?force=1" : ""}`;
      const res = await fetch(url, { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) throw new Error(data?.error ?? "Delivery note unavailable");
      if (data.url) {
        window.open(data.url, "_blank", "noopener,noreferrer");
      }
    } catch (err: any) {
      setError(err?.message ?? "Delivery note unavailable");
    } finally {
      setBusy(null);
    }
  };

  const openAndPrint = (url: string) => {
    const win = window.open(url, "_blank", "noopener,noreferrer");
    if (!win) return;
    const start = Date.now();
    const timer = window.setInterval(() => {
      if (Date.now() - start > 12000) {
        window.clearInterval(timer);
        return;
      }
      try {
        if (win.document.readyState === "complete") {
          window.clearInterval(timer);
          win.focus();
          win.print();
        }
      } catch {
        // Cross-origin PDF viewers can block; keep best-effort only.
      }
    }, 500);
  };

  const generateSwissPostLabel = async (
    shipmentId?: string,
    options?: { autoPrint?: boolean; trackingOverride?: string }
  ) => {
    const id = shipmentId ?? createdShipment?.id;
    if (!id) return;
    setBusy("post-label");
    setError(null);
    setLabelResult("");
    try {
      const trackingNumber =
        options?.trackingOverride != null ? options.trackingOverride : trackingHint.trim() || undefined;
      const res = await fetch(`/api/galaxus/shipments/${id}/post-label`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          trackingNumber,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) throw new Error(data?.error ?? "Swiss Post label failed");
      if (data?.url && options?.autoPrint) {
        openAndPrint(String(data.url));
      }
      setLabelResult(
        `Swiss Post label generated - tracking ${data?.trackingNumber ?? "unknown"} - DELR ${data?.delr?.status ?? "ok"}`
      );
      await loadOrders();
      if (selectedOrderId) await loadEligibility(selectedOrderId);
      await loadDraftShipments();
      await loadRecentShipments();
    } catch (err: any) {
      setError(err?.message ?? "Swiss Post label failed");
    } finally {
      setBusy(null);
    }
  };

  const deleteDraftShipment = async (shipmentId: string) => {
    if (
      !window.confirm(
        "Delete this draft shipment?\n\nAll items will be freed up so you can re-pack them.\n\nThis cannot be undone."
      )
    )
      return;
    setBusy(`delete-draft-${shipmentId}`);
    setError(null);
    try {
      const res = await fetch(`/api/galaxus/shipments/${shipmentId}/delete`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) throw new Error(data?.error ?? "Delete shipment failed");
      setResult("Shipment deleted — items are now free to re-pack.");
      if (createdShipment?.id === shipmentId) setCreatedShipment(null);
      await loadDraftShipments();
      await loadRecentShipments();
      if (selectedOrderId) await loadEligibility(selectedOrderId);
    } catch (err: any) {
      setError(err?.message ?? "Delete shipment failed");
    } finally {
      setBusy(null);
    }
  };

  const resetDelr = async (shipmentId: string) => {
    if (
      !window.confirm(
        "This will un-fulfil the shipment (clear DELR sent status + un-mark order lines).\n\nOnly do this if the DELR file was removed from the SFTP before Galaxus processed it.\n\nContinue?"
      )
    )
      return;
    setBusy(`reset-delr-${shipmentId}`);
    setError(null);
    try {
      const res = await fetch(`/api/galaxus/shipments/${shipmentId}/reset-delr`, {
        method: "POST",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) throw new Error(data?.result?.message ?? data?.error ?? "Reset DELR failed");
      setResult(data.result?.message ?? "Shipment reset to MANUAL — you can now delete and re-create it with all items.");
      await loadRecentShipments();
      await loadDraftShipments();
      if (selectedOrderId) await loadEligibility(selectedOrderId);
    } catch (err: any) {
      setError(err?.message ?? "Reset DELR failed");
    } finally {
      setBusy(null);
    }
  };

  const useDraftShipment = (draft: DraftShipment) => {
    setCreatedShipment({
      id: draft.id,
      orderId: selectedOrderId,
      shipmentId: draft.shipmentId,
      dispatchNotificationId: draft.dispatchNotificationId ?? undefined,
      packageId: draft.packageId ?? undefined,
      trackingNumber: draft.trackingNumber ?? undefined,
      delrStatus: draft.delrStatus ?? undefined,
    });
    if (draft.anchorOrderId && draft.anchorOrderId !== selectedOrderId) {
      setSelectedOrderId(draft.anchorOrderId);
    }
    setResult("Draft shipment loaded. You can now generate the Swiss Post label (DELR).");
    setLabelResult("");
  };

  return (
    <main className="p-6 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Warehouse shipments</h1>
          <p className="text-sm text-gray-600">
            Select not-yet-invoiced lines, mix orders with the same address, then send DELR via Swiss Post.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a href="/galaxus" className="px-3 py-2 rounded bg-gray-100 text-sm">
            Ops &amp; Data
          </a>
          <a href="/galaxus/warehouse" className="px-3 py-2 rounded bg-gray-100 text-sm">
            Warehouse
          </a>
          <a href="/galaxus/direct-delivery" className="px-3 py-2 rounded bg-gray-100 text-sm">
            Direct delivery
          </a>
          <a href="/galaxus/invoices" className="px-3 py-2 rounded bg-gray-100 text-sm">
            Invoices
          </a>
          <a href="/galaxus/pricing" className="px-3 py-2 rounded bg-gray-100 text-sm">
            Pricing &amp; DB
          </a>
          <a href="/decathlon" className="px-3 py-2 rounded bg-teal-700 text-white text-sm">
            Decathlon
          </a>
        </div>
      </div>

      {error ? <div className="text-sm text-red-600">{error}</div> : null}
      {result ? <div className="text-sm text-green-700">{result}</div> : null}
      {labelResult ? <div className="text-sm text-blue-700">{labelResult}</div> : null}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="border rounded p-3">
          <div className="font-semibold mb-2">Orders (open)</div>
          <input
            className="w-full border rounded px-2 py-1 text-xs mb-2"
            placeholder="Search order number..."
            value={orderSearch}
            onChange={(e) => setOrderSearch(e.target.value)}
          />
          <div className="space-y-2 max-h-[520px] overflow-auto">
            {ordersByTab.map((order) => {
              const invoiceTag = formatInvoiceStatusTag(order);
              return (
                <button
                  key={order.id}
                  onClick={() => setSelectedOrderId(order.id)}
                  className={`w-full text-left border rounded p-2 text-sm ${
                    selectedOrderId === order.id ? "border-black" : "border-gray-200"
                  }`}
                >
                  <div className="font-medium">{order.orderNumber ?? order.galaxusOrderId}</div>
                  <div className="text-xs text-gray-500">
                    {formatOrderListDate(order.orderDate)} - {order.shippedCount ?? 0}/
                    {order._count?.shipments ?? 0} shipped - {order.fulfilledCount ?? 0}/
                    {order._count?.shipments ?? 0} fulfilled
                  </div>
                  {invoiceTag ? <div className="text-[11px] text-gray-500">[{invoiceTag}]</div> : null}
                </button>
              );
            })}
            {ordersByTab.length === 0 ? (
              <div className="text-xs text-gray-500">
                {ordersLoading ? "Loading..." : "No orders in this tab."}
              </div>
            ) : null}
          </div>
        </div>

        <div className="md:col-span-2 border rounded p-3 space-y-4">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="font-semibold">Shipment builder</div>
              <div className="text-xs text-gray-500">
                {eligibilityLoading ? "Loading eligible orders..." : "Same-delivery-address orders are shown below."}
              </div>
            </div>
            <div className="flex items-center gap-2 text-xs text-gray-600">
              <span>
                Selected: {selectedItems.length} line{selectedItems.length === 1 ? "" : "s"} - {selectedQty} qty
              </span>
              <button
                type="button"
                className="px-2 py-1 rounded bg-gray-100 text-xs disabled:opacity-50"
                onClick={clearSelection}
                disabled={selectedItems.length === 0 || busy !== null}
              >
                Clear
              </button>
            </div>
          </div>
          {draftShipments.length > 0 ? (
            <details className="border rounded bg-amber-50 text-xs group">
              <summary className="cursor-pointer list-none px-3 py-2 font-medium text-amber-900 flex items-center justify-between gap-2 [&::-webkit-details-marker]:hidden">
                <span>Draft shipments waiting for DELR ({draftShipments.length})</span>
                <span className="text-gray-500 font-normal group-open:hidden">Expand</span>
                <span className="text-gray-500 font-normal hidden group-open:inline">Collapse</span>
              </summary>
              <div className="border-t border-amber-200/60 p-3 space-y-2 max-h-[min(50vh,360px)] overflow-auto">
                {draftShipments.map((draft) => (
                  <div
                    key={draft.id}
                    className="flex flex-wrap items-center justify-between gap-2 border rounded bg-white px-2 py-1.5"
                  >
                    <div>
                      <div className="font-medium text-gray-800">
                        {draft.dispatchNotificationId ?? draft.shipmentId}
                      </div>
                      <div className="text-gray-600">
                        Orders: {draft.orderNumbers.join(", ") || "-"} - Items: {draft.itemCount} -{" "}
                        {new Date(draft.createdAt).toLocaleString()}
                      </div>
                      {draft.anchorOrderNumber ? (
                        <div className="text-gray-500">Anchor: {draft.anchorOrderNumber}</div>
                      ) : null}
                      {draft.delrStatus ? (
                        <div className="text-gray-500">DELR: {draft.delrStatus}</div>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        className="px-2 py-1 rounded bg-gray-900 text-white text-xs disabled:opacity-50"
                        onClick={() => useDraftShipment(draft)}
                        disabled={busy !== null}
                      >
                        Open actions
                      </button>
                      <button
                        type="button"
                        className="px-2 py-1 rounded bg-gray-100 text-xs disabled:opacity-50"
                        onClick={() => void regenerateSsccLabel(draft.id)}
                        disabled={busy !== null}
                      >
                        SSCC (regen)
                      </button>
                      <button
                        type="button"
                        className="px-2 py-1 rounded bg-gray-100 text-xs disabled:opacity-50"
                        onClick={() => void downloadDeliveryNote(draft.id)}
                        disabled={busy !== null}
                      >
                        Delivery note
                      </button>
                      <button
                        type="button"
                        className="px-2 py-1 rounded bg-gray-100 text-xs disabled:opacity-50"
                        onClick={() => void downloadDeliveryNote(draft.id, true)}
                        disabled={busy !== null}
                        title="Force-regenerate delivery note (clears cached version)"
                      >
                        Regen note
                      </button>
                      <button
                        type="button"
                        className="px-2 py-1 rounded bg-black text-white text-xs disabled:opacity-50"
                        onClick={() => void generateSwissPostLabel(draft.id)}
                        disabled={busy !== null}
                      >
                        Send DELR (Swiss Post)
                      </button>
                      <button
                        type="button"
                        className="px-2 py-1 rounded bg-red-100 text-red-800 text-xs disabled:opacity-50"
                        onClick={() => void deleteDraftShipment(draft.id)}
                        disabled={busy !== null}
                        title="Delete this draft and free all items back to unshipped"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </details>
          ) : null}
          {recentShipments.length > 0 ? (
            <details className="border rounded bg-white text-xs group">
              <summary className="cursor-pointer list-none px-3 py-2 font-medium text-gray-900 flex items-center justify-between gap-2 [&::-webkit-details-marker]:hidden">
                <span>Recent shipments - SSCC and delivery note ({recentShipments.length})</span>
                <span className="text-gray-500 font-normal group-open:hidden">Expand</span>
                <span className="text-gray-500 font-normal hidden group-open:inline">Collapse</span>
              </summary>
              <div className="border-t border-gray-200 p-3 space-y-2 max-h-[min(50vh,360px)] overflow-auto">
                {recentShipments.map((shipment) => (
                  <div
                    key={shipment.id}
                    className="flex flex-wrap items-center justify-between gap-2 border rounded bg-gray-50 px-2 py-1.5"
                  >
                    <div>
                      <div className="font-medium text-gray-800">
                        {shipment.dispatchNotificationId ?? shipment.shipmentId}
                      </div>
                      <div className="text-gray-600">
                        Order: {shipment.orderNumber ?? shipment.galaxusOrderId ?? "-"} -{" "}
                        {new Date(shipment.createdAt).toLocaleString()}
                      </div>
                      {shipment.delrStatus ? (
                        <div className="text-gray-500">DELR: {shipment.delrStatus}</div>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        className="px-2 py-1 rounded bg-gray-100 text-xs disabled:opacity-50"
                        onClick={() => {
                          if (shipment.ssccLabelUrl) {
                            window.open(shipment.ssccLabelUrl, "_blank", "noopener,noreferrer");
                          } else {
                            setError("SSCC label not found for this shipment.");
                          }
                        }}
                        disabled={busy !== null}
                      >
                        SSCC
                      </button>
                      <button
                        type="button"
                        className="px-2 py-1 rounded bg-gray-100 text-xs disabled:opacity-50"
                        onClick={() => {
                          if (shipment.deliveryNoteUrl) {
                            window.open(shipment.deliveryNoteUrl, "_blank", "noopener,noreferrer");
                          } else {
                            setError("Delivery note not found for this shipment.");
                          }
                        }}
                        disabled={busy !== null}
                      >
                        Delivery note
                      </button>
                      {(shipment.delrStatus === "UPLOADED" || shipment.delrStatus === "SENT") ? (
                        <button
                          type="button"
                          className="px-2 py-1 rounded bg-red-100 text-red-800 text-xs disabled:opacity-50"
                          onClick={() => void resetDelr(shipment.id)}
                          disabled={busy !== null}
                          title="Un-fulfil this shipment — only if the DELR was removed from SFTP before Galaxus processed it"
                        >
                          Reset DELR
                        </button>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            </details>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <input
              className="border rounded px-2 py-1 text-xs w-56"
              placeholder="Scan GTIN to add line"
              value={scanInput}
              onChange={(e) => setScanInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  scanAndSelect(scanInput);
                }
              }}
            />
            <button
              type="button"
              className="px-3 py-1.5 rounded bg-gray-900 text-white text-xs disabled:opacity-50"
              onClick={() => scanAndSelect(scanInput)}
              disabled={!scanInput.trim() || busy !== null}
            >
              Add by GTIN
            </button>
            {scanResult ? <span className="text-xs text-gray-600">{scanResult}</span> : null}
          </div>

          {groupedOrders.length === 0 && !eligibilityLoading ? (
            <div className="text-sm text-gray-500">Select an order to load its lines.</div>
          ) : null}

          {groupedOrders.map((order) => {
            const currencyCode = order.currencyCode ?? "CHF";
            const lineMetas = (order.lines ?? []).map((line) => {
              const lid = String(line.id ?? "");
              const orderedQty = invoiceCoverage[lid]?.ordered ?? num(line.quantity);
              const orderedSafe = Number.isFinite(orderedQty) ? orderedQty : 0;
              const invoicedQty = invoiceCoverage[lid]?.invoiced ?? 0;
              const fullyInvoiced = orderedSafe > 0 && invoicedQty >= orderedSafe;
              const shippedQty = shipmentCoverage[lid]?.shipped ?? 0;
              const reservedQty = shipmentCoverage[lid]?.reserved ?? 0;
              const remainingQty =
                shipmentCoverage[lid]?.remaining ?? Math.max(0, orderedSafe - shippedQty - reservedQty);
              const selected = selectedLines[lid];
              const disabled = busy !== null || !lid || fullyInvoiced || remainingQty <= 0;
              const lineNet = num(line.lineNetAmount ?? line.priceLineAmount ?? line.unitNetPrice);
              return {
                line,
                lid,
                orderedSafe,
                invoicedQty,
                fullyInvoiced,
                shippedQty,
                reservedQty,
                remainingQty,
                selected,
                disabled,
                lineNet,
              };
            });
            const openMetas = lineMetas.filter((m) => m.remainingQty > 0 && !m.fullyInvoiced);
            const closedMetas = lineMetas.filter((m) => !(m.remainingQty > 0 && !m.fullyInvoiced));

            const renderLineRow = (m: (typeof lineMetas)[0], dimmed: boolean) => {
              const { line, lid, orderedSafe, invoicedQty, fullyInvoiced, shippedQty, reservedQty, remainingQty, selected, disabled, lineNet } = m;
              return (
                <tr key={lid} className={`border-t ${dimmed ? "opacity-60 bg-gray-50/80" : ""}`}>
                  <td className="px-2 py-1.5">
                    <input
                      type="checkbox"
                      checked={Boolean(selected)}
                      onChange={(e) => toggleLine(lid, order.id, remainingQty, e.target.checked)}
                      disabled={disabled}
                    />
                  </td>
                  <td className="px-2 py-1.5 align-top">{line.lineNumber ?? "-"}</td>
                  <td className="px-2 py-1.5 align-top max-w-[min(260px,40vw)]">
                    <div className="font-medium text-gray-900 leading-snug">{displayProductTitle(line)}</div>
                    {String(line.description ?? "").trim() &&
                    String(line.description ?? "").trim() !== displayProductTitle(line) ? (
                      <div className="text-gray-500 mt-0.5 leading-snug line-clamp-2">{String(line.description)}</div>
                    ) : null}
                    {fullyInvoiced ? (
                      <div className="text-[11px] text-rose-700 mt-1">
                        Invoiced already ({invoicedQty}/{orderedSafe})
                      </div>
                    ) : invoicedQty > 0 ? (
                      <div className="text-[11px] text-amber-700 mt-1">
                        Partially invoiced ({invoicedQty}/{orderedSafe})
                      </div>
                    ) : null}
                    {!fullyInvoiced && remainingQty <= 0 ? (
                      shippedQty > 0 ? (
                        <div className="text-[11px] text-slate-700 mt-1">
                          Already shipped ({shippedQty}/{orderedSafe})
                        </div>
                      ) : (
                        <div className="text-[11px] text-slate-700 mt-1">
                          Reserved in draft shipment ({reservedQty}/{orderedSafe})
                        </div>
                      )
                    ) : shippedQty > 0 || reservedQty > 0 ? (
                      <div className="text-[11px] text-slate-500 mt-1">
                        Shipped {shippedQty} - Reserved {reservedQty}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-2 py-1.5 align-top text-gray-800 whitespace-nowrap">{displaySize(line)}</td>
                  <td className="px-2 py-1.5 align-top font-mono text-[11px] text-gray-800">{displaySku(line)}</td>
                  <td className="px-2 py-1.5 align-top font-mono text-[11px]">
                    {String(line.gtin ?? "").trim() || "-"}
                  </td>
                  <td className="px-2 py-1.5 text-right align-top">{orderedSafe}</td>
                  <td className="px-2 py-1.5 text-right align-top">{remainingQty}</td>
                  <td className="px-2 py-1.5 text-right align-top">
                    {selected ? (
                      <input
                        type="number"
                        min={1}
                        max={Math.max(1, remainingQty)}
                        className="w-16 border rounded px-1 py-0.5 text-xs text-right"
                        value={selected.quantity}
                        onChange={(e) => updateLineQuantity(lid, remainingQty, e.target.value)}
                        disabled={busy !== null}
                      />
                    ) : (
                      "-"
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-right align-top tabular-nums">
                    {formatMoney(line.unitNetPrice, currencyCode)}
                  </td>
                  <td className="px-2 py-1.5 text-right align-top tabular-nums">
                    {Number.isFinite(lineNet)
                      ? formatMoney(lineNet, currencyCode)
                      : formatMoney(line.lineNetAmount, currencyCode)}
                  </td>
                </tr>
              );
            };

            return (
              <div key={order.id} className="border rounded bg-white">
                <div className="border-b px-3 py-2 text-sm flex flex-wrap items-center justify-between gap-2">
                  <div className="font-medium">
                    {order.orderNumber ?? order.galaxusOrderId}
                    <span className="text-xs text-gray-500"> - {formatOrderListDate(order.orderDate)}</span>
                  </div>
                  <div className="text-xs text-gray-500">
                    {order.recipientName ?? "-"} - {order.recipientPostalCode ?? ""} {order.recipientCity ?? ""}
                  </div>
                </div>
                <div className="overflow-auto">
                  <table className="min-w-full text-xs">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-2 py-2 text-left">Pick</th>
                        <th className="px-2 py-2 text-left">Line</th>
                        <th className="px-2 py-2 text-left">Product</th>
                        <th className="px-2 py-2 text-left">Size</th>
                        <th className="px-2 py-2 text-left">SKU</th>
                        <th className="px-2 py-2 text-left">GTIN</th>
                        <th className="px-2 py-2 text-right">Ordered</th>
                        <th className="px-2 py-2 text-right">Remaining</th>
                        <th className="px-2 py-2 text-right">Ship qty</th>
                        <th className="px-2 py-2 text-right">Unit net</th>
                        <th className="px-2 py-2 text-right">Line net</th>
                      </tr>
                    </thead>
                    <tbody>
                      {openMetas.length === 0 ? (
                        <tr>
                          <td colSpan={11} className="px-2 py-3 text-center text-gray-500">
                            No lines left to ship for this order.
                          </td>
                        </tr>
                      ) : (
                        openMetas.map((m) => renderLineRow(m, false))
                      )}
                    </tbody>
                    {closedMetas.length > 0 ? (
                      <tbody>
                        <tr>
                          <td colSpan={11} className="p-0 align-top">
                            <details className="group border-t border-gray-200">
                              <summary className="cursor-pointer list-none bg-gray-50 px-3 py-2 text-xs font-medium text-gray-700 flex items-center justify-between gap-2 [&::-webkit-details-marker]:hidden">
                                <span>Shipped / reserved / invoiced ({closedMetas.length})</span>
                                <span className="text-gray-500 font-normal shrink-0 group-open:hidden">Expand</span>
                                <span className="text-gray-500 font-normal shrink-0 hidden group-open:inline">
                                  Collapse
                                </span>
                              </summary>
                              <div className="max-h-[min(45vh,320px)] overflow-auto border-t border-gray-100">
                                <table className="min-w-full text-xs">
                                  <thead className="bg-gray-100 sticky top-0 z-[1]">
                                    <tr>
                                      <th className="px-2 py-1.5 text-left">Pick</th>
                                      <th className="px-2 py-1.5 text-left">Line</th>
                                      <th className="px-2 py-1.5 text-left">Product</th>
                                      <th className="px-2 py-1.5 text-left">Size</th>
                                      <th className="px-2 py-1.5 text-left">SKU</th>
                                      <th className="px-2 py-1.5 text-left">GTIN</th>
                                      <th className="px-2 py-1.5 text-right">Ordered</th>
                                      <th className="px-2 py-1.5 text-right">Remaining</th>
                                      <th className="px-2 py-1.5 text-right">Ship qty</th>
                                      <th className="px-2 py-1.5 text-right">Unit net</th>
                                      <th className="px-2 py-1.5 text-right">Line net</th>
                                    </tr>
                                  </thead>
                                  <tbody>{closedMetas.map((m) => renderLineRow(m, true))}</tbody>
                                </table>
                              </div>
                            </details>
                          </td>
                        </tr>
                      </tbody>
                    ) : null}
                  </table>
                </div>
              </div>
            );
          })}

          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-xs text-gray-600">
              <input
                type="checkbox"
                checked={replaceDrafts}
                onChange={(e) => setReplaceDrafts(e.target.checked)}
              />
              Replace existing pending drafts (all source orders) — required to re-pack items already reserved
            </label>
            <label className="flex items-center gap-2 text-xs text-gray-600">
              <input
                type="checkbox"
                checked={autoSendAfterCreate}
                onChange={(e) => setAutoSendAfterCreate(e.target.checked)}
              />
              Auto generate Swiss Post label after create (sends DELR)
            </label>
            <label className="flex items-center gap-2 text-xs text-gray-600">
              <input
                type="checkbox"
                checked={autoPrintLabel}
                onChange={(e) => setAutoPrintLabel(e.target.checked)}
                disabled={!autoSendAfterCreate}
              />
              Auto print Swiss Post label
            </label>
            <label className="flex items-center gap-2 text-xs text-gray-600">
              <input
                type="checkbox"
                checked={autoDownloadDocs}
                onChange={(e) => setAutoDownloadDocs(e.target.checked)}
              />
              Auto download SSCC + delivery note
            </label>
            <button
              type="button"
              className="px-3 py-2 rounded bg-blue-600 text-white text-sm disabled:opacity-50"
              onClick={() => void createShipment()}
              disabled={busy !== null || selectedItems.length === 0}
            >
              {busy === "create" ? "Creating shipment..." : "Create shipment"}
            </button>
          </div>

          {createdShipment ? (
            <div ref={actionsRef} className="border rounded bg-gray-50 p-3 space-y-2 text-sm">
              <div className="font-medium">Shipment ready</div>
              <div className="text-xs text-gray-600">
                Shipment ID: {createdShipment.shipmentId ?? createdShipment.id} - Package:{" "}
                {createdShipment.packageId ?? "-"}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className="px-3 py-2 rounded bg-gray-900 text-white text-xs disabled:opacity-50"
                  onClick={() => void regenerateSsccLabel()}
                  disabled={busy !== null}
                >
                  Regenerate SSCC label
                </button>
                <button
                  type="button"
                  className="px-3 py-2 rounded bg-gray-100 text-xs disabled:opacity-50"
                  onClick={() => void downloadDeliveryNote()}
                  disabled={busy !== null}
                >
                  Download delivery note
                </button>
                <div className="flex items-center gap-2">
                  <input
                    className="border rounded px-2 py-1 text-xs"
                    placeholder="Tracking hint (optional)"
                    value={trackingHint}
                    onChange={(e) => setTrackingHint(e.target.value)}
                  />
                  <button
                    type="button"
                    className="px-3 py-2 rounded bg-black text-white text-xs disabled:opacity-50"
                    onClick={() => void generateSwissPostLabel()}
                    disabled={busy !== null}
                  >
                    {busy === "post-label" ? "Generating label..." : "Generate Swiss Post label"}
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </main>
  );
}
