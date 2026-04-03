"use client";

import { type ChangeEvent, useCallback, useEffect, useMemo, useState } from "react";

type OrderListItem = {
  id: string;
  galaxusOrderId: string;
  orderNumber?: string | null;
  orderDate: string;
  deliveryType: string | null;
  customerName: string | null;
  recipientName: string | null;
  archivedAt?: string | null;
  cancelledAt?: string | null;
  _count?: { lines: number; shipments: number };
  /** From OUT INVO payloads; null if progress could not be loaded */
  invoiceLinesFullyInvoiced?: number | null;
  invoiceLinesTotal?: number | null;
};

/** Short label like `[invoiced]` / `[20/22 · 2 left]` / `[not invoiced]` (same style as archived/cancelled). */
function formatInvoiceStatusTag(o: OrderListItem): string | null {
  if (o.invoiceLinesTotal == null || o.invoiceLinesFullyInvoiced == null) return null;
  const total = o.invoiceLinesTotal;
  if (total <= 0) return null;
  const done = o.invoiceLinesFullyInvoiced;
  if (done >= total) return "invoiced";
  if (done === 0) return "not invoiced";
  const left = total - done;
  return `${done}/${total} · ${left} left`;
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

type CustomInvoiceLine = {
  id: string;
  orderReferenceId: string;
  description: string;
  quantity: number;
  unitNetPrice: number;
  vatRate: number;
  supplierPid: string;
  buyerPid: string;
  gtin: string;
  orderUnit: string;
  taxAmountPerUnit: number | "";
  lineNetAmount: number | "";
};

type SsccPrintPreset = {
  id: string;
  label: string;
  widthMm: number;
  heightMm: number;
  rotateDegrees: number;
};

const SSCC_PRINT_PRESETS: SsccPrintPreset[] = [
  { id: "ql-62x200-portrait", label: "QL 62x200 Portrait", widthMm: 62, heightMm: 200, rotateDegrees: 0 },
  { id: "ql-62x200-paysage", label: "QL 62x200 Paysage", widthMm: 200, heightMm: 62, rotateDegrees: 0 },
  { id: "ql-62x200-paysage-180", label: "QL 62x200 Paysage 180", widthMm: 200, heightMm: 62, rotateDegrees: 180 },
  { id: "ql-62x150-portrait", label: "QL 62x150 Portrait", widthMm: 62, heightMm: 150, rotateDegrees: 0 },
];

function createCustomLine(): CustomInvoiceLine {
  return {
    id: crypto.randomUUID(),
    orderReferenceId: "",
    description: "",
    quantity: 1,
    unitNetPrice: 0,
    vatRate: 8.1,
    supplierPid: "",
    buyerPid: "",
    gtin: "",
    orderUnit: "",
    taxAmountPerUnit: "",
    lineNetAmount: "",
  };
}

function getLinesFromOrder(order: unknown): Array<Record<string, unknown>> {
  if (!order || typeof order !== "object") return [];
  const lines = (order as { lines?: unknown }).lines;
  return Array.isArray(lines) ? (lines as Array<Record<string, unknown>>) : [];
}

function num(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : NaN;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

/** Net unit price from order line (Prisma Decimal serializes as string in JSON). */
function unitNetFromLine(line: Record<string, unknown>): number {
  return num(line.unitNetPrice);
}

function lineNetFromOrderLine(line: Record<string, unknown>): number {
  const explicit = num(line.lineNetAmount);
  if (Number.isFinite(explicit)) return explicit;
  const pl = num(line.priceLineAmount);
  if (Number.isFinite(pl)) return pl;
  const q = num(line.quantity);
  const u = unitNetFromLine(line);
  if (Number.isFinite(q) && Number.isFinite(u)) return Number((q * u).toFixed(2));
  return NaN;
}

function formatMoney(value: unknown, currencyCode?: string | null): string {
  const n = num(value);
  if (!Number.isFinite(n)) return "—";
  const cur = (currencyCode && String(currencyCode).trim()) || "CHF";
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: cur }).format(n);
  } catch {
    return `${n.toFixed(2)} ${cur}`;
  }
}

/** Same enrichment as main Galaxus dashboard: API merges DB/KickDB via GTIN into these fields. */
function displayProductTitle(line: Record<string, unknown>): string {
  const name = String(line.productName ?? "").trim();
  if (name) return name;
  const desc = String(line.description ?? "").trim();
  if (desc) return desc;
  return "—";
}

function displaySize(line: Record<string, unknown>): string {
  const s = String(line.size ?? line.sizeRaw ?? "").trim();
  return s || "—";
}

function displaySku(line: Record<string, unknown>): string {
  const s = String(line.supplierSku ?? "").trim();
  return s || "—";
}

/** Match last-INVO payload row to loaded order lines (orderLineId from payload, else unique GTIN). */
function resolveOrderLineForPayloadItem(
  item: Record<string, unknown>,
  orderLines: Array<Record<string, unknown>>
): Record<string, unknown> | null {
  const oid = String(item.orderLineId ?? "").trim();
  if (oid) {
    const hit = orderLines.find((l) => String(l.id) === oid);
    if (hit) return hit;
  }
  const gtin = String(item.gtin ?? "").trim();
  if (gtin) {
    const matches = orderLines.filter((l) => String(l.gtin ?? "").trim() === gtin);
    if (matches.length === 1) return matches[0];
  }
  return null;
}

export default function GalaxusInvoicesPage() {
  const [orderListItems, setOrderListItems] = useState<OrderListItem[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(true);
  const [orderSearch, setOrderSearch] = useState("");
  const [debouncedOrderSearch, setDebouncedOrderSearch] = useState("");
  const [selectedOrderId, setSelectedOrderId] = useState("");
  const [orderDetail, setOrderDetail] = useState<Record<string, unknown> | null>(null);
  const [orderDetailLoading, setOrderDetailLoading] = useState(false);
  const [selectedLineIds, setSelectedLineIds] = useState<Set<string>>(new Set());

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string>("");
  const [lastBusy, setLastBusy] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const [lastInvoice, setLastInvoice] = useState<Record<string, unknown> | null>(null);
  const [invoiceCoverage, setInvoiceCoverage] = useState<Record<string, { ordered: number; invoiced: number }>>({});
  const [coverageLoading, setCoverageLoading] = useState(false);
  const [coverageError, setCoverageError] = useState<string | null>(null);

  const [standardDeliveryCharge, setStandardDeliveryCharge] = useState<number | "">("");

  const [customBaseOrderId, setCustomBaseOrderId] = useState("");
  const [customLines, setCustomLines] = useState<CustomInvoiceLine[]>([createCustomLine()]);
  const [customDeliveryCharge, setCustomDeliveryCharge] = useState<number | "">("");
  const [customBusy, setCustomBusy] = useState(false);
  const [customPdfBusy, setCustomPdfBusy] = useState(false);
  const [customError, setCustomError] = useState<string | null>(null);
  const [customResult, setCustomResult] = useState<string>("");
  const [ssccModalOpen, setSsccModalOpen] = useState(false);
  const [ssccOrderId, setSsccOrderId] = useState("");
  const [ssccShipmentId, setSsccShipmentId] = useState("");
  const [ssccPresetId, setSsccPresetId] = useState<string>("ql-62x200-portrait");
  const [ssccBusy, setSsccBusy] = useState(false);
  const [ssccError, setSsccError] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedOrderSearch(orderSearch.trim()), 300);
    return () => clearTimeout(t);
  }, [orderSearch]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setOrdersLoading(true);
      try {
        const params = new URLSearchParams({
          view: "all",
          limit: "500",
          sort: "orderDate",
        });
        if (debouncedOrderSearch.length >= 2) {
          params.set("q", debouncedOrderSearch);
        }
        const res = await fetch(`/api/galaxus/orders?${params.toString()}`);
        const data = await res.json().catch(() => ({}));
        if (!cancelled && data?.ok && Array.isArray(data.items)) {
          setOrderListItems(data.items as OrderListItem[]);
        }
      } finally {
        if (!cancelled) setOrdersLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [debouncedOrderSearch]);

  const loadInvoiceCoverage = useCallback(async (internalOrderId: string) => {
    if (!internalOrderId) {
      setInvoiceCoverage({});
      return;
    }
    setCoverageLoading(true);
    setCoverageError(null);
    try {
      const res = await fetch(
        `/api/galaxus/edi/invoice-coverage?orderId=${encodeURIComponent(internalOrderId)}`,
        { cache: "no-store" }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error ?? "Failed to load invoice coverage");
      }
      setInvoiceCoverage(data.coverage ?? {});
    } catch (err: unknown) {
      setInvoiceCoverage({});
      setCoverageError(err instanceof Error ? err.message : "Failed to load invoice coverage");
    } finally {
      setCoverageLoading(false);
    }
  }, []);

  const loadOrderDetail = useCallback(async (internalOrderId: string) => {
    if (!internalOrderId) {
      setOrderDetail(null);
      setSelectedLineIds(new Set());
      setInvoiceCoverage({});
      return;
    }
    setOrderDetailLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/galaxus/orders/${encodeURIComponent(internalOrderId)}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) throw new Error(data?.error ?? "Failed to load order");
      const order = data.order as Record<string, unknown>;
      setOrderDetail(order);
      const lines = getLinesFromOrder(order);
      const ids = lines.map((l) => String(l.id ?? "")).filter(Boolean);
      setSelectedLineIds(new Set(ids));
      void loadInvoiceCoverage(internalOrderId);
    } catch (err: unknown) {
      setOrderDetail(null);
      setSelectedLineIds(new Set());
      setInvoiceCoverage({});
      setError(err instanceof Error ? err.message : "Failed to load order");
    } finally {
      setOrderDetailLoading(false);
    }
  }, [loadInvoiceCoverage]);

  const onOrderSelectChange = (e: ChangeEvent<HTMLSelectElement>) => {
    const id = e.target.value;
    setSelectedOrderId(id);
    void loadOrderDetail(id);
  };

  const lines = useMemo(() => getLinesFromOrder(orderDetail), [orderDetail]);
  const lineById = useMemo(() => {
    const map = new Map<string, Record<string, unknown>>();
    for (const line of lines) {
      const id = String(line.id ?? "").trim();
      if (id) map.set(id, line);
    }
    return map;
  }, [lines]);

  const lineOrderedQty = (line: Record<string, unknown>): number => {
    const q = num(line.quantity);
    return Number.isFinite(q) ? q : 0;
  };

  const lineInvoicedQty = (line: Record<string, unknown>): number => {
    const lid = String(line.id ?? "").trim();
    if (!lid) return 0;
    const row = invoiceCoverage[lid];
    return row ? row.invoiced : 0;
  };

  const isLineFullyInvoiced = (line: Record<string, unknown>): boolean => {
    const ordered = lineOrderedQty(line);
    if (ordered <= 0) return false;
    const invoiced = lineInvoicedQty(line);
    return invoiced >= ordered;
  };

  const toggleLine = (lineId: string, checked: boolean) => {
    setSelectedLineIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(lineId);
      else next.delete(lineId);
      return next;
    });
  };

  const selectAllLines = () => {
    const ids = lines
      .filter((l) => !isLineFullyInvoiced(l))
      .map((l) => String(l.id ?? ""))
      .filter(Boolean);
    setSelectedLineIds(new Set(ids));
  };

  const selectNoLines = () => {
    setSelectedLineIds(new Set());
  };

  useEffect(() => {
    if (selectedLineIds.size === 0) return;
    setSelectedLineIds((prev) => {
      const next = new Set<string>();
      for (const id of prev) {
        const line = lineById.get(id);
        if (!line) continue;
        if (isLineFullyInvoiced(line)) continue;
        next.add(id);
      }
      return next;
    });
  }, [invoiceCoverage, lineById, selectedLineIds.size]);

  const galaxusOrderId = orderDetail ? String(orderDetail.galaxusOrderId ?? "") : "";
  const deliveryType = orderDetail ? String(orderDetail.deliveryType ?? "") : "";
  const currencyCode = orderDetail ? String(orderDetail.currencyCode ?? "CHF") : "CHF";

  const lineIdsParam = useMemo(() => Array.from(selectedLineIds).join(","), [selectedLineIds]);
  const fullyInvoicedCount = useMemo(
    () => lines.filter((line) => isLineFullyInvoiced(line)).length,
    [lines, invoiceCoverage]
  );

  const canBuildInvo = Boolean(selectedOrderId && orderDetail && selectedLineIds.size > 0);

  const standardInvoicePdfHref = useMemo(() => {
    if (!canBuildInvo || !selectedOrderId) return null;
    const dc =
      standardDeliveryCharge !== "" && Number.isFinite(Number(standardDeliveryCharge))
        ? `&deliveryCharge=${Number(standardDeliveryCharge)}`
        : "";
    return `/api/galaxus/edi/invoice-pdf?orderId=${encodeURIComponent(
      selectedOrderId
    )}&lineIds=${encodeURIComponent(lineIdsParam)}${dc}`;
  }, [canBuildInvo, selectedOrderId, lineIdsParam, standardDeliveryCharge]);

  const sendInvoice = async () => {
    if (!selectedOrderId || !orderDetail || selectedLineIds.size === 0) {
      setError("Select an order and at least one product line.");
      return;
    }
    setBusy(true);
    setError(null);
    setResult("");
    try {
      const res = await fetch("/api/galaxus/edi/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId: selectedOrderId,
          types: ["INVO"],
          force: true,
          lineIds: Array.from(selectedLineIds),
          deliveryCharge:
            standardDeliveryCharge === "" || !Number.isFinite(Number(standardDeliveryCharge))
              ? undefined
              : Number(standardDeliveryCharge),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) throw new Error((data as { error?: string })?.error ?? "INVO send failed");
      setResult(JSON.stringify(data, null, 2));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "INVO send failed");
    } finally {
      setBusy(false);
    }
  };

  const fetchLastInvoice = async () => {
    const ref = galaxusOrderId || selectedOrderId;
    if (!ref) {
      setLastError("Select an order first.");
      return;
    }
    setLastBusy(true);
    setLastError(null);
    setLastInvoice(null);
    try {
      const res = await fetch(`/api/galaxus/edi/outgoing/last-invoice?orderId=${encodeURIComponent(ref)}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !(data as { ok?: boolean })?.ok) {
        throw new Error((data as { error?: string })?.error ?? "Failed to load last INVO");
      }
      setLastInvoice(data as Record<string, unknown>);
    } catch (err: unknown) {
      setLastError(err instanceof Error ? err.message : "Failed to load last INVO");
    } finally {
      setLastBusy(false);
    }
  };

  type PreparedCustom = {
    orderReferenceId: string;
    description: string;
    quantity: number;
    unitNetPrice: number;
    vatRate: number;
    supplierPid: string | null;
    buyerPid: string | null;
    gtin: string | null;
    orderUnit: string | null;
    taxAmountPerUnit: number | null;
    lineNetAmount: number | null;
  };

  function buildPreparedCustomLines():
    | { ok: true; baseOrderId: string; prepared: PreparedCustom[] }
    | { ok: false; message: string } {
    const baseOrderId = customBaseOrderId.trim();
    if (!baseOrderId) {
      return { ok: false, message: "Base order id is required (warehouse delivery order)." };
    }
    const prepared = customLines
      .map((line) => ({
        orderReferenceId: line.orderReferenceId.trim(),
        description: line.description.trim(),
        quantity: Number(line.quantity || 0),
        unitNetPrice: Number(line.unitNetPrice || 0),
        vatRate: Number(line.vatRate || 0),
        supplierPid: line.supplierPid.trim() || null,
        buyerPid: line.buyerPid.trim() || null,
        gtin: line.gtin.trim() || null,
        orderUnit: line.orderUnit.trim() || null,
        taxAmountPerUnit: line.taxAmountPerUnit === "" ? null : Number(line.taxAmountPerUnit),
        lineNetAmount: line.lineNetAmount === "" ? null : Number(line.lineNetAmount),
      }))
      .filter((line) => line.orderReferenceId || line.description);
    if (prepared.length === 0) {
      return { ok: false, message: "Add at least one invoice line." };
    }
    if (prepared.some((line) => !line.orderReferenceId || !line.description)) {
      return { ok: false, message: "Each line needs an order reference id and description." };
    }
    return { ok: true, baseOrderId, prepared };
  }

  const updateCustomLine = (id: string, key: keyof CustomInvoiceLine, value: string | number | "") => {
    setCustomLines((prev) =>
      prev.map((line) => (line.id === id ? { ...line, [key]: value } : line))
    );
  };

  const addCustomLine = () => setCustomLines((prev) => [...prev, createCustomLine()]);
  const removeCustomLine = (id: string) =>
    setCustomLines((prev) => (prev.length > 1 ? prev.filter((line) => line.id !== id) : prev));

  const sendCustomInvoice = async () => {
    const built = buildPreparedCustomLines();
    if (!built.ok) {
      setCustomError(built.message);
      return;
    }

    setCustomBusy(true);
    setCustomError(null);
    setCustomResult("");
    try {
      const res = await fetch("/api/galaxus/edi/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "custom-invoice",
          baseOrderId: built.baseOrderId,
          deliveryCharge:
            customDeliveryCharge === "" || !Number.isFinite(Number(customDeliveryCharge))
              ? undefined
              : Number(customDeliveryCharge),
          lines: built.prepared,
          force: true,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !(data as { ok?: boolean })?.ok) {
        throw new Error((data as { error?: string })?.error ?? "Custom INVO send failed");
      }
      setCustomResult(JSON.stringify(data, null, 2));
    } catch (err: unknown) {
      setCustomError(err instanceof Error ? err.message : "Custom INVO send failed");
    } finally {
      setCustomBusy(false);
    }
  };

  const downloadCustomInvoicePdf = async () => {
    const built = buildPreparedCustomLines();
    if (!built.ok) {
      setCustomError(built.message);
      return;
    }
    setCustomPdfBusy(true);
    setCustomError(null);
    try {
      const res = await fetch("/api/galaxus/edi/invoice-pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "custom",
          baseOrderId: built.baseOrderId,
          deliveryCharge:
            customDeliveryCharge === "" || !Number.isFinite(Number(customDeliveryCharge))
              ? undefined
              : Number(customDeliveryCharge),
          lines: built.prepared,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string })?.error ?? `PDF failed (${res.status})`);
      }
      const blob = await res.blob();
      const cd = res.headers.get("Content-Disposition");
      const match = cd?.match(/filename="([^"]+)"/);
      const filename = match?.[1] ?? "invoice.pdf";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: unknown) {
      setCustomError(err instanceof Error ? err.message : "PDF failed");
    } finally {
      setCustomPdfBusy(false);
    }
  };

  const openSsccModal = () => {
    const guessedOrder = String(orderDetail?.orderNumber ?? orderDetail?.galaxusOrderId ?? "").trim();
    setSsccOrderId(guessedOrder);
    setSsccShipmentId("");
    setSsccError(null);
    setSsccModalOpen(true);
  };

  const downloadSsccLabel = async () => {
    const orderId = ssccOrderId.trim();
    const shipmentId = ssccShipmentId.trim();
    if (!orderId || !shipmentId) {
      setSsccError("Order ID and shipment ID are required.");
      return;
    }
    setSsccBusy(true);
    setSsccError(null);
    try {
      const selectedPreset =
        SSCC_PRINT_PRESETS.find((preset) => preset.id === ssccPresetId) ?? SSCC_PRINT_PRESETS[0];
      const res = await fetch("/api/galaxus/sscc/manual/full", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shipmentId,
          orderNumbers: [orderId],
          recipient: {
            name: "Digitec Galaxus AG",
            line1: "Dock A19 - A39",
            line2: "Ferroring 23",
            postalCode: "CH-5612",
            city: "Villmergen",
            country: "Schweiz",
          },
          print: {
            widthMm: selectedPreset.widthMm,
            heightMm: selectedPreset.heightMm,
            rotateDegrees: selectedPreset.rotateDegrees,
          },
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string })?.error ?? `SSCC label failed (${res.status})`);
      }
      const blob = await res.blob();
      const cd = res.headers.get("Content-Disposition");
      const match = cd?.match(/filename="([^"]+)"/);
      const fallback = `sscc-${shipmentId}-${orderId}.pdf`;
      const filename = match?.[1] ?? fallback;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      setSsccModalOpen(false);
    } catch (err: unknown) {
      setSsccError(err instanceof Error ? err.message : "SSCC label failed");
    } finally {
      setSsccBusy(false);
    }
  };

  return (
    <main className="p-6 space-y-4 max-w-5xl">
      <div>
        <h1 className="text-2xl font-semibold">Galaxus Invoices Center</h1>
        <p className="text-sm text-gray-600">
          Pick an order, choose lines, download a <strong>PDF</strong> to verify, then <strong>send INVO</strong> to
          Galaxus when ready.
        </p>
      </div>

      <section className="border rounded bg-slate-50 border-slate-200 p-4 text-sm text-slate-800 space-y-2">
        <div className="font-medium text-slate-900">How this works</div>
        <ul className="list-disc pl-5 space-y-1 text-slate-700">
          <li>
            <strong>Orders</strong> load from the DB with <strong>view=all</strong> (includes archived/cancelled), newest{" "}
            <strong>order date</strong> first, up to 500. Type at least <strong>2 characters</strong> in search to query by
            Galaxus id or <strong>order #</strong> (<code className="text-xs bg-white px-1 rounded">orderNumber</code>).
          </li>
          <li>
            After you select an order, we load its <strong>lines</strong>. Check the products to include on the invoice;
            the XML is built only from those line ids.
          </li>
          <li>
            <strong>Download invoice (PDF)</strong> is a printable preview for your checks (same lines + optional
            delivery charge). <strong>Send INVO XML</strong> uploads the OpenTrans file to Galaxus (no XML file download
            here).
          </li>
          <li>
            Optional <strong>delivery charge</strong> (excl. VAT) is included in both PDF and sent XML; direct-delivery
            orders may still get automatic handling in code if you leave it empty.
          </li>
        </ul>
      </section>

      <section className="border rounded bg-white p-4 space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[240px]">
            <label className="block text-sm font-medium mb-1">Order</label>
            <select
              className="w-full border rounded px-3 py-2 text-sm"
              value={selectedOrderId}
              onChange={onOrderSelectChange}
              disabled={busy || ordersLoading}
            >
              <option value="">{ordersLoading ? "Loading orders…" : "— Select an order —"}</option>
              {orderListItems.map((o) => {
                const dateLabel = formatOrderListDate(o.orderDate);
                const num = o.orderNumber?.trim();
                const status =
                  o.cancelledAt != null ? "cancelled" : o.archivedAt != null ? "archived" : null;
                const invTag = formatInvoiceStatusTag(o);
                return (
                  <option key={o.id} value={o.id}>
                    {o.galaxusOrderId}
                    {num && num !== o.galaxusOrderId ? ` · #${num}` : ""}
                    {dateLabel ? ` · ${dateLabel}` : ""}
                    {o.deliveryType ? ` · ${o.deliveryType}` : ""}
                    {o._count?.lines != null ? ` · ${o._count.lines} lines` : ""}
                    {status ? ` · [${status}]` : ""}
                    {invTag ? ` · [${invTag}]` : ""}
                  </option>
                );
              })}
            </select>
          </div>
          <div className="flex-1 min-w-[200px]">
            <label className="block text-sm font-medium mb-1">Search (API)</label>
            <input
              className="w-full border rounded px-3 py-2 text-sm"
              value={orderSearch}
              onChange={(e) => setOrderSearch(e.target.value)}
              placeholder="e.g. 180244951 — min 2 chars searches id + order #"
              disabled={ordersLoading}
            />
          </div>
        </div>

        {selectedOrderId && orderDetail ? (
          <div className="text-xs text-gray-600 space-y-1">
            <div>
              <span className="font-medium text-gray-800">Galaxus order id:</span> {galaxusOrderId || "—"}
            </div>
            {deliveryType ? (
              <div>
                <span className="font-medium text-gray-800">Delivery:</span> {deliveryType}
              </div>
            ) : null}
          </div>
        ) : null}

        {orderDetailLoading ? (
          <div className="text-sm text-gray-500">Loading order lines…</div>
        ) : null}

        {orderDetail && lines.length > 0 ? (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium">Invoice lines</span>
              <button
                type="button"
                className="px-2 py-1 rounded bg-gray-100 text-xs"
                onClick={selectAllLines}
                disabled={busy}
              >
                Select all
              </button>
              <button
                type="button"
                className="px-2 py-1 rounded bg-gray-100 text-xs"
                onClick={selectNoLines}
                disabled={busy}
              >
                Select none
              </button>
              <span className="text-xs text-gray-500">
                {selectedLineIds.size} of {lines.length} selected
              </span>
              {coverageLoading ? (
                <span className="text-xs text-gray-500">Checking invoice history…</span>
              ) : coverageError ? (
                <span className="text-xs text-rose-700">{coverageError}</span>
              ) : fullyInvoicedCount > 0 ? (
                <span className="text-xs text-rose-700">
                  {fullyInvoicedCount} line(s) already invoiced (locked)
                </span>
              ) : null}
            </div>
            <div className="overflow-auto border rounded max-h-96">
              <table className="min-w-full text-xs">
                <thead className="bg-gray-50 sticky top-0">
                  <tr>
                    <th className="px-2 py-2 w-10"></th>
                    <th className="px-2 py-2 text-left">#</th>
                    <th className="px-2 py-2 text-left min-w-[180px]">Product</th>
                    <th className="px-2 py-2 text-left">Size</th>
                    <th className="px-2 py-2 text-left">SKU</th>
                    <th className="px-2 py-2 text-left font-mono">GTIN</th>
                    <th className="px-2 py-2 text-right">Qty</th>
                    <th className="px-2 py-2 text-right">Unit net</th>
                    <th className="px-2 py-2 text-right">Line net</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line) => {
                    const lid = String(line.id ?? "");
                    const lineNumber = line.lineNumber ?? "—";
                    const title = displayProductTitle(line);
                    const size = displaySize(line);
                    const sku = displaySku(line);
                    const gtin = String(line.gtin ?? "").trim() || "—";
                    const qty = line.quantity ?? "—";
                    const unitStr = formatMoney(line.unitNetPrice, currencyCode);
                    const lineNetStr = formatMoney(lineNetFromOrderLine(line), currencyCode);
                    const orderedQty = lineOrderedQty(line);
                    const invoicedQty = lineInvoicedQty(line);
                    const fullyInvoiced = isLineFullyInvoiced(line);
                    const partiallyInvoiced = !fullyInvoiced && invoicedQty > 0;
                    return (
                      <tr
                        key={lid || String(lineNumber)}
                        className={`border-t ${fullyInvoiced ? "opacity-50 blur-[0.5px]" : ""}`}
                      >
                        <td className="px-2 py-1.5">
                          <input
                            type="checkbox"
                            checked={lid ? selectedLineIds.has(lid) : false}
                            onChange={(e) => lid && toggleLine(lid, e.target.checked)}
                            disabled={busy || !lid || fullyInvoiced}
                          />
                        </td>
                        <td className="px-2 py-1.5 align-top">{String(lineNumber)}</td>
                        <td className="px-2 py-1.5 align-top max-w-[min(280px,40vw)]">
                          <div className="font-medium text-gray-900 leading-snug">{title}</div>
                          {String(line.description ?? "").trim() &&
                          String(line.description ?? "").trim() !== title ? (
                            <div className="text-gray-500 mt-0.5 leading-snug line-clamp-2">
                              {String(line.description)}
                            </div>
                          ) : null}
                          {fullyInvoiced ? (
                            <div className="text-[11px] text-rose-700 mt-1">
                              Invoiced already ({invoicedQty}/{orderedQty})
                            </div>
                          ) : partiallyInvoiced ? (
                            <div className="text-[11px] text-amber-700 mt-1">
                              Partially invoiced ({invoicedQty}/{orderedQty})
                            </div>
                          ) : null}
                        </td>
                        <td className="px-2 py-1.5 align-top text-gray-800 whitespace-nowrap">{size}</td>
                        <td className="px-2 py-1.5 align-top font-mono text-[11px] text-gray-800">{sku}</td>
                        <td className="px-2 py-1.5 align-top font-mono text-[11px]">{gtin}</td>
                        <td className="px-2 py-1.5 text-right align-top">{String(qty)}</td>
                        <td className="px-2 py-1.5 text-right align-top tabular-nums">{unitStr}</td>
                        <td className="px-2 py-1.5 text-right align-top tabular-nums">{lineNetStr}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        {orderDetail && lines.length === 0 && !orderDetailLoading ? (
          <div className="text-sm text-amber-700">This order has no lines in the database.</div>
        ) : null}

        <label className="flex flex-wrap items-center gap-2 text-xs text-gray-600">
          Optional delivery charge (excl. VAT)
          <input
            className="w-24 border rounded px-2 py-1 text-right text-sm"
            type="number"
            min={0}
            step={0.01}
            value={standardDeliveryCharge}
            onChange={(e) =>
              setStandardDeliveryCharge(e.target.value === "" ? "" : Number(e.target.value))
            }
            disabled={busy}
          />
        </label>

        <div className="flex flex-wrap gap-2">
          <button
            className="px-3 py-2 rounded bg-indigo-600 text-white text-sm disabled:opacity-50"
            type="button"
            onClick={() => void sendInvoice()}
            disabled={busy || !canBuildInvo}
          >
            {busy ? "Sending…" : "Send INVO XML"}
          </button>
          {standardInvoicePdfHref ? (
            <a
              className="px-3 py-2 rounded bg-white border border-rose-200 text-rose-900 text-sm inline-block"
              href={standardInvoicePdfHref}
            >
              Download invoice (PDF)
            </a>
          ) : (
            <span className="px-3 py-2 rounded bg-gray-50 text-gray-500 text-sm">
              PDF (select order + lines)
            </span>
          )}
          <button
            className="px-3 py-2 rounded bg-white border border-blue-200 text-blue-900 text-sm disabled:opacity-50"
            type="button"
            onClick={openSsccModal}
            disabled={busy}
          >
            Generate SSCC label
          </button>
          <button
            className="px-3 py-2 rounded bg-gray-100 text-sm disabled:opacity-50"
            type="button"
            onClick={() => void fetchLastInvoice()}
            disabled={lastBusy || !selectedOrderId}
          >
            {lastBusy ? "Loading…" : "Load last INVO"}
          </button>
          <a href="/galaxus" className="px-3 py-2 rounded bg-gray-100 text-sm">
            Ops &amp; Data
          </a>
          <a href="/galaxus/warehouse" className="px-3 py-2 rounded bg-gray-100 text-sm">
            Warehouse
          </a>
        </div>
      </section>

      {error ? <div className="text-sm text-red-600">{error}</div> : null}
      {lastError ? <div className="text-sm text-red-600">{lastError}</div> : null}
      {lastInvoice ? (
        <div className="border rounded bg-white p-4 space-y-2 text-xs">
          <div className="text-sm font-medium">Last INVO sent</div>
          <div className="text-gray-600">
            {String((lastInvoice.file as { filename?: string })?.filename ?? "Unknown file")}
            {(lastInvoice.file as { createdAt?: string })?.createdAt
              ? ` · ${new Date(String((lastInvoice.file as { createdAt: string }).createdAt)).toLocaleString()}`
              : ""}
          </div>
          {Array.isArray((lastInvoice.payload as { items?: unknown })?.items) &&
          ((lastInvoice.payload as { items: unknown[] }).items?.length ?? 0) > 0 ? (
            <div className="overflow-auto border rounded max-h-72">
              <table className="min-w-full text-xs">
                <thead className="bg-gray-50 sticky top-0">
                  <tr>
                    <th className="px-2 py-1.5 text-left">Product</th>
                    <th className="px-2 py-1.5 text-left">Size</th>
                    <th className="px-2 py-1.5 text-left">SKU</th>
                    <th className="px-2 py-1.5 text-left font-mono">GTIN</th>
                    <th className="px-2 py-1.5 text-right">Qty</th>
                    <th className="px-2 py-1.5 text-right">Unit net</th>
                    <th className="px-2 py-1.5 text-right">Line net</th>
                  </tr>
                </thead>
                <tbody>
                  {(lastInvoice.payload as { items: Array<Record<string, unknown>> }).items.map(
                    (item, idx) => {
                      const resolved =
                        lines.length > 0 ? resolveOrderLineForPayloadItem(item, lines) : null;
                      const title = resolved
                        ? displayProductTitle(resolved)
                        : String(item.description ?? "").trim() || "—";
                      const size = resolved ? displaySize(resolved) : "—";
                      const sku = resolved ? displaySku(resolved) : "—";
                      const gtin = String(item.gtin ?? resolved?.gtin ?? "").trim() || "—";
                      const qty = num(item.quantity);
                      const unit = num(item.unitNetPrice);
                      const lineNetExplicit = num(item.lineNetAmount);
                      const lineNet = Number.isFinite(lineNetExplicit)
                        ? lineNetExplicit
                        : Number.isFinite(qty) && Number.isFinite(unit)
                          ? Number((qty * unit).toFixed(2))
                          : NaN;
                      return (
                        <tr key={idx} className="border-t">
                          <td className="px-2 py-1.5 align-top max-w-[min(240px,45vw)]">
                            <div className="font-medium text-gray-900">{title}</div>
                            {!resolved && String(item.description ?? "").trim() ? (
                              <div className="text-gray-500 text-[11px] mt-0.5">
                                {String(item.description)}
                              </div>
                            ) : null}
                          </td>
                          <td className="px-2 py-1.5 align-top whitespace-nowrap">{size}</td>
                          <td className="px-2 py-1.5 align-top font-mono text-[11px]">{sku}</td>
                          <td className="px-2 py-1.5 align-top font-mono text-[11px]">{gtin}</td>
                          <td className="px-2 py-1.5 text-right align-top">
                            {Number.isFinite(qty) ? String(qty) : "—"}
                          </td>
                          <td className="px-2 py-1.5 text-right align-top tabular-nums">
                            {formatMoney(item.unitNetPrice, currencyCode)}
                          </td>
                          <td className="px-2 py-1.5 text-right align-top tabular-nums">
                            {formatMoney(lineNet, currencyCode)}
                          </td>
                        </tr>
                      );
                    }
                  )}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-gray-500">No line details stored for this invoice.</div>
          )}
        </div>
      ) : null}
      {result ? (
        <pre className="text-xs bg-gray-900 text-gray-100 rounded p-3 overflow-auto max-h-72">{result}</pre>
      ) : null}

      {ssccModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded bg-white p-4 shadow-lg space-y-3">
            <div>
              <h2 className="text-base font-semibold">Generate SSCC label</h2>
              <p className="text-xs text-gray-600">
                Enter order ID and shipment ID, then the PDF downloads directly.
              </p>
            </div>
            <label className="block text-sm">
              <span className="mb-1 block font-medium">Order ID</span>
              <input
                className="w-full border rounded px-3 py-2 text-sm"
                value={ssccOrderId}
                onChange={(e) => setSsccOrderId(e.target.value)}
                placeholder="e.g. 182457653"
                disabled={ssccBusy}
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium">Shipment ID</span>
              <input
                className="w-full border rounded px-3 py-2 text-sm"
                value={ssccShipmentId}
                onChange={(e) => setSsccShipmentId(e.target.value)}
                placeholder="e.g. 42451523"
                disabled={ssccBusy}
              />
            </label>
            <div className="block text-sm">
              <span className="mb-1 block font-medium">Print preset</span>
              <div className="flex flex-wrap gap-2">
                {SSCC_PRINT_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => setSsccPresetId(preset.id)}
                    disabled={ssccBusy}
                    className={`px-2 py-1 rounded border text-xs ${
                      ssccPresetId === preset.id
                        ? "bg-blue-600 border-blue-600 text-white"
                        : "bg-white border-gray-300 text-gray-700"
                    }`}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>
            {ssccError ? <div className="text-sm text-red-600">{ssccError}</div> : null}
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                className="px-3 py-2 rounded bg-gray-100 text-sm"
                onClick={() => setSsccModalOpen(false)}
                disabled={ssccBusy}
              >
                Cancel
              </button>
              <button
                type="button"
                className="px-3 py-2 rounded bg-blue-600 text-white text-sm disabled:opacity-50"
                onClick={() => void downloadSsccLabel()}
                disabled={ssccBusy}
              >
                {ssccBusy ? "Generating..." : "Generate & download PDF"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <details className="border rounded bg-white p-4 group">
        <summary className="text-sm font-semibold cursor-pointer text-gray-800">
          Advanced: collective invoice (manual lines, warehouse only)
        </summary>
        <p className="text-xs text-gray-600 mt-2 mb-3">
          For multiple Galaxus order ids on one XML header. Type each line and order reference by hand.
        </p>
        <label className="block text-sm font-medium">Base order id (warehouse)</label>
        <input
          className="w-full border rounded px-3 py-2 text-sm mb-3"
          value={customBaseOrderId}
          onChange={(e) => setCustomBaseOrderId(e.target.value)}
          placeholder="UUID or galaxusOrderId"
          disabled={customBusy}
        />
        <div className="overflow-auto border rounded mb-3">
          <table className="min-w-full text-xs">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-2 py-1 text-left">Order ref</th>
                <th className="px-2 py-1 text-left">Description</th>
                <th className="px-2 py-1 text-right">Qty</th>
                <th className="px-2 py-1 text-right">Unit net</th>
                <th className="px-2 py-1 text-right">VAT %</th>
                <th className="px-2 py-1 text-left">PID</th>
                <th className="px-2 py-1 text-left">Buyer PID</th>
                <th className="px-2 py-1 text-left">GTIN</th>
                <th className="px-2 py-1"></th>
              </tr>
            </thead>
            <tbody>
              {customLines.map((line) => (
                <tr key={line.id} className="border-t">
                  <td className="px-2 py-1">
                    <input
                      className="w-28 border rounded px-1 py-0.5"
                      value={line.orderReferenceId}
                      onChange={(e) => updateCustomLine(line.id, "orderReferenceId", e.target.value)}
                      disabled={customBusy}
                    />
                  </td>
                  <td className="px-2 py-1">
                    <input
                      className="w-48 border rounded px-1 py-0.5"
                      value={line.description}
                      onChange={(e) => updateCustomLine(line.id, "description", e.target.value)}
                      disabled={customBusy}
                    />
                  </td>
                  <td className="px-2 py-1">
                    <input
                      className="w-14 border rounded px-1 py-0.5 text-right"
                      type="number"
                      value={line.quantity}
                      onChange={(e) => updateCustomLine(line.id, "quantity", Number(e.target.value || 0))}
                      disabled={customBusy}
                    />
                  </td>
                  <td className="px-2 py-1">
                    <input
                      className="w-16 border rounded px-1 py-0.5 text-right"
                      type="number"
                      step={0.01}
                      value={line.unitNetPrice}
                      onChange={(e) => updateCustomLine(line.id, "unitNetPrice", Number(e.target.value || 0))}
                      disabled={customBusy}
                    />
                  </td>
                  <td className="px-2 py-1">
                    <input
                      className="w-14 border rounded px-1 py-0.5 text-right"
                      type="number"
                      step={0.01}
                      value={line.vatRate}
                      onChange={(e) => updateCustomLine(line.id, "vatRate", Number(e.target.value || 0))}
                      disabled={customBusy}
                    />
                  </td>
                  <td className="px-2 py-1">
                    <input
                      className="w-24 border rounded px-1 py-0.5"
                      value={line.supplierPid}
                      onChange={(e) => updateCustomLine(line.id, "supplierPid", e.target.value)}
                      disabled={customBusy}
                    />
                  </td>
                  <td className="px-2 py-1">
                    <input
                      className="w-24 border rounded px-1 py-0.5"
                      value={line.buyerPid}
                      onChange={(e) => updateCustomLine(line.id, "buyerPid", e.target.value)}
                      disabled={customBusy}
                    />
                  </td>
                  <td className="px-2 py-1">
                    <input
                      className="w-24 border rounded px-1 py-0.5"
                      value={line.gtin}
                      onChange={(e) => updateCustomLine(line.id, "gtin", e.target.value)}
                      disabled={customBusy}
                    />
                  </td>
                  <td className="px-2 py-1">
                    <button
                      type="button"
                      className="px-1 py-0.5 rounded bg-gray-100 text-[10px]"
                      onClick={() => removeCustomLine(line.id)}
                      disabled={customBusy || customLines.length <= 1}
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap gap-2 items-center mb-2">
          <button type="button" className="px-2 py-1 rounded bg-gray-100 text-xs" onClick={addCustomLine}>
            + Line
          </button>
          <label className="flex items-center gap-1 text-xs">
            Charge excl. VAT
            <input
              className="w-20 border rounded px-1 py-0.5"
              type="number"
              value={customDeliveryCharge}
              onChange={(e) =>
                setCustomDeliveryCharge(e.target.value === "" ? "" : Number(e.target.value))
              }
            />
          </label>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="px-3 py-2 rounded border border-rose-200 text-rose-900 text-sm"
            onClick={() => void downloadCustomInvoicePdf()}
            disabled={customBusy || customPdfBusy}
          >
            {customPdfBusy ? "…" : "Download PDF"}
          </button>
          <button
            type="button"
            className="px-3 py-2 rounded bg-emerald-600 text-white text-sm"
            onClick={() => void sendCustomInvoice()}
            disabled={customBusy || customPdfBusy}
          >
            Send
          </button>
        </div>
        {customError ? <div className="text-sm text-red-600 mt-2">{customError}</div> : null}
        {customResult ? (
          <pre className="text-xs bg-gray-900 text-gray-100 rounded p-3 overflow-auto max-h-48 mt-2">
            {customResult}
          </pre>
        ) : null}
      </details>
    </main>
  );
}
