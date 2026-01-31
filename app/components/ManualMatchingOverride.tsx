import React from "react";

type Props = {
  manualFetchOrder: string;
  manualFetchLoading: boolean;
  setManualFetchOrder: (v: string) => void;
  handleFetchShopifyOrder: () => Promise<void>;
};

export default function ManualMatchingOverride({
  manualFetchOrder,
  manualFetchLoading,
  setManualFetchOrder,
  handleFetchShopifyOrder,
}: Props) {
  return (
    <div className="bg-white rounded-lg shadow p-6 mt-6">
      <h2 className="text-xl font-semibold mb-4">🔍 Fetch Old Shopify Order</h2>
      <p className="text-sm text-gray-600 mb-4">
        Load a specific old Shopify order so it appears in the matching list.
        This is useful when the order is older than the default "recent" window.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
        <div className="md:col-span-2">
          <label htmlFor="manualFetchOrder" className="block text-sm font-medium text-gray-700 mb-2">
            Shopify Order Number
          </label>
          <input
            id="manualFetchOrder"
            name="manualFetchOrder"
            type="text"
            value={manualFetchOrder}
            onChange={(e) => setManualFetchOrder(e.target.value)}
            placeholder="#4654"
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
          />
        </div>
        <div>
          <button
            onClick={handleFetchShopifyOrder}
            disabled={!manualFetchOrder.trim() || manualFetchLoading}
            className="w-full px-4 py-2 bg-teal-600 text-white rounded-md hover:bg-teal-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
          >
            {manualFetchLoading ? "Fetching..." : "Fetch Shopify Order"}
          </button>
        </div>
      </div>
    </div>
  );
}

