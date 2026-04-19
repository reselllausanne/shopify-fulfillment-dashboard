"use client";

import { useState, useEffect, useMemo } from "react";
import { formatMoneyCHF } from "@/app/utils/numbers";
import { getJson, postJson, delJson } from "@/app/lib/api";

type AdsSpendRecord = {
  date: string;
  amountChf: number;
  channel: string;
  notes?: string | null;
};

function monthPresets(): { label: string; from: string; to: string }[] {
  const out: { label: string; from: string; to: string }[] = [];
  const now = new Date();
  for (let i = 0; i < 24; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth();
    const from = new Date(Date.UTC(y, m, 1)).toISOString().split("T")[0];
    const to = new Date(Date.UTC(y, m + 1, 0)).toISOString().split("T")[0];
    const label = `${y}-${String(m + 1).padStart(2, "0")}`;
    out.push({ label, from, to });
  }
  return out;
}

const defaultRange = () => {
  const to = new Date().toISOString().split("T")[0];
  const fromD = new Date();
  fromD.setUTCMonth(fromD.getUTCMonth() - 12);
  const from = fromD.toISOString().split("T")[0];
  return { from, to };
};

export default function AdsSpendManager() {
  const presets = useMemo(() => monthPresets(), []);
  const initial = useMemo(() => defaultRange(), []);
  const [rangeFrom, setRangeFrom] = useState(initial.from);
  const [rangeTo, setRangeTo] = useState(initial.to);
  const [records, setRecords] = useState<AdsSpendRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingOriginalDate, setEditingOriginalDate] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    date: new Date().toISOString().split("T")[0],
    amountChf: "",
    channel: "google",
    notes: "",
  });
  const [saving, setSaving] = useState(false);

  const fetchRecords = async () => {
    try {
      setLoading(true);
      const q = new URLSearchParams({ from: rangeFrom, to: rangeTo });
      const response = await getJson<{
        success: boolean;
        records: AdsSpendRecord[];
        total?: number;
      }>(`/api/ads-spend?${q.toString()}`);
      if (response.ok && response.data?.success) {
        setRecords(response.data.records || []);
      } else {
        setRecords([]);
      }
    } catch (error) {
      console.error("Failed to fetch ads spend:", error);
      setRecords([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRecords();
  }, [rangeFrom, rangeTo]);

  const openNew = () => {
    setEditingOriginalDate(null);
    setFormData({
      date: new Date().toISOString().split("T")[0],
      amountChf: "",
      channel: "google",
      notes: "",
    });
    setShowForm(true);
  };

  const openEdit = (r: AdsSpendRecord) => {
    setEditingOriginalDate(r.date);
    setFormData({
      date: r.date,
      amountChf: String(r.amountChf),
      channel: r.channel || "google",
      notes: r.notes || "",
    });
    setShowForm(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);

    try {
      if (editingOriginalDate && editingOriginalDate !== formData.date) {
        const delRes = await delJson(`/api/ads-spend?date=${encodeURIComponent(editingOriginalDate)}`);
        if (!delRes.ok) {
          throw new Error((delRes.data as { error?: string })?.error || "Failed to remove old date");
        }
      }

      const response = await postJson<{ error?: string }>("/api/ads-spend", {
        ...formData,
        amountChf: parseFloat(formData.amountChf),
      });

      if (!response.ok) {
        throw new Error(response.data?.error || "Failed to save");
      }

      setShowForm(false);
      setEditingOriginalDate(null);
      await fetchRecords();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Error";
      alert(`Error: ${message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (date: string) => {
    if (!confirm(`Delete ads spend for ${date}?`)) return;

    try {
      const response = await delJson(`/api/ads-spend?date=${encodeURIComponent(date)}`);
      if (!response.ok) {
        throw new Error((response.data as { error?: string })?.error || "Failed to delete");
      }

      if (editingOriginalDate === date) {
        setShowForm(false);
        setEditingOriginalDate(null);
      }
      await fetchRecords();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Error";
      alert(`Error: ${message}`);
    }
  };

  const totalSpend = records.reduce((sum, r) => sum + r.amountChf, 0);

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4 mb-4">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">📢 Manual ads spend</h2>
          <p className="text-sm text-gray-500">
            One row per day in the database. Pick a range or month, then add, edit, or delete entries.
          </p>
        </div>
        <button
          onClick={() => (showForm ? setShowForm(false) : openNew())}
          className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 font-medium text-sm shrink-0"
        >
          {showForm ? "Close form" : "+ Add spend"}
        </button>
      </div>

      <div className="flex flex-wrap gap-3 items-end mb-6 p-4 bg-gray-50 rounded-lg border border-gray-200">
        <label className="text-sm text-gray-700">
          From
          <input
            type="date"
            className="ml-2 border border-gray-300 rounded-md px-2 py-1 block mt-1"
            value={rangeFrom}
            onChange={(e) => setRangeFrom(e.target.value)}
          />
        </label>
        <label className="text-sm text-gray-700">
          To
          <input
            type="date"
            className="ml-2 border border-gray-300 rounded-md px-2 py-1 block mt-1"
            value={rangeTo}
            onChange={(e) => setRangeTo(e.target.value)}
          />
        </label>
        <label className="text-sm text-gray-700">
          Quick month
          <select
            className="ml-2 border border-gray-300 rounded-md px-2 py-1 block mt-1 min-w-[8rem]"
            value=""
            onChange={(e) => {
              const v = e.target.value;
              if (!v) return;
              const p = presets.find((x) => x.label === v);
              if (p) {
                setRangeFrom(p.from);
                setRangeTo(p.to);
              }
              e.target.value = "";
            }}
          >
            <option value="">Select…</option>
            {presets.map((p) => (
              <option key={p.label} value={p.label}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={fetchRecords}
          className="px-3 py-2 bg-gray-600 text-white rounded-md text-sm hover:bg-gray-700"
        >
          Refresh
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="mb-6 p-4 bg-gray-50 rounded-lg border border-gray-200">
          <p className="text-sm text-gray-600 mb-3">
            {editingOriginalDate ? `Editing entry for ${editingOriginalDate}` : "New entry"}
          </p>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Date</label>
              <input
                type="date"
                value={formData.date}
                onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Amount (CHF)</label>
              <input
                type="number"
                step="0.01"
                value={formData.amountChf}
                onChange={(e) => setFormData({ ...formData, amountChf: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                placeholder="0.00"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Channel</label>
              <select
                value={formData.channel}
                onChange={(e) => setFormData({ ...formData, channel: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
              >
                <option value="google">Google Ads</option>
                <option value="meta">Meta/Facebook</option>
                <option value="tiktok">TikTok</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
              <input
                type="text"
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                placeholder="Optional…"
              />
            </div>
          </div>
          <div className="mt-3 flex gap-2">
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:bg-gray-400 font-medium text-sm"
            >
              {saving ? "Saving…" : editingOriginalDate ? "Save changes" : "Save"}
            </button>
            <button
              type="button"
              onClick={() => {
                setShowForm(false);
                setEditingOriginalDate(null);
              }}
              className="px-4 py-2 bg-gray-200 text-gray-800 rounded-md text-sm"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      <div className="mb-4 p-3 bg-blue-50 rounded-lg">
        <div className="flex justify-between items-center">
          <span className="text-sm font-medium text-gray-700">Total in range ({records.length} days):</span>
          <span className="text-lg font-bold text-blue-600">{formatMoneyCHF(totalSpend)}</span>
        </div>
      </div>

      {loading ? (
        <p className="text-gray-500 text-sm">Loading…</p>
      ) : records.length === 0 ? (
        <p className="text-gray-500 text-sm">No ads spend in this range.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Amount</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Channel</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Notes</th>
                <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {records.map((record) => (
                <tr key={record.date} className="hover:bg-gray-50">
                  <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900">
                    {new Date(record.date + "T12:00:00.000Z").toLocaleDateString("de-CH")}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-sm text-right font-medium text-blue-600">
                    CHF {record.amountChf.toFixed(2)}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-700">{record.channel}</td>
                  <td className="px-4 py-3 text-sm text-gray-600">{record.notes || "—"}</td>
                  <td className="px-4 py-3 whitespace-nowrap text-center space-x-3">
                    <button
                      type="button"
                      onClick={() => openEdit(record)}
                      className="text-blue-600 hover:text-blue-800 text-sm font-medium"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(record.date)}
                      className="text-red-600 hover:text-red-800 text-sm font-medium"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
