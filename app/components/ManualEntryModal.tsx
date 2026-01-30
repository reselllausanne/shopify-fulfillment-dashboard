import React, { useEffect, useState } from "react";

type ManualEntryModalProps = {
  isOpen: boolean;
  mode: "create" | "edit";
  initialData: any;
  shopifyItem?: any | null;
  onSave: (data: any, mode: "create" | "edit") => void;
  onClose: () => void;
};

export default function ManualEntryModal({
  isOpen,
  mode,
  initialData,
  shopifyItem,
  onSave,
  onClose,
}: ManualEntryModalProps) {
  const [localData, setLocalData] = useState<any>(initialData);

  // Sync when opening
  useEffect(() => {
    if (isOpen) {
      setLocalData(initialData);
    }
  }, [isOpen, initialData]);

  if (!isOpen) return null;

  const update = (patch: Partial<any>) => setLocalData((prev: any) => ({ ...prev, ...patch }));

  const numericInput = (key: string) => ({
    value: localData[key] ?? "",
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => update({ [key]: e.target.value }),
    type: "number",
    className: "w-full px-3 py-2 border rounded focus:ring-2 focus:ring-blue-500",
  });

  return (
    <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b px-6 py-4 flex justify-between items-center">
          <h2 className="text-xl font-bold">
            {mode === "edit" ? "✏️ Edit Manual Entry" : "📝 Create Manual Entry"}
          </h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 text-2xl leading-none"
          >
            ×
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* Shopify (read-only) */}
          <div className="bg-blue-50 p-4 rounded-lg">
            <h3 className="font-semibold text-blue-900 mb-2">📦 Shopify (read-only)</h3>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div>
                <span className="font-medium">Order:</span>{" "}
                {localData.shopifyOrderName || shopifyItem?.orderName || "N/A"}
              </div>
              <div>
                <span className="font-medium">Revenue:</span>{" "}
                {localData.shopifyTotalPrice != null
                  ? `CHF ${Number(localData.shopifyTotalPrice).toFixed(2)}`
                  : "N/A"}
              </div>
              <div className="col-span-2">
                <span className="font-medium">Product:</span>{" "}
                {localData.shopifyProductTitle || shopifyItem?.title || "N/A"}
              </div>
              <div>
                <span className="font-medium">SKU:</span>{" "}
                {localData.shopifySku || "N/A"}
              </div>
              <div>
                <span className="font-medium">Size:</span>{" "}
                {localData.shopifySizeEU || "N/A"}
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-medium text-gray-700">Shopify Created At</label>
                <input
                  type="date"
                  value={
                    localData.shopifyCreatedAt
                      ? new Date(localData.shopifyCreatedAt).toISOString().split("T")[0]
                      : ""
                  }
                  onChange={(e) => update({ shopifyCreatedAt: e.target.value })}
                  className="w-full px-3 py-2 border rounded focus:ring-2 focus:ring-blue-500 text-sm"
                />
              </div>
            </div>
          </div>

          {/* Supplier order info */}
          <div className="space-y-3">
            <h3 className="font-semibold text-gray-900">🏪 Supplier</h3>
            <div className="grid grid-cols-2 gap-3">
              <input
                type="text"
                value={localData.stockxOrderNumber || ""}
                onChange={(e) => update({ stockxOrderNumber: e.target.value })}
                placeholder="Supplier Order Number"
                className="w-full px-3 py-2 border rounded focus:ring-2 focus:ring-blue-500"
              />
              <input
                type="text"
                value={localData.stockxProductName || ""}
                onChange={(e) => update({ stockxProductName: e.target.value })}
                placeholder="Product Name"
                className="w-full px-3 py-2 border rounded focus:ring-2 focus:ring-blue-500"
              />
              <input
                type="text"
                value={localData.stockxSkuKey || ""}
                onChange={(e) => update({ stockxSkuKey: e.target.value })}
                placeholder="SKU Key"
                className="w-full px-3 py-2 border rounded focus:ring-2 focus:ring-blue-500"
              />
              <input
                type="text"
                value={localData.stockxSizeEU || ""}
                onChange={(e) => update({ stockxSizeEU: e.target.value })}
                placeholder="Size EU"
                className="w-full px-3 py-2 border rounded focus:ring-2 focus:ring-blue-500"
              />
              <input
                type="text"
                value={localData.stockxChainId || ""}
                onChange={(e) => update({ stockxChainId: e.target.value })}
                placeholder="Chain ID (optional)"
                className="w-full px-3 py-2 border rounded focus:ring-2 focus:ring-blue-500"
              />
              <input
                type="text"
                value={localData.stockxOrderId || ""}
                onChange={(e) => update({ stockxOrderId: e.target.value })}
                placeholder="Order ID (optional)"
                className="w-full px-3 py-2 border rounded focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <input
                type="text"
                value={localData.stockxCheckoutType || ""}
                onChange={(e) => update({ stockxCheckoutType: e.target.value })}
                placeholder="Checkout Type (e.g., EXPRESS_STANDARD)"
                className="w-full px-3 py-2 border rounded focus:ring-2 focus:ring-blue-500"
              />
              <input
                type="text"
                value={localData.stockxStatus || "MANUAL"}
                onChange={(e) => update({ stockxStatus: e.target.value })}
                placeholder="StockX Status"
                className="w-full px-3 py-2 border rounded focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div className="grid grid-cols-3 gap-3">
              <input
                type="datetime-local"
                value={
                  localData.stockxPurchaseDate
                    ? new Date(localData.stockxPurchaseDate).toISOString().slice(0, 16)
                    : ""
                }
                onChange={(e) => update({ stockxPurchaseDate: e.target.value })}
                className="w-full px-3 py-2 border rounded focus:ring-2 focus:ring-blue-500"
              />
              <input
                type="date"
                value={
                  localData.stockxEstimatedDelivery
                    ? new Date(localData.stockxEstimatedDelivery).toISOString().split("T")[0]
                    : ""
                }
                onChange={(e) => update({ stockxEstimatedDelivery: e.target.value })}
                className="w-full px-3 py-2 border rounded focus:ring-2 focus:ring-blue-500"
              />
              <input
                type="date"
                value={
                  localData.stockxLatestEstimatedDelivery
                    ? new Date(localData.stockxLatestEstimatedDelivery).toISOString().split("T")[0]
                    : ""
                }
                onChange={(e) => update({ stockxLatestEstimatedDelivery: e.target.value })}
                className="w-full px-3 py-2 border rounded focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <input
                type="text"
                value={localData.stockxAwb || ""}
                onChange={(e) => update({ stockxAwb: e.target.value })}
                placeholder="AWB / Tracking number"
                className="w-full px-3 py-2 border rounded focus:ring-2 focus:ring-blue-500"
              />
              <input
                type="url"
                value={localData.stockxTrackingUrl || ""}
                onChange={(e) => update({ stockxTrackingUrl: e.target.value })}
                placeholder="Tracking URL"
                className="w-full px-3 py-2 border rounded focus:ring-2 focus:ring-blue-500"
              />
              <textarea
                value={
                  typeof localData.stockxStates === "string"
                    ? localData.stockxStates
                    : localData.stockxStates
                    ? JSON.stringify(localData.stockxStates, null, 2)
                    : ""
                }
                onChange={(e) => update({ stockxStates: e.target.value })}
                placeholder="StockX states (JSON array)"
                rows={4}
                className="w-full px-3 py-2 border rounded focus:ring-2 focus:ring-blue-500 col-span-2 font-mono text-xs"
              />
            </div>
          </div>

          {/* Matching */}
          <div className="space-y-3">
            <h3 className="font-semibold text-gray-900">🧠 Matching</h3>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <input
                type="text"
                value={localData.matchType || ""}
                onChange={(e) => update({ matchType: e.target.value })}
                placeholder="Match Type"
                className="w-full px-3 py-2 border rounded focus:ring-2 focus:ring-blue-500"
              />
              <select
                value={localData.matchConfidence || "MANUAL"}
                onChange={(e) => update({ matchConfidence: e.target.value })}
                className="w-full px-3 py-2 border rounded focus:ring-2 focus:ring-blue-500"
              >
                <option value="HIGH">HIGH</option>
                <option value="MEDIUM">MEDIUM</option>
                <option value="LOW">LOW</option>
                <option value="MANUAL">MANUAL</option>
              </select>
              <input
                {...numericInput("matchScore")}
                placeholder="Match Score"
              />
            </div>
            <textarea
              value={Array.isArray(localData.matchReasons) ? localData.matchReasons.join(", ") : localData.matchReasons || ""}
              onChange={(e) => update({ matchReasons: e.target.value })}
              rows={2}
              className="w-full px-3 py-2 border rounded focus:ring-2 focus:ring-blue-500"
              placeholder="Match reasons (comma-separated)"
            />
          </div>

          {/* Financials */}
          <div className="space-y-3">
            <h3 className="font-semibold text-gray-900">💰 Financials</h3>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <input {...numericInput("supplierCost")} placeholder="Supplier Cost" />
              <input {...numericInput("manualCostOverride")} placeholder="Manual Cost Override" />
              <input {...numericInput("marginAmount")} placeholder="Margin Amount" />
              <input {...numericInput("marginPercent")} placeholder="Margin Percent" />
              <input {...numericInput("timeDiffHours")} placeholder="Time Diff Hours" />
              <input {...numericInput("manualRevenueAdjustment")} placeholder="Revenue Adjustment (CHF)" />
            </div>
          </div>

          {/* Notes */}
          <div className="space-y-2">
            <h3 className="font-semibold text-gray-900">📝 Notes</h3>
            <textarea
              value={localData.manualNote || ""}
              onChange={(e) => update({ manualNote: e.target.value })}
              rows={3}
              className="w-full px-3 py-2 border rounded focus:ring-2 focus:ring-blue-500"
              placeholder="Any additional notes..."
            />
          </div>
        </div>

        <div className="px-6 py-4 border-t flex justify-end gap-3 bg-gray-50">
          <button
            onClick={onClose}
            className="px-6 py-2 bg-gray-200 text-gray-800 rounded hover:bg-gray-300"
          >
            Cancel
          </button>
          <button
            onClick={() => onSave(localData, mode)}
            className="px-6 py-2 bg-green-600 text-white rounded hover:bg-green-700"
          >
            {mode === "edit" ? "💾 Update Entry (Partial)" : "✅ Save Manual Entry"}
          </button>
        </div>
      </div>
    </div>
  );
}

