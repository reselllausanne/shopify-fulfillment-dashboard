import { prisma } from "@/app/lib/prisma";
import { sendStockxEmail } from "@/lib/stockxAuthAlert";
import { getStockxLoginStatus } from "@/lib/stockxLoginSession";

const TERMINAL_STATUSES = [
  "BUYER_RECEIVED",
  "COMPLETE",
  "CANCELLED",
  "REFUNDED",
  "delivered",
  "PHYSICAL_STOCK",
  "ESSENTIAL_STOCK",
  "MANUAL",
  "MANUAL_COST",
  "FIXED_PRICE_COST",
  "MONEY_KICKZ_COST",
];

type RecapItem = {
  channel: "Shopify" | "Galaxus" | "Decathlon";
  order: string;
  stockxOrder: string;
  status: string;
  eta?: Date | null;
};

export type StockxDailyRecap = {
  subject: string;
  text: string;
  stats: {
    newLinks: number;
    updatedLinks: number;
    cancellations: number;
    overdue: number;
    missingAwb: number;
  };
};

function formatZurich(value: Date): string {
  return new Intl.DateTimeFormat("fr-CH", {
    timeZone: "Europe/Zurich",
    dateStyle: "short",
    timeStyle: "short",
  }).format(value);
}

function tokenLine(label: string, status: Awaited<ReturnType<typeof getStockxLoginStatus>>): string {
  if (!status.token?.expiresAt) return `${label}: ECHEC — token absent`;
  const expiresAt = new Date(status.token.expiresAt);
  const valid = expiresAt.getTime() > Date.now();
  return `${label}: ${valid ? "OK" : "ECHEC"} — expire ${formatZurich(expiresAt)} — profil ${
    status.hasProfile ? "OK" : "absent"
  }`;
}

function itemLine(prefix: string, item: RecapItem): string {
  const eta = item.eta ? ` — ETA ${formatZurich(item.eta)}` : "";
  return `${prefix} ${item.channel} ${item.order} — StockX ${item.stockxOrder} — ${item.status}${eta}`;
}

export async function buildStockxDailyRecap(hours = 24): Promise<StockxDailyRecap> {
  const now = new Date();
  const since = new Date(now.getTime() - Math.max(1, hours) * 60 * 60 * 1000);
  const olderThan48h = new Date(now.getTime() - 48 * 60 * 60 * 1000);
  const recentFloor = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const [
    defaultLogin,
    galaxusLogin,
    newShopify,
    newGalaxus,
    newDecathlon,
    updatedShopify,
    updatedGalaxus,
    updatedDecathlon,
    cancelledShopify,
    cancelledGalaxus,
    cancelledDecathlon,
    lateShopify,
    lateGalaxus,
    lateDecathlon,
    missingShopify,
    missingGalaxus,
    missingDecathlon,
  ] = await Promise.all([
    getStockxLoginStatus("default"),
    getStockxLoginStatus("galaxus"),
    prisma.orderMatch.count({ where: { createdAt: { gte: since }, supplierSource: "STOCKX" } }),
    prisma.galaxusStockxMatch.count({ where: { createdAt: { gte: since } } }),
    prisma.decathlonStockxMatch.count({ where: { createdAt: { gte: since } } }),
    prisma.orderMatch.count({
      where: { updatedAt: { gte: since }, createdAt: { lt: since }, supplierSource: "STOCKX" },
    }),
    prisma.galaxusStockxMatch.count({ where: { updatedAt: { gte: since }, createdAt: { lt: since } } }),
    prisma.decathlonStockxMatch.count({ where: { updatedAt: { gte: since }, createdAt: { lt: since } } }),
    prisma.orderMatch.findMany({
      where: { updatedAt: { gte: since }, stockxStatus: { in: ["CANCELLED", "REFUNDED"] } },
      select: { shopifyOrderName: true, stockxOrderNumber: true, stockxStatus: true },
      take: 25,
    }),
    prisma.galaxusStockxMatch.findMany({
      where: { updatedAt: { gte: since }, stockxStatus: { in: ["CANCELLED", "REFUNDED"] } },
      select: { galaxusOrderRef: true, galaxusOrderId: true, stockxOrderNumber: true, stockxStatus: true },
      take: 25,
    }),
    prisma.decathlonStockxMatch.findMany({
      where: { updatedAt: { gte: since }, stockxStatus: { in: ["CANCELLED", "REFUNDED"] } },
      select: { decathlonOrderId: true, stockxOrderNumber: true, stockxStatus: true },
      take: 25,
    }),
    prisma.orderMatch.findMany({
      where: {
        supplierSource: "STOCKX",
        stockxLatestEstimatedDelivery: { lt: now, gte: recentFloor },
        stockxStatus: { notIn: TERMINAL_STATUSES },
      },
      select: {
        shopifyOrderName: true,
        stockxOrderNumber: true,
        stockxStatus: true,
        stockxLatestEstimatedDelivery: true,
      },
      take: 25,
    }),
    prisma.galaxusStockxMatch.findMany({
      where: {
        stockxLatestEstimatedDelivery: { lt: now, gte: recentFloor },
        stockxStatus: { notIn: TERMINAL_STATUSES },
      },
      select: {
        galaxusOrderRef: true,
        galaxusOrderId: true,
        stockxOrderNumber: true,
        stockxStatus: true,
        stockxLatestEstimatedDelivery: true,
      },
      take: 25,
    }),
    prisma.decathlonStockxMatch.findMany({
      where: {
        stockxLatestEstimatedDelivery: { lt: now, gte: recentFloor },
        stockxStatus: { notIn: TERMINAL_STATUSES },
      },
      select: {
        decathlonOrderId: true,
        stockxOrderNumber: true,
        stockxStatus: true,
        stockxLatestEstimatedDelivery: true,
      },
      take: 25,
    }),
    prisma.orderMatch.count({
      where: {
        supplierSource: "STOCKX",
        stockxPurchaseDate: { gte: recentFloor, lt: olderThan48h },
        stockxAwb: null,
        stockxStatus: { notIn: TERMINAL_STATUSES },
      },
    }),
    prisma.galaxusStockxMatch.count({
      where: {
        stockxPurchaseDate: { gte: recentFloor, lt: olderThan48h },
        stockxAwb: null,
        stockxStatus: { notIn: TERMINAL_STATUSES },
      },
    }),
    prisma.decathlonStockxMatch.count({
      where: {
        stockxPurchaseDate: { gte: recentFloor, lt: olderThan48h },
        stockxAwb: null,
        stockxStatus: { notIn: TERMINAL_STATUSES },
      },
    }),
  ]);

  const cancellations: RecapItem[] = [
    ...cancelledShopify.map((row) => ({
      channel: "Shopify" as const,
      order: row.shopifyOrderName,
      stockxOrder: row.stockxOrderNumber,
      status: row.stockxStatus,
    })),
    ...cancelledGalaxus.map((row) => ({
      channel: "Galaxus" as const,
      order: row.galaxusOrderRef || row.galaxusOrderId,
      stockxOrder: row.stockxOrderNumber,
      status: row.stockxStatus || "CANCELLED",
    })),
    ...cancelledDecathlon.map((row) => ({
      channel: "Decathlon" as const,
      order: row.decathlonOrderId,
      stockxOrder: row.stockxOrderNumber,
      status: row.stockxStatus || "CANCELLED",
    })),
  ];
  const overdue: RecapItem[] = [
    ...lateShopify.map((row) => ({
      channel: "Shopify" as const,
      order: row.shopifyOrderName,
      stockxOrder: row.stockxOrderNumber,
      status: row.stockxStatus,
      eta: row.stockxLatestEstimatedDelivery,
    })),
    ...lateGalaxus.map((row) => ({
      channel: "Galaxus" as const,
      order: row.galaxusOrderRef || row.galaxusOrderId,
      stockxOrder: row.stockxOrderNumber,
      status: row.stockxStatus || "inconnu",
      eta: row.stockxLatestEstimatedDelivery,
    })),
    ...lateDecathlon.map((row) => ({
      channel: "Decathlon" as const,
      order: row.decathlonOrderId,
      stockxOrder: row.stockxOrderNumber,
      status: row.stockxStatus || "inconnu",
      eta: row.stockxLatestEstimatedDelivery,
    })),
  ];

  const stats = {
    newLinks: newShopify + newGalaxus + newDecathlon,
    updatedLinks: updatedShopify + updatedGalaxus + updatedDecathlon,
    cancellations: cancellations.length,
    overdue: overdue.length,
    missingAwb: missingShopify + missingGalaxus + missingDecathlon,
  };
  const attention = stats.cancellations + stats.overdue + stats.missingAwb;
  const subject = `[Resell] StockX recap — ${stats.newLinks} liens, ${attention} alertes`;
  const text = [
    `Récap StockX unique — ${formatZurich(now)}`,
    `Période: ${hours} dernières heures`,
    "",
    "CONNEXIONS",
    tokenLine("Shopify StockX", defaultLogin),
    tokenLine("Galaxus StockX", galaxusLogin),
    "",
    "ACTIVITÉ",
    `Nouveaux liens: ${stats.newLinks} (Shopify ${newShopify}, Galaxus ${newGalaxus}, Decathlon ${newDecathlon})`,
    `Liens mis à jour: ${stats.updatedLinks} (Shopify ${updatedShopify}, Galaxus ${updatedGalaxus}, Decathlon ${updatedDecathlon})`,
    "",
    "ALERTES",
    `Annulations/remboursements: ${stats.cancellations}`,
    `ETA dépassées actives: ${stats.overdue}`,
    `AWB absent après 48h, achats des 30 derniers jours: ${stats.missingAwb} (Shopify ${missingShopify}, Galaxus ${missingGalaxus}, Decathlon ${missingDecathlon})`,
    ...cancellations.map((item) => itemLine("ANNULE", item)),
    ...overdue.map((item) => itemLine("RETARD", item)),
    "",
    `Réparer connexion téléphone: https://solution.resell-lausanne.ch/admin/stockx-login`,
  ].join("\n");

  return { subject, text, stats };
}

export async function sendStockxDailyRecap(hours = 24): Promise<StockxDailyRecap & { sent: boolean }> {
  const recap = await buildStockxDailyRecap(hours);
  const sent = await sendStockxEmail(recap.subject, recap.text);
  return { ...recap, sent };
}
