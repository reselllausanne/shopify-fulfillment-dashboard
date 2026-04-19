import { OFFERS_HEADERS, PRODUCTS_HEADERS } from "@/decathlon/exports/templates";

type CsvValue = string | number | boolean | null | undefined;

function quoteCsvValue(value: CsvValue): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

export function toDelimitedCsv(
  headers: string[],
  rows: Array<Record<string, CsvValue>>,
  delimiter: string = ";"
): string {
  const headerLine = headers.map(quoteCsvValue).join(delimiter);
  const lines = [headerLine];
  for (const row of rows) {
    const line = headers.map((header) => quoteCsvValue(row[header]));
    lines.push(line.join(delimiter));
  }
  return lines.join("\n");
}

export const OF01_HEADERS = [
  "offer-sku",
  "product-id",
  "product-id-type",
  "price",
  "quantity",
  "state",
  "logistic-class",
  "leadtime-to-ship",
  "min-order-quantity",
  "max-order-quantity",
  "discount-price",
  "discount-start-date",
  "discount-end-date",
  "description",
];
export const OF01_WITH_PRODUCTS_HEADERS = [...PRODUCTS_HEADERS, ...OFFERS_HEADERS];
export const STO01_HEADERS = ["offer-sku", "quantity", "warehouse-code", "update-delete"];
export const PRI01_HEADERS = [
  "offer-sku",
  "price",
  "discount-price",
  "discount-start-date",
  "discount-end-date",
];

export type MiraklOf01Row = {
  offerSku: string;
  productId: string;
  productIdType?: string;
  price: string;
  quantity: number;
  state?: string;
  logisticClass?: string;
  leadtimeToShip?: string;
  minOrderQuantity?: string;
  maxOrderQuantity?: string;
  discountPrice?: string;
  discountStartDate?: string;
  discountEndDate?: string;
  description?: string;
};

export type MiraklSto01Row = {
  offerSku: string;
  quantity: number;
  warehouseCode: string;
  updateDelete?: "UPDATE" | "DELETE" | "";
};

export type MiraklPri01Row = {
  offerSku: string;
  price: string;
  discountPrice?: string | null;
  discountStartDate?: string | null;
  discountEndDate?: string | null;
};

export function buildOf01Csv(rows: MiraklOf01Row[]) {
  const payloadRows = rows.map((row) => ({
    "offer-sku": row.offerSku,
    "product-id": row.productId,
    "product-id-type": row.productIdType ?? "EAN",
    price: row.price,
    quantity: row.quantity,
    state: row.state ?? "11",
    "logistic-class": row.logisticClass ?? "",
    "leadtime-to-ship": row.leadtimeToShip ?? "",
    "min-order-quantity": row.minOrderQuantity ?? "",
    "max-order-quantity": row.maxOrderQuantity ?? "",
    "discount-price": row.discountPrice ?? "",
    "discount-start-date": row.discountStartDate ?? "",
    "discount-end-date": row.discountEndDate ?? "",
    description: row.description ?? "",
  }));
  return {
    headers: OF01_HEADERS,
    rows: payloadRows,
    csv: toDelimitedCsv(OF01_HEADERS, payloadRows),
  };
}

export function buildOf01WithProductsCsv(rows: Array<Record<string, CsvValue>>) {
  return {
    headers: OF01_WITH_PRODUCTS_HEADERS,
    rows,
    csv: toDelimitedCsv(OF01_WITH_PRODUCTS_HEADERS, rows),
  };
}

export function buildSto01Csv(rows: MiraklSto01Row[]) {
  const payloadRows = rows.map((row) => ({
    "offer-sku": row.offerSku,
    quantity: row.quantity,
    "warehouse-code": row.warehouseCode,
    "update-delete": row.updateDelete ?? "UPDATE",
  }));
  return {
    headers: STO01_HEADERS,
    rows: payloadRows,
    csv: toDelimitedCsv(STO01_HEADERS, payloadRows),
  };
}

export function buildPri01Csv(rows: MiraklPri01Row[]) {
  const payloadRows = rows.map((row) => ({
    "offer-sku": row.offerSku,
    price: row.price,
    "discount-price": row.discountPrice ?? "",
    "discount-start-date": row.discountStartDate ?? "",
    "discount-end-date": row.discountEndDate ?? "",
  }));
  return {
    headers: PRI01_HEADERS,
    rows: payloadRows,
    csv: toDelimitedCsv(PRI01_HEADERS, payloadRows),
  };
}
