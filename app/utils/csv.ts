import { toNumber } from "./format";

type OrderLike = {
  orderNumber?: string | null;
  purchaseDate?: string | null;
  amount?: number | null;
  currencyCode?: string | null;
  displayName?: string | null;
  productName?: string | null;
  skuKey?: string | null;
  size?: string | null;
  sizeType?: string | null;
  estimatedDeliveryDate?: string | null;
  statusKey?: string | null;
  productVariantId?: string | null;
};

type PricingByOrder = Record<string, { total: number } | null>;

export function exportOrdersToCSV(orders: OrderLike[], pricingByOrder: PricingByOrder) {
  if (!orders || orders.length === 0) {
    alert("No data to export");
    return;
  }

  const headers = [
    "orderNumber",
    "purchaseDate",
    "offerPrice",
    "currencyCode",
    "totalTTC",
    "productTitle",
    "productName",
    "sku",
    "size",
    "sizeType",
    "estimatedDeliveryDate",
    "statusKey",
    "productVariantId",
  ];

  const rows = orders.map((order) => [
    order.orderNumber ?? "",
    order.purchaseDate ?? "",
    order.amount != null ? order.amount : "",
    order.currencyCode ?? "",
    order.orderNumber && pricingByOrder[order.orderNumber]?.total != null
      ? pricingByOrder[order.orderNumber]!.total
      : "",
    order.displayName,
    order.productName ?? "",
    order.skuKey ?? "",
    order.size ?? "",
    order.sizeType ?? "",
    order.estimatedDeliveryDate ?? "",
    order.statusKey ?? "",
    order.productVariantId ?? "",
  ]);

  const csvContent = [
    headers.join(","),
    ...rows.map((row) =>
      row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")
    ),
  ].join("\n");

  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  link.setAttribute("href", url);
  link.setAttribute("download", "supplier_orders.csv");
  link.style.visibility = "hidden";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

