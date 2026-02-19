import React from "react";

type AuthenticationCardProps = {
  stockxToken: string;
  onStockxTokenChange: (value: string) => void;
  goatCookie: string;
  onGoatCookieChange: (value: string) => void;
  goatCsrfToken: string;
  onGoatCsrfTokenChange: (value: string) => void;
  saveToken: boolean;
  onSaveTokenToggle: (value: boolean) => void;
};

export default function AuthenticationCard({
  stockxToken,
  onStockxTokenChange,
  goatCookie,
  onGoatCookieChange,
  goatCsrfToken,
  onGoatCsrfTokenChange,
  saveToken,
  onSaveTokenToggle,
}: AuthenticationCardProps) {
  return (
    <div className="bg-white rounded-lg shadow p-6 mb-6">
      <h2 className="text-xl font-semibold mb-4">Authentication</h2>
      <div className="space-y-4">
        <div>
          <label htmlFor="stockxToken" className="block text-sm font-medium text-gray-700 mb-2">
            StockX Bearer Token
          </label>
          <input
            id="stockxToken"
            name="stockxToken"
            type="password"
            value={stockxToken}
            onChange={(e) => onStockxTokenChange(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            placeholder="eyJ..."
            autoComplete="off"
          />
        </div>
        <div>
          <label htmlFor="goatCookie" className="block text-sm font-medium text-gray-700 mb-2">
            GOAT Cookie Header
          </label>
          <textarea
            id="goatCookie"
            name="goatCookie"
            value={goatCookie}
            onChange={(e) => onGoatCookieChange(e.target.value)}
            rows={4}
            className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-mono text-xs"
            placeholder="OptanonAlertBoxClosed=...; _sneakers_session=...; csrf=..."
          />
          <p className="mt-1 text-xs text-gray-500">
            Leave empty to use Playwright login flow (local only).
          </p>
        </div>
        <div>
          <label htmlFor="goatCsrfToken" className="block text-sm font-medium text-gray-700 mb-2">
            GOAT X-CSRF-Token
          </label>
          <input
            id="goatCsrfToken"
            name="goatCsrfToken"
            type="text"
            value={goatCsrfToken}
            onChange={(e) => onGoatCsrfTokenChange(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            placeholder="Tlg5RHmn-_cdxe0K-4RTxgiz86LHrz55pvfA"
            autoComplete="off"
          />
        </div>
        <div className="flex items-center">
          <input
            type="checkbox"
            id="saveToken"
            name="saveToken"
            checked={saveToken}
            onChange={(e) => onSaveTokenToggle(e.target.checked)}
            className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
          />
          <label htmlFor="saveToken" className="ml-2 block text-sm text-gray-700">
            Save credentials locally (localStorage)
          </label>
        </div>
      </div>
    </div>
  );
}

