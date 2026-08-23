"use client";

import { useEffect, useMemo, useState } from "react";

type OrderSummary = {
  id: string;
  orderNumber?: string | null;
  galaxusOrderId: string;
  orderDate: string;
  lineCount?: number;
  totalUnits?: number;
};

type EligibleLine = {
  id: string;
  lineNumber: number | null;
  gtin: string | null;
  supplierPid: string | null;
  supplierSku: string | null;
  productName: string | null;
  productKey?: string | null;
  providerKey?: string | null;
  size: string | null;
  quantity: number;
  remaining: number;
};

type EligibleOrder = {
  id: string;
  orderNumber: string;
  galaxusOrderId: string;
  orderDate: string;
  lines: EligibleLine[];
};

export default function PartnerGalaxusShipmentsPage() {
  const [orders, setOrders] = useState<OrderSummary[]>([]);
  const [anchorOrderId, setAnchorOrderId] = useState<string>("");
  const [eligibleOrders, setEligibleOrders] = useState<EligibleOrder[]>([]);
  const [drafts, setDrafts] = useState<any[]>([]);
  const [recent, setRecent] = useState<any[]>([]);
  const [selectedQtyByLineId, setSelectedQtyByLineId] = useState<Record<string, number>>({});
  const [scanInput, setScanInput] = useState("");
  const [trackingNumber, setTrackingNumber] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<string | null>(null);

  const loadOrders = async () => {
    const res = await fetch("/api/partners/galaxus/orders?limit=100&deliveryType=warehouse_delivery", {
      cache: "no-store",
    });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error ?? "Failed to load orders");
    setOrders(data.items ?? []);
    if (!anchorOrderId && data.items?.[0]?.id) setAnchorOrderId(data.items[0].id);
  };

  const loadEligible = async (orderId: string) => {
    if (!orderId) return;
    const res = await fetch(`/api/partners/galaxus/shipments/eligible?anchorOrderId=${encodeURIComponent(orderId)}`, {
      cache: "no-store",
    });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error ?? "Failed to load eligible lines");
    setEligibleOrders(data.orders ?? []);
    setSelectedQtyByLineId({});
  };

  const loadDraftsAndRecent = async () => {
    const [draftRes, recentRes] = await Promise.all([
      fetch("/api/partners/galaxus/shipments/drafts", { cache: "no-store" }),
      fetch("/api/partners/galaxus/shipments/recent?limit=30", { cache: "no-store" }),
    ]);
    const draftData = await draftRes.json();
    const recentData = await recentRes.json();
    if (!draftRes.ok || !draftData.ok) throw new Error(draftData.error ?? "Failed to load drafts");
    if (!recentRes.ok || !recentData.ok) throw new Error(recentData.error ?? "Failed to load recent");
    setDrafts(draftData.drafts ?? []);
    setRecent(recentData.shipments ?? []);
  };

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);
      try {
        await Promise.all([loadOrders(), loadDraftsAndRecent()]);
      } catch (e: any) {
        setError(e.message ?? "Failed to load");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (!anchorOrderId) return;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        await loadEligible(anchorOrderId);
      } catch (e: any) {
        setError(e.message ?? "Failed to load eligible lines");
      } finally {
        setLoading(false);
      }
    })();
  }, [anchorOrderId]);

  const selectedItems = useMemo(() => {
    const lineToOrder = new Map<string, string>();
    for (const order of eligibleOrders) {
      for (const line of order.lines) lineToOrder.set(line.id, order.id);
    }
    return Object.entries(selectedQtyByLineId)
      .map(([lineId, quantity]) => ({
        lineId,
        sourceOrderId: lineToOrder.get(lineId) ?? "",
        quantity: Math.max(0, Number(quantity ?? 0)),
      }))
      .filter((item) => item.sourceOrderId && item.quantity > 0);
  }, [eligibleOrders, selectedQtyByLineId]);

  const toggleLine = (lineId: string, defaultQty: number) => {
    setSelectedQtyByLineId((prev) => {
      const next = { ...prev };
      if (next[lineId]) delete next[lineId];
      else next[lineId] = Math.max(1, defaultQty);
      return next;
    });
  };

  const applyScan = () => {
    const key = scanInput.replace(/\D/g, "");
    if (!key) return;
    for (const order of eligibleOrders) {
      for (const line of order.lines) {
        const lineKey = String(line.gtin ?? "").replace(/\D/g, "");
        if (!lineKey || lineKey !== key) continue;
        setSelectedQtyByLineId((prev) => ({ ...prev, [line.id]: prev[line.id] ?? 1 }));
        setScanInput("");
        return;
      }
    }
    setError(`GTIN ${scanInput} not found in eligible lines`);
  };

  const createComposite = async () => {
    if (!anchorOrderId || selectedItems.length === 0) return;
    setLoading(true);
    setError(null);
    setLog(null);
    try {
      const res = await fetch("/api/partners/galaxus/shipments/composite", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          anchorOrderId,
          items: selectedItems,
          trackingNumber: trackingNumber || undefined,
          confirmReplace: true,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Shipment creation failed");
      setLog(`Shipment created: ${data.shipment?.shipmentId ?? data.shipment?.id ?? "unknown"}`);
      await Promise.all([loadEligible(anchorOrderId), loadDraftsAndRecent()]);
      setSelectedQtyByLineId({});
      setTrackingNumber("");
    } catch (e: any) {
      setError(e.message ?? "Shipment creation failed");
    } finally {
      setLoading(false);
    }
  };

  const runDraftAction = async (shipmentId: string, action: "label" | "deliveryNote" | "postLabel" | "delr") => {
    setLoading(true);
    setError(null);
    setLog(null);
    try {
      if (action === "deliveryNote") {
        const res = await fetch(`/api/partners/galaxus/shipments/${shipmentId}/delivery-note?force=1`, {
          cache: "no-store",
        });
        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data.error ?? "Delivery note failed");
        if (data.url) window.open(data.url, "_blank", "noopener,noreferrer");
      } else {
        const method = action === "label" ? "POST" : "POST";
        const path =
          action === "label"
            ? `/api/partners/galaxus/shipments/${shipmentId}/label`
            : action === "postLabel"
              ? `/api/partners/galaxus/shipments/${shipmentId}/post-label`
              : `/api/partners/galaxus/shipments/${shipmentId}/delr`;
        const res = await fetch(path, { method, headers: { "content-type": "application/json" }, body: "{}" });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.ok) throw new Error(data.error ?? "Action failed");
      }
      await loadDraftsAndRecent();
      setLog(`Action ${action} done for ${shipmentId}`);
    } catch (e: any) {
      setError(e.message ?? "Action failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Partner Galaxus Shipments</h1>
        <p className="text-sm text-slate-500">Warehouse delivery only. Scope locked to your partner lines.</p>
      </div>
      {loading ? <div className="text-xs text-slate-500">Loading…</div> : null}
      {error ? <div className="text-sm text-red-600">{error}</div> : null}
      {log ? <div className="text-xs text-emerald-700">{log}</div> : null}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="rounded border bg-white p-3">
          <div className="mb-2 font-semibold">Anchor order</div>
          <div className="space-y-2 max-h-[360px] overflow-auto">
            {orders.map((order) => (
              <button
                key={order.id}
                className={`w-full rounded border p-2 text-left text-sm ${anchorOrderId === order.id ? "border-black" : "border-slate-200"}`}
                onClick={() => setAnchorOrderId(order.id)}
              >
                <div className="font-medium">{order.orderNumber ?? order.galaxusOrderId}</div>
                <div className="text-xs text-slate-500">
                  {new Date(order.orderDate).toLocaleDateString("fr-CH")} · {order.lineCount ?? 0} lines
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="rounded border bg-white p-3 md:col-span-2 space-y-3">
          <div className="font-semibold">Build shipment</div>
          <div className="flex flex-wrap gap-2">
            <input
              placeholder="Scan GTIN"
              value={scanInput}
              onChange={(e) => setScanInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && applyScan()}
              className="rounded border px-2 py-1.5 text-sm"
            />
            <button onClick={applyScan} className="rounded bg-slate-100 px-2 py-1.5 text-xs">
              Select by scan
            </button>
            <input
              placeholder="Tracking (optional)"
              value={trackingNumber}
              onChange={(e) => setTrackingNumber(e.target.value)}
              className="rounded border px-2 py-1.5 text-sm"
            />
            <button
              onClick={createComposite}
              disabled={selectedItems.length === 0}
              className="rounded bg-slate-900 px-3 py-1.5 text-xs text-white disabled:opacity-50"
            >
              Create composite shipment ({selectedItems.length})
            </button>
          </div>

          <div className="space-y-3 max-h-[420px] overflow-auto">
            {eligibleOrders.map((order) => (
              <div key={order.id} className="rounded border border-slate-200 p-2">
                <div className="text-sm font-medium">{order.orderNumber}</div>
                <div className="text-[11px] text-slate-500 mb-1">{order.galaxusOrderId}</div>
                <div className="space-y-1">
                  {order.lines.map((line) => (
                    <label key={line.id} className="flex items-start gap-2 rounded border border-slate-100 p-1.5 text-xs">
                      <input
                        type="checkbox"
                        checked={Boolean(selectedQtyByLineId[line.id])}
                        onChange={() => toggleLine(line.id, line.remaining || line.quantity || 1)}
                      />
                      <div className="min-w-0">
                        <div className="font-medium text-slate-800">{line.productName ?? "Item"}</div>
                        <div className="text-slate-500">
                          Key {line.productKey ?? line.providerKey ?? "—"} · GTIN {line.gtin ?? "—"} · SKU{" "}
                          {line.supplierSku ?? "—"} · Qty {line.remaining}
                        </div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="rounded border bg-white p-3">
          <div className="mb-2 font-semibold">Draft shipments</div>
          <div className="space-y-2 max-h-[340px] overflow-auto">
            {drafts.map((draft) => (
              <div key={draft.id} className="rounded border border-slate-200 p-2 text-xs space-y-1">
                <div className="font-medium">{draft.shipmentId ?? draft.id}</div>
                <div className="text-slate-500">{draft.anchorOrderNumber ?? "—"} · {draft.itemCount} items</div>
                <div className="flex flex-wrap gap-1">
                  <button onClick={() => runDraftAction(draft.id, "label")} className="rounded bg-slate-100 px-2 py-1">SSCC</button>
                  <button onClick={() => runDraftAction(draft.id, "deliveryNote")} className="rounded bg-slate-100 px-2 py-1">Delivery note</button>
                  <button onClick={() => runDraftAction(draft.id, "postLabel")} className="rounded bg-slate-900 px-2 py-1 text-white">Swiss Post + DELR</button>
                  <button onClick={() => runDraftAction(draft.id, "delr")} className="rounded bg-slate-100 px-2 py-1">DELR only</button>
                </div>
              </div>
            ))}
            {drafts.length === 0 ? <div className="text-xs text-slate-500">No drafts.</div> : null}
          </div>
        </div>
        <div className="rounded border bg-white p-3">
          <div className="mb-2 font-semibold">Recent shipments</div>
          <div className="space-y-2 max-h-[340px] overflow-auto">
            {recent.map((row) => (
              <div key={row.id} className="rounded border border-slate-200 p-2 text-xs">
                <div className="font-medium">{row.shipmentId ?? row.id}</div>
                <div className="text-slate-500">{row.orderNumber ?? row.galaxusOrderId ?? "—"} · {row.delrStatus ?? "PENDING"}</div>
              </div>
            ))}
            {recent.length === 0 ? <div className="text-xs text-slate-500">No recent shipments.</div> : null}
          </div>
        </div>
      </div>
    </div>
  );
}
