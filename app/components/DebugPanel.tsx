import React from "react";

type DebugPanelProps = {
  lastStatus: number | null;
  pageInfo: {
    endCursor: string | null;
    hasNextPage: boolean;
    totalCount: number;
    startCursor: string | null;
    hasPreviousPage: boolean;
  } | null;
  ordersCount: number;
  lastErrors: any[];
  lastRequestPayload: Record<string, unknown> | null;
  lastResponsePayload: any | null;
};

export default function DebugPanel({
  lastStatus,
  pageInfo,
  ordersCount,
  lastErrors,
  lastRequestPayload,
  lastResponsePayload,
}: DebugPanelProps) {
  const formatJson = (value: unknown) => {
    if (value === null || value === undefined) return "N/A";
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  };

  return (
    <div className="bg-white rounded-lg shadow p-6 mb-6">
      <h2 className="text-xl font-semibold mb-4">Debug Info</h2>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
        <div>
          <span className="font-medium">Last HTTP Status:</span>{" "}
          <span
            className={
              lastStatus === 200
                ? "text-green-600"
                : lastStatus
                ? "text-red-600"
                : ""
            }
          >
            {lastStatus || "N/A"}
          </span>
        </div>
        <div>
          <span className="font-medium">Progress:</span>{" "}
          <span className="text-gray-600">
            {pageInfo ? `${ordersCount} / ${pageInfo.totalCount}` : "N/A"}
          </span>
        </div>
        <div>
          <span className="font-medium">Current Cursor:</span>{" "}
          <span className="text-gray-600">
            {pageInfo?.endCursor
              ? `${pageInfo.endCursor.substring(0, 15)}...`
              : "N/A"}
          </span>
        </div>
        <div>
          <span className="font-medium">Has Next Page:</span>{" "}
          <span className="text-gray-600">
            {pageInfo ? (pageInfo.hasNextPage ? "Yes" : "No") : "N/A"}
          </span>
        </div>
      </div>
      {lastErrors.length > 0 && (
        <div className="mt-4">
          <span className="font-medium text-red-600">Errors:</span>
          <pre className="mt-2 p-3 bg-red-50 rounded text-red-800 text-xs overflow-auto">
            {JSON.stringify(lastErrors, null, 2)}
          </pre>
        </div>
      )}
      <div className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div>
          <span className="font-medium text-gray-800">Latest StockX Request:</span>
          <pre className="mt-2 p-3 bg-gray-50 rounded text-gray-800 text-xs overflow-auto max-h-80 border border-gray-200">
            {formatJson(lastRequestPayload)}
          </pre>
        </div>
        <div>
          <span className="font-medium text-gray-800">Latest StockX Response:</span>
          <pre className="mt-2 p-3 bg-blue-50 rounded text-blue-900 text-xs overflow-auto max-h-80 border border-blue-100">
            {formatJson(lastResponsePayload)}
          </pre>
        </div>
      </div>
    </div>
  );
}

