import React from "react";

type QueryControlsProps = {
  persistedQueryHash: string;
  onPersistedQueryHashChange: (value: string) => void;
};

export default function QueryControls({
  persistedQueryHash,
  onPersistedQueryHashChange,
}: QueryControlsProps) {
  return (
    <div className="bg-white rounded-lg shadow p-6 mb-6">
      <h2 className="text-xl font-semibold mb-4">StockX Query Hash</h2>
      <div className="space-y-4">
        <div>
          <label htmlFor="persistedQueryHash" className="block text-sm font-medium text-gray-700 mb-2">
            Persisted Query Hash
          </label>
          <input
            id="persistedQueryHash"
            name="persistedQueryHash"
            type="text"
            value={persistedQueryHash}
            onChange={(e) => onPersistedQueryHashChange(e.target.value)}
            placeholder="sha256 hash from extensions.persistedQuery.sha256Hash"
            className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-mono text-sm"
            autoComplete="off"
          />
          <p className="mt-1 text-xs text-gray-500">
            Advanced query/variables fields hidden to avoid accidental breakage.
          </p>
        </div>
      </div>
    </div>
  );
}

