"use client";

import { useState, useEffect } from "react";
import { formatMoneyCHF } from "@/app/utils/numbers";

export default function MonthlyVariableCostsManager() {
  const [records, setRecords] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({
    year: new Date().getFullYear(),
    month: new Date().getMonth() + 1,
    postageShippingCostChf: "",
    fulfillmentCostChf: "",
    notes: "",
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchRecords();
  }, []);

  const fetchRecords = async () => {
    try {
      setLoading(true);
      const currentYear = new Date().getFullYear();
      const response = await fetch(`/api/variable-costs?year=${currentYear}`);
      const data = await response.json();
      if (data.success) {
        setRecords(data.records);
      }
    } catch (error) {
      console.error("Failed to fetch variable costs:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);

    try {
      const response = await fetch("/api/variable-costs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          year: parseInt(formData.year.toString()),
          month: parseInt(formData.month.toString()),
          postageShippingCostChf: parseFloat(formData.postageShippingCostChf || "0"),
          fulfillmentCostChf: parseFloat(formData.fulfillmentCostChf || "0"),
          notes: formData.notes,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to save");
      }

      setFormData({
        year: new Date().getFullYear(),
        month: new Date().getMonth() + 1,
        postageShippingCostChf: "",
        fulfillmentCostChf: "",
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

  const handleDelete = async (monthKey: string) => {
    if (!confirm(`Delete variable costs for ${monthKey}?`)) return;

    try {
      const response = await fetch(`/api/variable-costs?monthKey=${monthKey}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        throw new Error("Failed to delete");
      }

      fetchRecords();
    } catch (error: any) {
      alert(`Error: ${error.message}`);
    }
  };

  const months = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
  ];

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">📦 Monthly Variable Costs (Accounting)</h2>
          <p className="text-sm text-gray-500">Real invoice totals: Frais d'expédition / Poste + Frais de fulfillment / logistique</p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="px-4 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700 font-medium text-sm"
        >
          {showForm ? "Cancel" : "+ Add Month"}
        </button>
      </div>

      {/* Form */}
      {showForm && (
        <form onSubmit={handleSubmit} className="mb-6 p-4 bg-purple-50 rounded-lg border border-purple-200">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Year</label>
              <input
                type="number"
                value={formData.year}
                onChange={(e) => setFormData({ ...formData, year: parseInt(e.target.value) })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                min="2020"
                max="2100"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Month</label>
              <select
                value={formData.month}
                onChange={(e) => setFormData({ ...formData, month: parseInt(e.target.value) })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                required
              >
                {months.map((m, i) => (
                  <option key={i} value={i + 1}>{m}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                📮 Frais d'expédition / Poste (CHF)
              </label>
              <p className="text-xs text-gray-500 mb-1">Real invoice total: shipping labels, postage, returns</p>
              <input
                type="number"
                step="0.01"
                value={formData.postageShippingCostChf}
                onChange={(e) => setFormData({ ...formData, postageShippingCostChf: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                placeholder="0.00"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                📦 Frais de fulfillment / logistique (CHF)
              </label>
              <p className="text-xs text-gray-500 mb-1">Real invoice total: pick&pack, handling, storage</p>
              <input
                type="number"
                step="0.01"
                value={formData.fulfillmentCostChf}
                onChange={(e) => setFormData({ ...formData, fulfillmentCostChf: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                placeholder="0.00"
                required
              />
            </div>
          </div>

          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">Notes (optional)</label>
            <textarea
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
              rows={2}
              placeholder="Invoice references, details..."
            />
          </div>

          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:bg-gray-400 font-medium text-sm"
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </form>
      )}

      {/* Records Table */}
      {loading ? (
        <p className="text-gray-500 text-sm">Loading...</p>
      ) : records.length === 0 ? (
        <p className="text-gray-500 text-sm">No variable costs recorded yet</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Month</th>
                <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Postage/Shipping</th>
                <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Fulfillment</th>
                <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Total</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Notes</th>
                <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {records.map((record) => (
                <tr key={record.monthKey} className="hover:bg-gray-50">
                  <td className="px-4 py-3 whitespace-nowrap text-sm font-medium text-gray-900">
                    {record.monthKey}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-sm text-right text-orange-600">
                    CHF {record.postageShippingCostChf.toFixed(2)}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-sm text-right text-purple-600">
                    CHF {record.fulfillmentCostChf.toFixed(2)}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-sm text-right font-bold text-gray-900">
                    CHF {record.totalCostChf.toFixed(2)}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600 max-w-xs truncate">
                    {record.notes || "—"}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-center">
                    <button
                      onClick={() => handleDelete(record.monthKey)}
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

