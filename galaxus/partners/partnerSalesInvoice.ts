import { fromZonedTime } from "date-fns-tz";
import { prisma } from "@/app/lib/prisma";
import { galaxusLineNetRevenueChf } from "@/galaxus/orders/margin";
import { normalizeProviderKey } from "@/galaxus/supplier/providerKey";
import {
  collectGtinsFromLines,
  lineMatchesPartnerScope,
  resolvePartnerGtins,
} from "@/app/api/partners/galaxus/orders/partnerLineScope";

const TZ = "Europe/Zurich";

export type PartnerSalesInvoiceRow = {
  orderDate: string;
  galaxusOrderId: string;
  orderNumber: string | null;
  productName: string;
  sku: string;
  size: string;
  gtin: string;
  quantity: number;
  unitNetPrice: number | null;
  lineNetAmount: number | null;
  currency: string;
};

export type PartnerSalesInvoice = {
  partnerKey: string;
  partnerName: string;
  date: string;
  currency: string;
  rows: PartnerSalesInvoiceRow[];
  totalLineNet: number;
  totalUnits: number;
};

function isYmd(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function addOneDayYmd(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d));
  utc.setUTCDate(utc.getUTCDate() + 1);
  const yy = utc.getUTCFullYear();
  const mm = String(utc.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(utc.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

/** Calendar day bounds in Europe/Zurich → UTC Date range [start, endExclusive). */
export function zurichDayBounds(ymd: string): { start: Date; endExclusive: Date } {
  if (!isYmd(ymd)) throw new Error("date must be YYYY-MM-DD");
  const start = fromZonedTime(`${ymd}T00:00:00.000`, TZ);
  const endExclusive = fromZonedTime(`${addOneDayYmd(ymd)}T00:00:00.000`, TZ);
  return { start, endExclusive };
}

function clean(value: unknown): string {
  return String(value ?? "").trim();
}

function toMoney(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function productNameFromLine(line: {
  productName?: string | null;
  description?: string | null;
}): string {
  return clean(line.productName) || clean(line.description) || "Item";
}

function skuFromLine(line: {
  supplierSku?: string | null;
  providerKey?: string | null;
  supplierPid?: string | null;
  supplierVariantId?: string | null;
}): string {
  return (
    clean(line.supplierSku) ||
    clean(line.providerKey) ||
    clean(line.supplierPid) ||
    clean(line.supplierVariantId) ||
    "—"
  );
}

/**
 * Partner Galaxus sales for one calendar day (order date, Europe/Zurich).
 * Product fields come from Galaxus order lines only (survives catalog delete).
 */
export async function buildPartnerSalesInvoice(options: {
  partnerKey: string;
  partnerName?: string | null;
  date: string;
}): Promise<PartnerSalesInvoice> {
  const partnerKey = normalizeProviderKey(options.partnerKey);
  if (!partnerKey) throw new Error("Partner key missing");
  if (!isYmd(options.date)) throw new Error("date must be YYYY-MM-DD");

  const { start, endExclusive } = zurichDayBounds(options.date);
  const pkLower = partnerKey.toLowerCase();

  const mappedGtinRows = await (prisma as any).variantMapping.findMany({
    where: {
      OR: [
        { providerKey: { startsWith: `${partnerKey}_`, mode: "insensitive" } },
        { supplierVariantId: { startsWith: `${pkLower}:`, mode: "insensitive" } },
        { supplierVariantId: { startsWith: `${pkLower}_`, mode: "insensitive" } },
      ],
    },
    select: { gtin: true },
  });
  const mappedGtins = Array.from(
    new Set(
      mappedGtinRows
        .map((row: { gtin?: string | null }) => clean(row?.gtin))
        .filter(Boolean)
    )
  ) as string[];

  const lineScopeOr: Array<Record<string, unknown>> = [
    { providerKey: { startsWith: `${partnerKey}_`, mode: "insensitive" } },
    { supplierPid: { equals: partnerKey, mode: "insensitive" } },
    { supplierSku: { startsWith: `${partnerKey}_`, mode: "insensitive" } },
    { supplierVariantId: { startsWith: `${pkLower}:`, mode: "insensitive" } },
    { supplierVariantId: { startsWith: `${pkLower}_`, mode: "insensitive" } },
  ];
  if (mappedGtins.length > 0) {
    lineScopeOr.push({ gtin: { in: mappedGtins } });
  }

  const orders = await prisma.galaxusOrder.findMany({
    where: {
      orderDate: { gte: start, lt: endExclusive },
      cancelledAt: null,
      lines: { some: { OR: lineScopeOr as any } },
    },
    orderBy: [{ orderDate: "asc" }, { galaxusOrderId: "asc" }],
    include: {
      lines: {
        orderBy: { lineNumber: "asc" },
      },
    },
  });

  const partnerGtins = await resolvePartnerGtins(
    collectGtinsFromLines(orders.flatMap((o) => o.lines)),
    partnerKey
  );
  for (const gtin of mappedGtins) partnerGtins.add(gtin);

  const rows: PartnerSalesInvoiceRow[] = [];
  let currency = "CHF";
  let totalLineNet = 0;
  let totalUnits = 0;

  for (const order of orders) {
    currency = clean(order.currencyCode) || currency;
    for (const line of order.lines) {
      if (!lineMatchesPartnerScope(line, partnerKey, partnerGtins)) continue;
      const quantity = Number(line.quantity ?? 0);
      if (!Number.isFinite(quantity) || quantity <= 0) continue;

      const lineNet =
        galaxusLineNetRevenueChf(line) ??
        (() => {
          const unit = toMoney(line.unitNetPrice);
          return unit != null ? Number((unit * quantity).toFixed(2)) : null;
        })();
      const unitNet =
        toMoney(line.unitNetPrice) ??
        (lineNet != null && quantity > 0 ? Number((lineNet / quantity).toFixed(2)) : null);

      if (lineNet != null) totalLineNet += lineNet;
      totalUnits += quantity;

      rows.push({
        orderDate: options.date,
        galaxusOrderId: order.galaxusOrderId,
        orderNumber: order.orderNumber ?? null,
        productName: productNameFromLine(line),
        sku: skuFromLine(line),
        size: clean(line.size) || "—",
        gtin: clean(line.gtin) || "—",
        quantity,
        unitNetPrice: unitNet,
        lineNetAmount: lineNet,
        currency: clean(order.currencyCode) || currency,
      });
    }
  }

  return {
    partnerKey,
    partnerName: clean(options.partnerName) || partnerKey,
    date: options.date,
    currency,
    rows,
    totalLineNet: Number(totalLineNet.toFixed(2)),
    totalUnits,
  };
}

export function partnerSalesInvoiceToCsv(invoice: PartnerSalesInvoice): string {
  const headers = [
    "date",
    "galaxusOrderId",
    "orderNumber",
    "productName",
    "sku",
    "size",
    "gtin",
    "quantity",
    "unitNetPrice",
    "lineNetAmount",
    "currency",
  ];
  const cell = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;
  const lines = [headers.join(",")];
  for (const row of invoice.rows) {
    lines.push(
      [
        row.orderDate,
        row.galaxusOrderId,
        row.orderNumber ?? "",
        row.productName,
        row.sku,
        row.size,
        row.gtin,
        row.quantity,
        row.unitNetPrice ?? "",
        row.lineNetAmount ?? "",
        row.currency,
      ]
        .map(cell)
        .join(",")
    );
  }
  lines.push(
    ["", "", "", "TOTAL", "", "", "", invoice.totalUnits, "", invoice.totalLineNet, invoice.currency]
      .map(cell)
      .join(",")
  );
  return `${lines.join("\n")}\n`;
}

export function partnerSalesInvoiceToHtml(invoice: PartnerSalesInvoice): string {
  const money = (n: number | null) =>
    n == null || !Number.isFinite(n)
      ? "—"
      : n.toLocaleString("de-CH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const bodyRows = invoice.rows
    .map(
      (row) => `
      <tr>
        <td>${escapeHtml(row.galaxusOrderId)}</td>
        <td>${escapeHtml(row.orderNumber ?? "—")}</td>
        <td>${escapeHtml(row.productName)}</td>
        <td>${escapeHtml(row.sku)}</td>
        <td>${escapeHtml(row.size)}</td>
        <td class="mono">${escapeHtml(row.gtin)}</td>
        <td class="num">${row.quantity}</td>
        <td class="num">${money(row.unitNetPrice)}</td>
        <td class="num">${money(row.lineNetAmount)}</td>
      </tr>`
    )
    .join("");

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    body { font-family: Helvetica, Arial, sans-serif; color: #0f172a; font-size: 11px; margin: 28px; }
    h1 { font-size: 18px; margin: 0 0 4px; }
    .meta { color: #475569; margin-bottom: 18px; line-height: 1.45; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border-bottom: 1px solid #e2e8f0; padding: 6px 5px; text-align: left; vertical-align: top; }
    th { font-size: 10px; text-transform: uppercase; letter-spacing: 0.04em; color: #64748b; }
    .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
    .mono { font-family: ui-monospace, Menlo, monospace; font-size: 10px; }
    tfoot td { font-weight: 700; border-top: 2px solid #0f172a; border-bottom: none; padding-top: 10px; }
  </style>
</head>
<body>
  <h1>Partner sales report</h1>
  <div class="meta">
    <div><strong>${escapeHtml(invoice.partnerName)}</strong> (${escapeHtml(invoice.partnerKey)})</div>
    <div>Date: ${escapeHtml(invoice.date)} (Europe/Zurich · Galaxus order date)</div>
    <div>Lines: ${invoice.rows.length} · Units: ${invoice.totalUnits} · Total: ${money(invoice.totalLineNet)} ${escapeHtml(invoice.currency)}</div>
    <div>Source: Galaxus order lines (product name / SKU from the order, not catalog)</div>
    <div>Note: sell prices account for the 2% Galaxus fast-payment deduction.</div>
  </div>
  <table>
    <thead>
      <tr>
        <th>Order</th>
        <th>Order #</th>
        <th>Product</th>
        <th>SKU</th>
        <th>Size</th>
        <th>GTIN</th>
        <th class="num">Qty</th>
        <th class="num">Unit net</th>
        <th class="num">Line net</th>
      </tr>
    </thead>
    <tbody>
      ${bodyRows || `<tr><td colspan="9">No partner sales on this date.</td></tr>`}
    </tbody>
    <tfoot>
      <tr>
        <td colspan="6">Total</td>
        <td class="num">${invoice.totalUnits}</td>
        <td></td>
        <td class="num">${money(invoice.totalLineNet)} ${escapeHtml(invoice.currency)}</td>
      </tr>
    </tfoot>
  </table>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
