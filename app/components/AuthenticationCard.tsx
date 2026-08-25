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
  onBackfillAwb?: () => void;
  awbBackfillBusy?: boolean;
  awbBackfillStatus?: string | null;
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
  onBackfillAwb,
  awbBackfillBusy = false,
  awbBackfillStatus = null,
}: AuthenticationCardProps) {
  return (
    <div className="bg-white rounded-lg shadow p-6 mb-6">
      <h2 className="text-xl font-semibold mb-4">Authentication</h2>
      <div className="space-y-4">
        <div>
          <label htmlFor="stockxToken" className="block text-sm font-medium text-gray-700 mb-2">
            StockX Bearer Token
          </label>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
            <input
              id="stockxToken"
              name="stockxToken"
              type="password"
              value={stockxToken}
              onChange={(e) => onStockxTokenChange(e.target.value)}
              className="min-w-0 flex-1 px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="eyJ..."
              autoComplete="off"
            />
            {onBackfillAwb && (
              <button
                type="button"
                onClick={onBackfillAwb}
                disabled={awbBackfillBusy || !stockxToken.trim()}
                className="shrink-0 rounded-md bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50"
                title="Save token on server + fill missing StockX AWBs for warehouse scan"
              >
                {awbBackfillBusy ? "Backfilling…" : "Backfill AWB"}
              </button>
            )}
          </div>
          <p className="mt-1 text-xs text-gray-500">
            Paste token → click <strong>Backfill AWB</strong> (or wait ~2s: auto once/day). Writes
            server token for hourly cron + fills missing AWBs.
          </p>
          {awbBackfillStatus && (
            <p
              className={`mt-1 text-xs ${
                awbBackfillStatus.toLowerCase().includes("fail") ||
                awbBackfillStatus.toLowerCase().includes("error")
                  ? "text-red-700"
                  : "text-emerald-800"
              }`}
            >
              {awbBackfillStatus}
            </p>
          )}
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
            Save GOAT credentials locally (localStorage)
          </label>
        </div>
        <p className="text-xs text-gray-500">
          StockX token is always saved locally; Playwright login auto-refreshes this field, and manual
          rotation stays available.
        </p>
      </div>
    </div>
  );
}
