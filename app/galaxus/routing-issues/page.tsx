"use client";

import { useEffect, useState } from "react";

type RoutingIssue = {
  id: string;
  orderId?: string | null;
  orderLineId: string;
  galaxusOrderId?: string | null;
  gtin?: string | null;
  providerKey?: string | null;
  status: string;
  rule?: string | null;
  updatedAt: string;
};

export default function RoutingIssuesPage() {
  const [items, setItems] = useState<RoutingIssue[]>([]);
  const [statusFilter, setStatusFilter] = useState("UNASSIGNED");
  const [providerFilter, setProviderFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setBusy(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.set("status", statusFilter);
      if (providerFilter) params.set("providerKey", providerFilter);
      const res = await fetch(`/api/galaxus/routing-issues?${params.toString()}`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Load failed");
      setItems(data.items ?? []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Routing Issues</h1>
        <p className="text-sm text-gray-500">Lines without an assigned providerKey.</p>
      </div>

      {error && <div className="text-sm text-red-600">{error}</div>}

      <div className="flex flex-wrap items-center gap-2">
        <input
          className="px-2 py-2 border rounded text-sm w-40"
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value)}
          placeholder="Status"
        />
        <input
          className="px-2 py-2 border rounded text-sm w-40"
          value={providerFilter}
          onChange={(event) => setProviderFilter(event.target.value)}
          placeholder="ProviderKey"
        />
        <button className="px-3 py-2 rounded bg-gray-200" onClick={load} disabled={busy}>
          {busy ? "Loading…" : "Apply"}
        </button>
      </div>

      <div className="overflow-auto border rounded bg-white">
        <table className="min-w-full text-xs">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-2 py-1 text-left">Status</th>
              <th className="px-2 py-1 text-left">ProviderKey</th>
              <th className="px-2 py-1 text-left">GTIN</th>
              <th className="px-2 py-1 text-left">Rule</th>
              <th className="px-2 py-1 text-left">OrderLine</th>
              <th className="px-2 py-1 text-left">Order</th>
              <th className="px-2 py-1 text-left">Updated</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id} className="border-t">
                <td className="px-2 py-1">{item.status}</td>
                <td className="px-2 py-1">{item.providerKey ?? ""}</td>
                <td className="px-2 py-1">{item.gtin ?? ""}</td>
                <td className="px-2 py-1">{item.rule ?? ""}</td>
                <td className="px-2 py-1">{item.orderLineId}</td>
                <td className="px-2 py-1">{item.galaxusOrderId ?? item.orderId ?? ""}</td>
                <td className="px-2 py-1">
                  {item.updatedAt ? new Date(item.updatedAt).toLocaleString() : ""}
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td className="px-2 py-3 text-gray-500" colSpan={7}>
                  No routing issues found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
