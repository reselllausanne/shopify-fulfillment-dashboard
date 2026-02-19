import React from "react";

type FetchActionsProps = {
  onFetchFirst: () => void;
  onFetchNext: () => void;
  onFetchAll: () => void;
  onFetchPricing: () => void;
  onClear: () => void;
  onExport: () => void;
  onGoatLogin: () => void;
  onGoatDebug: () => void;
  onStockxLogin: () => void;
  stockxLoginLoading: boolean;
  loading: boolean;
  isFetchingAll: boolean;
  isEnriching: boolean;
  detailsProgress: { done: number; total: number };
  ordersCount: number;
  hasNextPage: boolean;
};

export default function FetchActions({
  onFetchFirst,
  onFetchNext,
  onFetchAll,
  onFetchPricing,
  onClear,
  onExport,
  onGoatLogin,
  onGoatDebug,
  onStockxLogin,
  stockxLoginLoading,
  loading,
  isFetchingAll,
  isEnriching,
  detailsProgress,
  ordersCount,
  hasNextPage,
}: FetchActionsProps) {
  return (
    <div className="bg-white rounded-lg shadow p-6 mb-6">
      <h2 className="text-xl font-semibold mb-4">Actions</h2>
      <div className="flex flex-wrap gap-3">
        <button
          onClick={onFetchFirst}
          disabled={loading || isFetchingAll}
          className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
        >
          Fetch First Page
        </button>
        <button
          onClick={onFetchNext}
          disabled={loading || isFetchingAll || !hasNextPage}
          className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
        >
          Fetch Next Page
        </button>
        <button
          onClick={onFetchAll}
          disabled={loading || isFetchingAll || isEnriching}
          className="px-4 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
        >
          {isFetchingAll
            ? "📥 Fetching All Pages (A)..."
            : isEnriching
            ? `🔍 Enriching (B) ${detailsProgress.done}/${detailsProgress.total}...`
            : "🔍 Fetch All Pages + Details"}
        </button>
        <button
          onClick={onFetchPricing}
          disabled={loading || isFetchingAll || ordersCount === 0}
          className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
        >
          Fetch All Pricing
        </button>
        <button
          onClick={onClear}
          disabled={loading || isFetchingAll}
          className="px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
        >
          Clear Results
        </button>
        <button
          onClick={onExport}
          disabled={loading || isFetchingAll || ordersCount === 0}
          className="px-4 py-2 bg-orange-600 text-white rounded-md hover:bg-orange-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
        >
          Export CSV
        </button>
        <button
          onClick={onGoatLogin}
          disabled={loading || isFetchingAll}
          className="px-4 py-2 bg-amber-600 text-white rounded-md hover:bg-amber-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
        >
          🐐 GOAT Login (Playwright)
        </button>
        <button
          onClick={onGoatDebug}
          disabled={loading || isFetchingAll}
          className="px-4 py-2 bg-amber-100 text-amber-900 rounded-md hover:bg-amber-200 disabled:bg-gray-200 disabled:cursor-not-allowed"
        >
          🐐 GOAT Debug Raw JSON
        </button>
        <button
          onClick={onStockxLogin}
          disabled={loading || isFetchingAll || stockxLoginLoading}
          className="px-4 py-2 bg-slate-700 text-white rounded-md hover:bg-slate-800 disabled:bg-gray-400 disabled:cursor-not-allowed"
        >
          {stockxLoginLoading ? "🧩 StockX Logging in..." : "🧩 StockX Login (Playwright)"}
        </button>
      </div>
    </div>
  );
}

