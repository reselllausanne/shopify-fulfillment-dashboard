import React from "react";
import ActionBar from "@/app/components/ActionBar";

type MatchRow = any;

type Props = {
  onLoadFromDatabase: () => Promise<void>;
  dbLoading: boolean;
  token: string;
  dbMatches: MatchRow[];
  manualOverrideExpanded: Record<string, boolean>;
  setManualOverrideExpanded: (v: Record<string, boolean>) => void;
  manualOverrideData: Record<string, { status: string; returnReason: string; returnFeePercent: string; returnedStockValue: string; adjustment: string; note: string; manualCost: string }>;
  setManualOverrideData: (v: Record<string, any>) => void;
  manualOverrideLoading: Record<string, boolean>;
  applyManualOverride: (matchId: string, match: any) => Promise<void>;
  deleteMatch: (matchId: string, orderName: string) => Promise<void>;
  toNumber: (v: any) => number;
  openManualEntryModalForEdit: (match: any) => void;
};

export default function DatabaseAutoSync({
  onLoadFromDatabase,
  dbLoading,
  token,
  dbMatches,
  manualOverrideExpanded,
  setManualOverrideExpanded,
  manualOverrideData,
  setManualOverrideData,
  manualOverrideLoading,
  applyManualOverride,
  deleteMatch,
  toNumber,
  openManualEntryModalForEdit,
}: Props) {
  const [emailLoading, setEmailLoading] = React.useState<Record<string, boolean>>({});
  const [bulkLoading, setBulkLoading] = React.useState(false);

  const sendMilestoneEmail = async (matchId: string, force: boolean) => {
    setEmailLoading((prev) => ({ ...prev, [matchId]: true }));
    try {
      const res = await fetch("/api/notifications/stockx/send-one", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ matchId, force }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json?.ok === false) {
        throw new Error(json?.error || `HTTP ${res.status}`);
      }

      if (json?.skipped) {
        alert(`⏭️ Skipped: already emailed\n\nMilestone: ${json?.milestoneKey || "unknown"}`);
        return;
      }

      alert(
        `✅ Email sent\n\n` +
          `Milestone: ${json?.milestoneKey || "unknown"}\n` +
          `To (override): ${json?.to || "unknown"}\n` +
          `Event: ${json?.eventId || "unknown"}`
      );
    } catch (err: any) {
      alert(`❌ Email failed:\n\n${err?.message || "Unknown error"}`);
    } finally {
      setEmailLoading((prev) => ({ ...prev, [matchId]: false }));
    }
  };

  const sendLimitedEmails = async (limit: number, onlyToday = false) => {
    setBulkLoading(true);
    try {
      const res = await fetch("/api/notifications/stockx/send-limited", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          limit,
          force: false,
          skipIfFulfilled: true,
          skipIfEtaPassed: true,
          onlyToday,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json?.ok === false) {
        throw new Error(json?.error || `HTTP ${res.status}`);
      }

      alert(
        `✅ Limited send complete\n\n` +
          `Attempted: ${json?.attempted || 0}\n` +
          `Sent: ${json?.sent || 0}\n` +
          `Skipped: ${json?.skipped || 0}`
      );
    } catch (err: any) {
      alert(`❌ Limited send failed:\n\n${err?.message || "Unknown error"}`);
    } finally {
      setBulkLoading(false);
    }
  };

  return (
    <div className="bg-gradient-to-r from-purple-50 to-blue-50 rounded-lg shadow-lg p-6 mt-6 border-2 border-purple-200">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-2xl font-bold text-purple-900">🤖 Database & Auto-Sync</h2>
          <p className="text-sm text-gray-600 mt-1">
            Persistent storage + background workers for automatic matching
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => sendLimitedEmails(2, true)}
            disabled={bulkLoading}
            className="px-3 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:bg-gray-400 text-xs font-semibold"
          >
            {bulkLoading ? "Sending..." : "📧 Send today (2)"}
          </button>
          <button
            onClick={() => sendLimitedEmails(1)}
            disabled={bulkLoading}
            className="px-3 py-2 bg-indigo-100 text-indigo-900 rounded-md hover:bg-indigo-200 disabled:bg-gray-100 text-xs font-semibold"
          >
            Send 1
          </button>
        </div>
      </div>

      <ActionBar
        onLoadFromDatabase={onLoadFromDatabase}
        dbLoading={dbLoading}
        token={token}
      />

      {dbMatches.length > 0 && (
        <div className="bg-white rounded-lg border border-purple-200 p-4">
          <h3 className="font-semibold text-purple-900 mb-3">
            Stored Matches ({dbMatches.length})
          </h3>
          <div className="max-h-96 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="bg-purple-50 sticky top-0">
                <tr>
                  <th className="px-3 py-2 text-left">Shopify Order</th>
                  <th className="px-3 py-2 text-left">Product</th>
                  <th className="px-3 py-2 text-left">Supplier Order</th>
                  <th className="px-3 py-2 text-left">Confidence</th>
                  <th className="px-3 py-2 text-left">Status</th>
                  <th className="px-3 py-2 text-left">Synced</th>
                  <th className="px-3 py-2 text-left">Margin</th>
                  <th className="px-3 py-2 text-left">Return Reason</th>
                  <th className="px-3 py-2 text-left">Actions</th>
                </tr>
              </thead>
              <tbody>
                {dbMatches.map((match) => {
                  const isExpanded = manualOverrideExpanded[match.id];
                  const hasOverrideData = manualOverrideData[match.id] != null;
                  const data = manualOverrideData[match.id] || {
                    status: "",
                    returnReason: "",
                    returnFeePercent: "",
                    returnedStockValue: "",
                    adjustment: "",
                    note: "",
                    manualCost: "",
                  };
                  const initialOverride = {
                    status: match.manualCaseStatus || "",
                    returnReason: match.returnReason || "",
                    returnFeePercent:
                      match.returnFeePercent != null ? String(match.returnFeePercent) : "",
                    returnedStockValue:
                      match.returnedStockValueChf != null ? String(match.returnedStockValueChf) : "",
                    adjustment:
                      match.manualRevenueAdjustment != null ? String(match.manualRevenueAdjustment) : "",
                    note: match.manualNote || "",
                    manualCost:
                      match.manualCostOverride != null ? String(match.manualCostOverride) : "",
                  };
                  const form = hasOverrideData ? data : initialOverride;
                  const revenue = toNumber(match.shopifyTotalPrice);
                  const feePercent =
                    form.returnFeePercent?.trim()
                      ? parseFloat(form.returnFeePercent)
                      : form.returnReason === "STORE_CREDIT"
                      ? 25
                      : form.returnReason === "EXCHANGE"
                      ? 15
                      : form.returnReason === "DAMAGE"
                      ? 0
                      : null;
                  const returnFeeAmount =
                    form.returnReason && feePercent != null && !isNaN(feePercent)
                      ? (revenue * feePercent) / 100
                      : null;
                  const manualCost = form.manualCost?.trim() ? parseFloat(form.manualCost) : null;
                  const effectiveCost = manualCost != null ? manualCost : toNumber(match.supplierCost);
                  const effectiveRevenue =
                    form.returnReason && returnFeeAmount != null
                      ? returnFeeAmount
                      : revenue + (form.adjustment ? parseFloat(form.adjustment) : 0);
                  const adjustedMargin =
                    effectiveRevenue != null ? effectiveRevenue - effectiveCost : null;
                  const isLoading = manualOverrideLoading[match.id];
                  return (
                    <React.Fragment key={match.id}>
                      <tr className="border-b hover:bg-purple-50">
                        <td className="px-3 py-2 font-medium">{match.shopifyOrderName}</td>
                        <td className="px-3 py-2 text-xs">{match.shopifyProductTitle}</td>
                        <td className="px-3 py-2 font-mono text-xs">{match.supplierOrderNumber}</td>
                        <td className="px-3 py-2">
                          <span
                            className={`px-2 py-1 rounded text-xs font-semibold ${
                              match.matchConfidence === "high"
                                ? "bg-green-100 text-green-800"
                                : match.matchConfidence === "medium"
                                ? "bg-yellow-100 text-yellow-800"
                                : "bg-red-100 text-red-800"
                            }`}
                          >
                            {match.matchConfidence?.toUpperCase?.() || match.matchConfidence}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-xs">{match.supplierStatus}</td>
                        <td className="px-3 py-2">
                          {match.shopifyMetafieldsSynced ? (
                            <span className="text-green-600 font-semibold">✅</span>
                          ) : (
                            <span className="text-gray-400">⏸️</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-xs font-semibold">
                          {toNumber(match.marginPercent).toFixed(1)}%
                        </td>
                        <td className="px-3 py-2">
                          {match.returnReason ? (
                            <span className="px-2 py-1 rounded text-xs font-semibold bg-orange-100 text-orange-800">
                              {match.returnReason}
                            </span>
                          ) : (
                            <span className="text-xs text-gray-400">None</span>
                          )}
                          {match.returnFeePercent != null && (
                            <div className="text-xs text-orange-600 font-mono mt-1">
                              Fee: {toNumber(match.returnFeePercent).toFixed(2)}%
                            </div>
                          )}
                          {match.returnedStockValueChf != null && (
                            <div className="text-xs text-green-700 font-mono mt-1">
                              Stock: CHF {toNumber(match.returnedStockValueChf).toFixed(2)}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2 space-x-1">
                          <button
                            onClick={() => openManualEntryModalForEdit(match)}
                            className="text-blue-600 hover:text-blue-800 font-semibold text-xs px-2 py-1 rounded hover:bg-blue-50"
                            title="Edit all fields"
                          >
                            ✏️ Edit
                          </button>
                          <button
                            onClick={() => sendMilestoneEmail(match.id, false)}
                            disabled={!!emailLoading[match.id]}
                            className="text-emerald-700 hover:text-emerald-900 font-semibold text-xs px-2 py-1 rounded hover:bg-emerald-50 disabled:opacity-50"
                            title="Send milestone email (skips if already sent)"
                          >
                            {emailLoading[match.id] ? "…" : "📧 Send"}
                          </button>
                          <button
                            onClick={() => {
                              if (!confirm("Force resend this milestone email?")) return;
                              sendMilestoneEmail(match.id, true);
                            }}
                            disabled={!!emailLoading[match.id]}
                            className="text-emerald-700 hover:text-emerald-900 font-semibold text-xs px-2 py-1 rounded hover:bg-emerald-50 disabled:opacity-50"
                            title="Force resend (even if already sent)"
                          >
                            📧 Force
                          </button>
                          <button
                            onClick={() => {
                              const nextExpanded = !isExpanded;
                              if (nextExpanded && !manualOverrideData[match.id]) {
                                setManualOverrideData({
                                  ...manualOverrideData,
                                  [match.id]: initialOverride,
                                });
                              }
                              setManualOverrideExpanded({
                                ...manualOverrideExpanded,
                                [match.id]: nextExpanded,
                              });
                            }}
                            className="text-orange-600 hover:text-orange-800 font-semibold text-xs px-2 py-1 rounded hover:bg-orange-50"
                            title="Mark as refund/return"
                          >
                            {isExpanded ? "❌" : "💰"} Override
                          </button>
                          <button
                            onClick={() => deleteMatch(match.id, match.shopifyOrderName)}
                            className="text-red-600 hover:text-red-800 font-semibold text-xs px-2 py-1 rounded hover:bg-red-50"
                            title="Delete this match from database"
                          >
                            🗑️
                          </button>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr className="bg-orange-50 border-b">
                          <td colSpan={9} className="px-6 py-4">
                            <div className="max-w-2xl">
                              <h4 className="font-semibold text-orange-900 mb-3">
                                💰 Manual Override: {match.shopifyOrderName}
                              </h4>
                              <div className="grid grid-cols-3 gap-4 mb-4">
                                <div>
                                  <label className="block text-xs font-medium text-gray-700 mb-1">
                                    Return Reason
                                  </label>
                                  <select
                                    value={form.returnReason}
                                    onChange={(e) => {
                                      const nextReason = e.target.value;
                                      const current = manualOverrideData[match.id] || form;
                                      const defaultFee =
                                        nextReason === "STORE_CREDIT"
                                          ? "25"
                                          : nextReason === "EXCHANGE"
                                          ? "15"
                                          : "0";
                                      const defaultStockValue =
                                        current.returnedStockValue ||
                                        (match?.supplierCost != null ? String(match.supplierCost) : "");
                                      setManualOverrideData({
                                        ...manualOverrideData,
                                        [match.id]: {
                                          ...current,
                                          returnReason: nextReason,
                                          returnFeePercent: current.returnFeePercent || defaultFee,
                                          returnedStockValue: defaultStockValue,
                                        },
                                      });
                                    }}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                                  >
                                    <option value="">None</option>
                                    <option value="STORE_CREDIT">Store credit</option>
                                    <option value="EXCHANGE">Exchange</option>
                                    <option value="DAMAGE">Damage</option>
                                  </select>
                                </div>
                                <div>
                                  <label className="block text-xs font-medium text-gray-700 mb-1">
                                    Return Fee (%)
                                  </label>
                                  <input
                                    type="number"
                                    step="0.01"
                                    value={form.returnFeePercent}
                                    onChange={(e) =>
                                      setManualOverrideData({
                                        ...manualOverrideData,
                                        [match.id]: {
                                          ...(manualOverrideData[match.id] || form),
                                          returnFeePercent: e.target.value,
                                        },
                                      })
                                    }
                                    placeholder="e.g., 25 or 15"
                                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm font-mono"
                                  />
                                  <p className="text-xs text-gray-500 mt-1">
                                    Original: CHF {toNumber(match.shopifyTotalPrice).toFixed(2)}
                                  </p>
                                  {returnFeeAmount != null && (
                                    <p className="text-xs text-gray-600 mt-1">
                                      Return Fee Amount: CHF {returnFeeAmount.toFixed(2)}
                                    </p>
                                  )}
                                </div>
                                <div>
                                  <label className="block text-xs font-medium text-gray-700 mb-1">
                                    Returned Stock Value (CHF)
                                  </label>
                                  <input
                                    type="number"
                                    step="0.01"
                                    value={form.returnedStockValue}
                                    onChange={(e) =>
                                      setManualOverrideData({
                                        ...manualOverrideData,
                                        [match.id]: {
                                          ...(manualOverrideData[match.id] || form),
                                          returnedStockValue: e.target.value,
                                        },
                                      })
                                    }
                                    placeholder="Optional (asset value)"
                                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm font-mono"
                                  />
                                  <p className="text-xs text-gray-500 mt-1">
                                    Current: CHF {toNumber(match.returnedStockValueChf || 0).toFixed(2)}
                                  </p>
                                </div>
                              </div>
                              <div className="grid grid-cols-3 gap-4 mb-4">
                                <div>
                                  <label className="block text-xs font-medium text-gray-700 mb-1">
                                    Revenue Adjustment (CHF)
                                  </label>
                                  <input
                                    type="number"
                                    step="0.01"
                                    value={form.adjustment}
                                    onChange={(e) =>
                                      setManualOverrideData({
                                        ...manualOverrideData,
                                        [match.id]: {
                                          ...(manualOverrideData[match.id] || form),
                                          adjustment: e.target.value,
                                        },
                                      })
                                    }
                                    placeholder="e.g., -200 for full refund"
                                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm font-mono"
                                  />
                                </div>
                                <div>
                                  <label className="block text-xs font-medium text-gray-700 mb-1">
                                    Manual Supplier Cost (CHF)
                                  </label>
                                  <input
                                    type="number"
                                    step="0.01"
                                    value={form.manualCost}
                                    onChange={(e) =>
                                      setManualOverrideData({
                                        ...manualOverrideData,
                                        [match.id]: {
                                          ...(manualOverrideData[match.id] || form),
                                          manualCost: e.target.value,
                                        },
                                      })
                                    }
                                    placeholder="Leave blank to keep current"
                                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm font-mono"
                                  />
                                  <p className="text-xs text-gray-500 mt-1">
                                    Current: CHF {toNumber(match.supplierCost).toFixed(2)}
                                    {data.manualCost && ` → CHF ${parseFloat(data.manualCost).toFixed(2)}`}
                                  </p>
                                </div>
                              </div>
                              <div className="mt-2 text-xs text-gray-700">
                                {adjustedMargin != null && (
                                  <div className={adjustedMargin < 0 ? "text-red-700" : "text-green-700"}>
                                    Adjusted Margin: CHF {adjustedMargin.toFixed(2)}
                                  </div>
                                )}
                              </div>
                              <div className="mb-4">
                                <label className="block text-xs font-medium text-gray-700 mb-1">
                                  Note (optional)
                                </label>
                                <input
                                  type="text"
                                  value={form.note}
                                  onChange={(e) =>
                                    setManualOverrideData({
                                      ...manualOverrideData,
                                      [match.id]: {
                                        ...(manualOverrideData[match.id] || form),
                                        note: e.target.value,
                                      },
                                    })
                                  }
                                  placeholder="e.g., Customer received store credit"
                                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                                />
                              </div>
                              <div className="flex gap-2">
                                <button
                                  onClick={() => applyManualOverride(match.id, match)}
                                  disabled={isLoading}
                                  className="px-4 py-2 bg-orange-600 text-white rounded-md hover:bg-orange-700 disabled:bg-gray-400 text-sm font-medium"
                                >
                                  {isLoading ? "Applying..." : "✅ Apply Override"}
                                </button>
                                <button
                                  onClick={() =>
                                    setManualOverrideExpanded({ ...manualOverrideExpanded, [match.id]: false })
                                  }
                                  className="px-4 py-2 bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300 text-sm font-medium"
                                >
                                  Cancel
                                </button>
                              </div>
                              <div className="mt-3 text-xs text-gray-600 bg-white p-3 rounded border border-orange-200">
                                <strong>ℹ️ How it works:</strong>
                                <ul className="mt-1 space-y-1 list-disc list-inside">
                                  <li>
                                    <strong>Full refund:</strong> Set adjustment to -{toNumber(match.shopifyTotalPrice).toFixed(2)}
                                  </li>
                                  <li>
                                    <strong>Partial refund:</strong> Set adjustment to negative amount (e.g., -50)
                                  </li>
                                  <li>
                                    <strong>Store credit:</strong> Set status to CLOSED_CREDIT
                                  </li>
                                  <li>
                                    <strong>Liquidation (%):</strong> Set manual cost to your buy price (e.g., 80)
                                  </li>
                                  <li>
                                    <strong>Essential Hoodie:</strong> Auto 42 CHF cost (or override manually)
                                  </li>
                                  <li>
                                    <strong>Dashboard:</strong> Will show adjusted margin immediately
                                  </li>
                                  <li>
                                    <strong>Auto-sync:</strong> Will NOT overwrite manual fields
                                  </li>
                                  <li>
                                    <strong>Fulfillment:</strong> Manual cost items won't auto-match Supplier
                                  </li>
                                </ul>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="mt-4 bg-blue-50 border border-blue-200 rounded-lg p-4">
        <h3 className="font-semibold text-blue-900 mb-2">ℹ️ How it works (FULLY AUTOMATIC)</h3>
        <ul className="text-sm text-gray-700 space-y-1">
          <li>
            • <strong>Sync New Orders</strong>: 🤖 Fetches recent Shopify orders, auto-matches with Supplier,
            <span className="font-bold text-green-700">
              {" "}
              automatically sets metafields + saves to DB for HIGH confidence matches
            </span>
            . No manual approval needed!
          </li>
          <li>
            • <strong>Check Status Updates</strong>: 🔄 Monitors all synced orders for Supplier status changes and updates
            Shopify metafields automatically.
          </li>
          <li>
            • <strong>Database</strong>: 💾 All HIGH confidence matches stored locally. MEDIUM/LOW skipped (require
            manual review).
          </li>
        </ul>
      </div>
    </div>
  );
}

