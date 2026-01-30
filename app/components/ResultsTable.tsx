import React from "react";

type PricingResult = {
  total: number;
};

type Props = {
  orders: any[];
  enrichedOrders: any[] | null;
  pricingByOrder: Record<string, PricingResult | null>;
  pricingLoading: Record<string, boolean>;
  fetchPricingForOrder: (order: any) => Promise<void>;
};

const ResultsTable: React.FC<Props> = ({
  orders,
  enrichedOrders,
  pricingByOrder,
  pricingLoading,
  fetchPricingForOrder,
}) => {
  const rows = enrichedOrders || orders;

  return (
    <div className="bg-white rounded-lg shadow overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-200">
        <h2 className="text-xl font-semibold">
          Results ({rows.length} orders{enrichedOrders ? " - Enriched (A+B)" : " - Basic (A)"})
        </h2>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Order Number
              </th>
              <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Purchase Date
              </th>
              <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Offer Price
              </th>
              <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Total TTC
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Product
              </th>
              <th className="px-2 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-32">
                SKU
              </th>
              <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Size
              </th>
              <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                ETA
              </th>
              <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Status {enrichedOrders && "(B)"}
              </th>
              {enrichedOrders && (
                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  AWB (B)
                </th>
              )}
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={enrichedOrders ? 10 : 9} className="px-6 py-8 text-center text-gray-500">
                  No orders loaded. Click "🔍 Fetch All Pages + Details" to start.
                </td>
              </tr>
            ) : (
              rows.map((order, idx) => (
                <tr key={`${order.orderId}-${idx}`} className="hover:bg-gray-50">
                  <td className="px-3 py-3 whitespace-nowrap text-sm font-medium text-gray-900">
                    {order.orderNumber ?? "—"}
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap text-sm text-gray-500" title={order.purchaseDateFormatted ?? ""}>
                    {order.purchaseDateFormatted ?? "—"}
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap text-sm text-gray-900">
                    {order.amount != null ? order.amount.toFixed(2) : "—"} {order.currencyCode ?? ""}
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap text-sm text-gray-900">
                    {enrichedOrders && order.supplierCost != null ? (
                      <span className="font-semibold text-green-700" title="From Query B (exact payment)">
                        {Number(order.supplierCost).toFixed(2)} CHF
                      </span>
                    ) : order.orderNumber ? (
                      pricingByOrder[order.orderNumber]?.total != null ? (
                        <span className="font-semibold text-green-700">
                          {pricingByOrder[order.orderNumber]!.total.toFixed(2)} {order.currencyCode ?? "CHF"}
                        </span>
                      ) : pricingLoading[order.orderNumber] ? (
                        <span className="text-blue-600 text-xs">Loading…</span>
                      ) : (
                        <button
                          onClick={() => fetchPricingForOrder(order)}
                          className="text-blue-600 underline hover:text-blue-800 text-xs"
                        >
                          Get
                        </button>
                      )
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-900">
                    <div className="flex items-center gap-2">
                      {enrichedOrders && order.thumbUrlB && (
                        <img
                          src={order.thumbUrlB}
                          alt={order.productTitleB || ""}
                          className="w-8 h-8 object-cover rounded"
                        />
                      )}
                      <span title={enrichedOrders && order.productTitleB ? order.productTitleB : order.displayName || ""}>
                        {enrichedOrders && order.productTitleB ? (
                          <span className="font-medium">{order.productTitleB}</span>
                        ) : (
                          order.displayName
                        )}
                        {enrichedOrders && order.brandB && (
                          <span className="text-xs text-gray-500 block">{order.brandB}</span>
                        )}
                      </span>
                    </div>
                  </td>
                  <td
                    className="px-2 py-3 whitespace-nowrap text-xs text-gray-600 font-mono w-32"
                    title={`StyleID: ${order.styleId ?? "—"} / Model: ${order.model ?? "—"}`}
                  >
                    {order.styleId || order.model || "—"}
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap text-sm text-gray-500">
                    {enrichedOrders && order.sizeB ? <span className="font-medium text-gray-900">{order.sizeB}</span> : order.size ?? "—"}
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap text-sm text-gray-500">
                    {enrichedOrders && order.estimatedDeliveryB ? (
                      <span className="text-blue-600 font-medium" title={`Latest: ${order.latestEstimatedDeliveryB || "N/A"}`}>
                        {new Date(order.estimatedDeliveryB).toLocaleDateString("fr-CH", {
                          day: "2-digit",
                          month: "2-digit",
                          year: "numeric",
                        })}
                      </span>
                    ) : (
                      order.estimatedDeliveryFormatted ?? "—"
                    )}
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap text-sm">
                    {enrichedOrders && order.statusKeyB ? (
                      <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                        {order.statusKeyB}
                      </span>
                    ) : (
                      <span className="text-gray-500">{order.statusKey ?? "—"}</span>
                    )}
                  </td>
                  {enrichedOrders && (
                    <td className="px-3 py-3 text-sm">
                      {order.awb && order.trackingUrl ? (
                        <a
                          href={order.trackingUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs font-mono text-blue-600 hover:text-blue-800 hover:underline"
                          title="Click to track package"
                        >
                          📦 {order.awb}
                        </a>
                      ) : order.awb ? (
                        <span className="text-xs font-mono text-gray-700" title="Tracking number (no URL)">
                          📦 {order.awb}
                        </span>
                      ) : (
                        <span className="text-gray-400 text-xs">⏳ Not shipped</span>
                      )}
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default ResultsTable;

