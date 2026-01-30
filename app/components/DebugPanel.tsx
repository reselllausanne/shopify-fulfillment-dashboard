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
};

export default function DebugPanel({
  lastStatus,
  pageInfo,
  ordersCount,
  lastErrors,
}: DebugPanelProps) {
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
    </div>
  );
}

