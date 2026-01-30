"use client";

import { useState, useEffect } from "react";
import { formatMoneyCHF } from "@/app/utils/numbers";
import { getJson, postJson, delJson } from "@/app/lib/api";

type AdsSpendRecord = {
  date: string;
  amountChf: number;
  channel: string;
  notes?: string | null;
};

export default function AdsSpendManager() {
  const [records, setRecords] = useState<AdsSpendRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({
    date: new Date().toISOString().split('T')[0],
    amountChf: "",
    channel: "google",
    notes: "",
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchRecords();
  }, []);

  const fetchRecords = async () => {
    try {
      setLoading(true);
      const response = await getJson<{ success: boolean; records: AdsSpendRecord[] }>(`/api/ads-spend?from=${getMonthStart()}`);
      if (response.ok && response.data?.success) {
        setRecords(response.data.records);
      }
    } catch (error) {
      console.error("Failed to fetch ads spend:", error);
    } finally {
      setLoading(false);
    }
  };

  const getMonthStart = () => {
    const date = new Date();
    date.setDate(1);
    return date.toISOString().split('T')[0];
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);

    try {
      const response = await postJson<any>("/api/ads-spend", {
        ...formData,
        amountChf: parseFloat(formData.amountChf),
      });

      if (!response.ok) {
        throw new Error(response.data?.error || "Failed to save");
      }

      setFormData({
        date: new Date().toISOString().split('T')[0],
        amountChf: "",
        channel: "google",
        notes: "",
      });
      setShowForm(false);
      fetchRecords();
    } catch (error: any) {
      alert(`Error: ${error.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (date: string) => {
    if (!confirm(`Delete ads spend for ${date}?`)) return;

    try {
      const response = await delJson<any>(`/api/ads-spend?date=${date}`);
      if (!response.ok) {
        throw new Error(response.data?.error || "Failed to delete");
      }

      fetchRecords();
    } catch (error: any) {
      alert(`Error: ${error.message}`);
    }
  };

  const totalSpend = records.reduce((sum, r) => sum + r.amountChf, 0);

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">📢 Daily Ads Spend</h2>
          <p className="text-sm text-gray-500">Manual advertising spend tracking</p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 font-medium text-sm"
        >
          {showForm ? "Cancel" : "+ Add Spend"}
        </button>
      </div>

      {/* Form */}
      {showForm && (
        <form onSubmit={handleSubmit} className="mb-6 p-4 bg-gray-50 rounded-lg border border-gray-200">
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
                placeholder="Optional..."
              />
            </div>
          </div>
          <div className="mt-3">
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:bg-gray-400 font-medium text-sm"
            >
              {saving ? "Saving..." : "Save"}
            </button>
          </div>
        </form>
      )}

      {/* Summary */}
      <div className="mb-4 p-3 bg-blue-50 rounded-lg">
        <div className="flex justify-between items-center">
          <span className="text-sm font-medium text-gray-700">Current Month Total:</span>
          <span className="text-lg font-bold text-blue-600">{formatMoneyCHF(totalSpend)}</span>
        </div>
      </div>

      {/* Records Table */}
      {loading ? (
        <p className="text-gray-500 text-sm">Loading...</p>
      ) : records.length === 0 ? (
        <p className="text-gray-500 text-sm">No ads spend recorded for this month</p>
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
                    {new Date(record.date).toLocaleDateString('de-CH')}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-sm text-right font-medium text-blue-600">
                    CHF {record.amountChf.toFixed(2)}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-700">
                    {record.channel}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">
                    {record.notes || "—"}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-center">
                    <button
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

