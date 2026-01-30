import React from "react";

type QueryControlsProps = {
  query: string;
  onQueryChange: (value: string) => void;
  variables: string;
  onVariablesChange: (value: string) => void;
  stateFilter: string;
  onStateFilterChange: (value: string) => void;
};

export default function QueryControls({
  query,
  onQueryChange,
  variables,
  onVariablesChange,
  stateFilter,
  onStateFilterChange,
}: QueryControlsProps) {
  return (
    <div className="bg-white rounded-lg shadow p-6 mb-6">
      <h2 className="text-xl font-semibold mb-4">Query Configuration</h2>
      <div className="space-y-4">
        <div>
          <label htmlFor="stateFilter" className="block text-sm font-medium text-gray-700 mb-2">
            State Filter (optional - discover valid values from DevTools)
          </label>
          <input
            id="stateFilter"
            name="stateFilter"
            type="text"
            value={stateFilter}
            onChange={(e) => onStateFilterChange(e.target.value)}
            placeholder='Leave empty for "All" or enter state like "PENDING"'
            className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            autoComplete="off"
          />
          <p className="mt-1 text-xs text-gray-500">
            Empty = All states. Common: PENDING, COMPLETED. Check Network tab for valid BuyingGeneralState enum values.
          </p>
        </div>
        <div>
          <label htmlFor="graphqlQuery" className="block text-sm font-medium text-gray-700 mb-2">
            GraphQL Query
          </label>
          <textarea
            id="graphqlQuery"
            name="graphqlQuery"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-mono text-sm"
            rows={12}
          />
        </div>
        <div>
          <label htmlFor="variables" className="block text-sm font-medium text-gray-700 mb-2">
            Variables (JSON)
          </label>
          <textarea
            id="variables"
            name="variables"
            value={variables}
            onChange={(e) => onVariablesChange(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-mono text-sm"
            rows={6}
          />
        </div>
      </div>
    </div>
  );
}

