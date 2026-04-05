"use client";

import { useEffect, useState } from "react";

type ShipmentItem = {
  id: string;
  supplierPid: string;
  gtin14: string;
  quantity: number;
};

type Shipment = {
  id: string;
  shipmentId: string;
  providerKey?: string | null;
  packageId?: string | null;
  trackingNumber?: string | null;
  carrierFinal?: string | null;
  delrStatus?: string | null;
  delrFileName?: string | null;
  labelPdfUrl?: string | null;
  shippingLabelPdfUrl?: string | null;
  deliveryNotePdfUrl?: string | null;
  createdAt: string;
  items: ShipmentItem[];
  order?: {
    id: string;
    galaxusOrderId: string;
    orderNumber?: string | null;
    deliveryType?: string | null;
    ordrSentAt?: string | null;
  };
};

export default function PartnerOrdersPage() {
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>("PENDING");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [trackingById, setTrackingById] = useState<Record<string, string>>({});
  const [carrierById, setCarrierById] = useState<Record<string, string>>({});

  const loadShipments = async (statusOverride?: string) => {
    setBusy("load");
    setError(null);
    try {
      const statusValue = statusOverride ?? statusFilter;
      const params = new URLSearchParams();
      if (statusValue && statusValue !== "ALL") params.set("status", statusValue);
      const res = await fetch(`/api/partners/orders/shipments?${params.toString()}`, {
        cache: "no-store",
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Failed to load shipments");
      setShipments(data.shipments ?? []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };

  const submitTracking = async (shipmentId: string) => {
    const trackingNumber = (trackingById[shipmentId] ?? "").trim();
    const carrier = (carrierById[shipmentId] ?? "").trim();
    if (!trackingNumber) {
      setError("Tracking number is required.");
      return;
    }
    setBusy(`track-${shipmentId}`);
    setError(null);
    try {
      const res = await fetch(`/api/partners/orders/shipments/${shipmentId}/tracking`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trackingNumber, carrier }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Tracking update failed");
      await loadShipments();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };

  const fulfillShipment = async (shipmentId: string) => {
    const trackingNumber = (trackingById[shipmentId] ?? "").trim();
    const carrier = (carrierById[shipmentId] ?? "").trim();
    if (!trackingNumber) {
      setError("Tracking number is required.");
      return;
    }
    setBusy(`fulfill-${shipmentId}`);
    setError(null);
    try {
      const res = await fetch(`/api/partners/orders/shipments/${shipmentId}/fulfill`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trackingNumber, carrier }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Fulfillment failed");
      await loadShipments();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };

  useEffect(() => {
    loadShipments();
  }, [statusFilter]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 flex-wrap">
        <h1 className="text-lg font-semibold text-slate-900">Partner Fulfillment</h1>
        <div className="text-xs text-slate-500">
          Enter tracking, then use Fulfill to generate DELR, SSCC, and shipping labels.
        </div>
        <div className="flex items-center gap-2 text-sm">
          <span>Status</span>
          <select
            className="rounded border border-slate-200 px-2 py-1"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
            disabled={busy !== null}
          >
            <option value="PENDING">PENDING</option>
            <option value="UPLOADED">UPLOADED</option>
            <option value="ERROR">ERROR</option>
            <option value="ALL">All</option>
          </select>
          <button
            className="rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-600"
            onClick={() => loadShipments(statusFilter)}
            disabled={busy !== null}
          >
            {busy === "load" ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="space-y-3">
        {shipments.map((shipment) => (
          <div key={shipment.id} className="rounded-2xl border border-slate-200 bg-white p-4 space-y-2">
            <div className="text-xs text-slate-600">
              {shipment.shipmentId} · Provider {shipment.providerKey ?? "—"} · SSCC{" "}
              {shipment.packageId ?? "—"} · DELR {shipment.delrStatus ?? "—"}
            </div>
            <div className="text-xs text-slate-500">
              Status: {shipment.trackingNumber ? "Tracking set" : "Missing tracking"} ·{" "}
              {shipment.labelPdfUrl ? "SSCC ready" : "SSCC missing"} ·{" "}
              {shipment.shippingLabelPdfUrl ? "Shipping label ready" : "Shipping label missing"}
            </div>
            <div className="text-xs text-slate-500">
              Order {shipment.order?.galaxusOrderId ?? "—"} ·{" "}
              {shipment.order?.orderNumber ?? "—"} · {shipment.order?.deliveryType ?? "—"}
            </div>
            <div className="flex gap-2 flex-wrap items-center text-xs">
              <input
                className="rounded border border-slate-200 px-2 py-1"
                placeholder="Tracking number"
                value={trackingById[shipment.id] ?? shipment.trackingNumber ?? ""}
                onChange={(event) =>
                  setTrackingById((prev) => ({ ...prev, [shipment.id]: event.target.value }))
                }
                disabled={busy !== null}
              />
              <input
                className="rounded border border-slate-200 px-2 py-1"
                placeholder="Carrier (optional)"
                value={carrierById[shipment.id] ?? shipment.carrierFinal ?? ""}
                onChange={(event) =>
                  setCarrierById((prev) => ({ ...prev, [shipment.id]: event.target.value }))
                }
                disabled={busy !== null}
              />
              <button
                className="rounded-full bg-[#55b3f3] px-3 py-1 text-xs font-semibold text-slate-950 disabled:opacity-50"
                onClick={() => submitTracking(shipment.id)}
                disabled={busy !== null}
              >
                {busy === `track-${shipment.id}` ? "Saving…" : "Confirm tracking + send DELR"}
              </button>
              <button
                className="rounded-full bg-slate-900 px-3 py-1 text-xs font-semibold text-white disabled:opacity-50"
                onClick={() => fulfillShipment(shipment.id)}
                disabled={busy !== null}
              >
                {busy === `fulfill-${shipment.id}` ? "Working…" : "Fulfill + generate labels"}
              </button>
              {shipment.labelPdfUrl && (
                <a
                  className="rounded-full border border-slate-200 px-3 py-1"
                  href={shipment.labelPdfUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  SSCC Label
                </a>
              )}
              {shipment.deliveryNotePdfUrl && (
                <a
                  className="rounded-full border border-slate-200 px-3 py-1"
                  href={shipment.deliveryNotePdfUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Delivery Note
                </a>
              )}
              {shipment.shippingLabelPdfUrl && (
                <a
                  className="rounded-full border border-slate-200 px-3 py-1"
                  href={shipment.shippingLabelPdfUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Shipping Label
                </a>
              )}
            </div>
            <div className="overflow-auto rounded border border-slate-200">
              <table className="min-w-full text-xs">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-2 py-1 text-left">Supplier PID</th>
                    <th className="px-2 py-1 text-left">GTIN</th>
                    <th className="px-2 py-1 text-right">Qty</th>
                  </tr>
                </thead>
                <tbody>
                  {shipment.items.map((item) => (
                    <tr key={item.id} className="border-t">
                      <td className="px-2 py-1">{item.supplierPid}</td>
                      <td className="px-2 py-1">{item.gtin14}</td>
                      <td className="px-2 py-1 text-right">{item.quantity}</td>
                    </tr>
                  ))}
                  {shipment.items.length === 0 && (
                    <tr>
                      <td className="px-2 py-2 text-slate-500" colSpan={3}>
                        No shipment items.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        ))}
        {shipments.length === 0 && (
          <div className="text-sm text-slate-500">No shipments yet.</div>
        )}
      </div>
    </div>
  );
}
