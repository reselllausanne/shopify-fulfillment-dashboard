"use client";

import React, { useState } from "react";

interface ManualSupplierModalProps {
  isOpen: boolean;
  onClose: () => void;
  shopifyItem: {
    orderId: string;
    orderName: string;
    lineItemId: string;
    title: string;
    sku?: string;
    sizeEU?: string;
    price: number;
    currencyCode: string;
  };
  onSave: (data: ManualSupplierData) => Promise<void>;
}

export interface ManualSupplierData {
  supplierOrderRef: string;
  supplierCost: number;
  supplierPurchaseDate: string;
  estimatedDeliveryDate?: string;
  notes?: string;
}

export default function ManualSupplierModal({
  isOpen,
  onClose,
  shopifyItem,
  onSave,
}: ManualSupplierModalProps) {
  const [formData, setFormData] = useState<ManualSupplierData>({
    supplierOrderRef: "",
    supplierCost: 0,
    supplierPurchaseDate: new Date().toISOString().split("T")[0],
    estimatedDeliveryDate: "",
    notes: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!formData.supplierOrderRef || formData.supplierCost <= 0) {
      setError("Supplier reference and cost are required");
      return;
    }

    setSaving(true);
    try {
      await onSave(formData);
      // Reset form
      setFormData({
        supplierOrderRef: "",
        supplierCost: 0,
        supplierPurchaseDate: new Date().toISOString().split("T")[0],
        estimatedDeliveryDate: "",
        notes: "",
      });
      onClose();
    } catch (err: any) {
      setError(err.message || "Failed to save manual supplier");
    } finally {
      setSaving(false);
    }
  };

  const handleClose = () => {
    if (!saving) {
      setError(null);
      onClose();
    }
  };

  // Calculate margin
  const revenue = shopifyItem.price;
  const margin = revenue - formData.supplierCost;
  const marginPct = revenue > 0 ? (margin / revenue) * 100 : 0;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-indigo-600 text-white px-6 py-4 rounded-t-lg">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold">Manual Supplier Entry</h2>
            <button
              onClick={handleClose}
              disabled={saving}
              className="text-white hover:text-gray-200 text-2xl leading-none disabled:opacity-50"
              aria-label="Close"
            >
              ×
            </button>
          </div>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="p-6">
          {/* Shopify Order Info */}
          <div className="mb-6 p-4 bg-gray-50 rounded-lg">
            <h3 className="font-semibold text-sm text-gray-700 mb-2">
              📦 Shopify Order: {shopifyItem.orderName}
            </h3>
            <div className="text-xs space-y-1 text-gray-600">
              <p><span className="font-medium">Product:</span> {shopifyItem.title}</p>
              <p><span className="font-medium">SKU:</span> {shopifyItem.sku || "—"}</p>
              <p><span className="font-medium">Size:</span> {shopifyItem.sizeEU || "—"}</p>
              <p>
                <span className="font-medium">Revenue:</span>{" "}
                {shopifyItem.currencyCode} {revenue.toFixed(2)}
              </p>
            </div>
          </div>

          {/* Form Fields */}
          <div className="space-y-4">
            {/* Supplier Reference */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Supplier Reference <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={formData.supplierOrderRef}
                onChange={(e) =>
                  setFormData({ ...formData, supplierOrderRef: e.target.value })
                }
                placeholder="e.g., Friend: Alex, Local Stock, Manual-001"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                required
                disabled={saving}
              />
              <p className="text-xs text-gray-500 mt-1">
                Enter a reference for this purchase (friend's name, local stock, etc.)
              </p>
            </div>

            {/* Supplier Cost */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Supplier Cost (CHF) <span className="text-red-500">*</span>
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={formData.supplierCost}
                onChange={(e) =>
                  setFormData({ ...formData, supplierCost: parseFloat(e.target.value) || 0 })
                }
                placeholder="0.00"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                required
                disabled={saving}
              />
            </div>

            {/* Purchase Date */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Purchase Date <span className="text-red-500">*</span>
              </label>
              <input
                type="date"
                value={formData.supplierPurchaseDate}
                onChange={(e) =>
                  setFormData({ ...formData, supplierPurchaseDate: e.target.value })
                }
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                required
                disabled={saving}
              />
            </div>

            {/* Estimated Delivery Date */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Estimated Delivery Date (Optional)
              </label>
              <input
                type="date"
                value={formData.estimatedDeliveryDate}
                onChange={(e) =>
                  setFormData({ ...formData, estimatedDeliveryDate: e.target.value })
                }
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                disabled={saving}
              />
            </div>

            {/* Notes */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Notes (Optional)
              </label>
              <textarea
                value={formData.notes}
                onChange={(e) =>
                  setFormData({ ...formData, notes: e.target.value })
                }
                placeholder="Additional notes about this purchase..."
                rows={3}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                disabled={saving}
              />
            </div>
          </div>

          {/* Margin Preview */}
          {formData.supplierCost > 0 && (
            <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
              <h4 className="font-semibold text-sm text-blue-900 mb-2">Margin Preview</h4>
              <div className="text-sm space-y-1 text-blue-800">
                <p>
                  <span className="font-medium">Revenue:</span> CHF {revenue.toFixed(2)}
                </p>
                <p>
                  <span className="font-medium">Cost:</span> CHF {formData.supplierCost.toFixed(2)}
                </p>
                <p>
                  <span className="font-medium">Margin:</span>{" "}
                  <span className={margin >= 0 ? "text-green-700 font-semibold" : "text-red-700 font-semibold"}>
                    CHF {margin.toFixed(2)} ({marginPct.toFixed(1)}%)
                  </span>
                </p>
              </div>
            </div>
          )}

          {/* Error Message */}
          {error && (
            <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-md">
              <p className="text-sm text-red-800">{error}</p>
            </div>
          )}

          {/* Footer Buttons */}
          <div className="mt-6 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={handleClose}
              disabled={saving}
              className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? "Saving..." : "Save Manual Supplier"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

