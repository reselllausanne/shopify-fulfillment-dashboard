import React from "react";

type ShopifyLineItem = {
  lineItemId: string;
  orderName: string;
  sku?: string | null;
};

type Props = {
  manualShopifyOrder: string;
  manualSupplierOrder: string;
  manualMatchLoading: boolean;
  manualOverrides: Record<string, { supplierOrderNumber: string; method: string }>;
  shopifyItems: ShopifyLineItem[];
  setManualShopifyOrder: (v: string) => void;
  setManualSupplierOrder: (v: string) => void;
  handleManualMatch: () => Promise<void>;
  clearManualOverrides: () => void;
};

export default function ManualMatchingOverride({
  manualShopifyOrder,
  manualSupplierOrder,
  manualMatchLoading,
  manualOverrides,
  shopifyItems,
  setManualShopifyOrder,
  setManualSupplierOrder,
  handleManualMatch,
  clearManualOverrides,
}: Props) {
  return (
    <div className="bg-white rounded-lg shadow p-6 mt-6">
      <h2 className="text-xl font-semibold mb-4">🔧 Manual Matching Override</h2>
      <p className="text-sm text-gray-600 mb-4">
        Force a match between a specific Shopify order and Supplier order.
        This will override any automatic matching suggestions.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
        <div>
          <label htmlFor="manualShopifyOrder" className="block text-sm font-medium text-gray-700 mb-2">
            Shopify Order Number
          </label>
          <input
            id="manualShopifyOrder"
            name="manualShopifyOrder"
            type="text"
            value={manualShopifyOrder}
            onChange={(e) => setManualShopifyOrder(e.target.value)}
            placeholder="#4654"
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
          />
        </div>
        <div>
          <label htmlFor="manualSupplierOrder" className="block text-sm font-medium text-gray-700 mb-2">
            Supplier Order Number
          </label>
          <input
            id="manualSupplierOrder"
            name="manualSupplierOrder"
            type="text"
            value={manualSupplierOrder}
            onChange={(e) => setManualSupplierOrder(e.target.value)}
            placeholder="03-XXXXXXXXXX"
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
          />
        </div>
        <div>
          <button
            onClick={handleManualMatch}
            disabled={!manualShopifyOrder.trim() || !manualSupplierOrder.trim() || manualMatchLoading}
            className="w-full px-4 py-2 bg-orange-600 text-white rounded-md hover:bg-orange-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
          >
            {manualMatchLoading ? "Fetching Shopify order..." : "Match Manually"}
          </button>
        </div>
      </div>
      {Object.keys(manualOverrides).length > 0 && (
        <div className="mt-4 p-3 bg-orange-50 border border-orange-200 rounded">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-semibold text-orange-800">
              Manual Overrides Active: {Object.keys(manualOverrides).length}
            </p>
            <button
              onClick={clearManualOverrides}
              className="text-xs px-2 py-1 bg-red-100 text-red-700 rounded hover:bg-red-200 font-semibold"
            >
              🗑️ Clear All
            </button>
          </div>
          <div className="mt-2 space-y-1">
            {shopifyItems
              .filter((item) => manualOverrides[item.lineItemId])
              .map((item) => (
                <p key={item.lineItemId} className="text-xs text-orange-700">
                  {item.orderName} → {manualOverrides[item.lineItemId].supplierOrderNumber}
                </p>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}

