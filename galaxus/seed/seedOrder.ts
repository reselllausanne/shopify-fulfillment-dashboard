import { prisma } from "../../app/lib/prisma";
import { addDays } from "date-fns";

type SeedOptions = {
  lineCount?: number;
  useLatestOrder?: boolean;
  useSupplierData?: boolean;
};

export async function seedGalaxusOrder(options: SeedOptions = {}) {
  const prismaAny = prisma as any;
  const lineCount = options.lineCount ?? 120;
  const useLatestOrder = options.useLatestOrder ?? true;
  const useSupplierData = options.useSupplierData ?? true;
  const orderId = `GX-${Date.now()}`;
  const now = new Date();

  const supplierLines = useSupplierData ? await loadSupplierLines(prismaAny, lineCount) : null;
  const latestOrder = useLatestOrder
    ? await prismaAny.galaxusOrder.findFirst({
        where: {
          galaxusOrderId: { not: { startsWith: "GX-" } },
        },
        orderBy: { createdAt: "desc" },
        include: { lines: true },
      })
    : null;

  const seedLines = supplierLines ?? buildSeedLines({ orderId, lineCount, latestOrder });

  const order = await prismaAny.galaxusOrder.create({
    data: {
      galaxusOrderId: orderId,
      orderNumber: `PO-${orderId}`,
      orderDate: now,
      deliveryDate: addDays(now, 3),
      currencyCode: latestOrder?.currencyCode ?? "CHF",
      customerName: latestOrder?.customerName ?? "Galaxus AG",
      customerAddress1: latestOrder?.customerAddress1 ?? "Industriestrasse 18",
      customerAddress2: latestOrder?.customerAddress2 ?? null,
      customerPostalCode: latestOrder?.customerPostalCode ?? "8604",
      customerCity: latestOrder?.customerCity ?? "Volketswil",
      customerCountry: latestOrder?.customerCountry ?? "Switzerland",
      customerVatId: latestOrder?.customerVatId ?? "CHE-123.456.789",
      recipientName: latestOrder?.recipientName ?? "Digitec Galaxus AG Receiving Wohlen",
      recipientAddress1: latestOrder?.recipientAddress1 ?? "Ferroring 23",
      recipientAddress2: latestOrder?.recipientAddress2 ?? null,
      recipientPostalCode: latestOrder?.recipientPostalCode ?? "CH-5612",
      recipientCity: latestOrder?.recipientCity ?? "Villmergen",
      recipientCountry: latestOrder?.recipientCountry ?? "Switzerland",
      recipientPhone: latestOrder?.recipientPhone ?? "043 408 9778",
      referencePerson: latestOrder?.referencePerson ?? "M. Haller",
      yourReference: latestOrder?.yourReference ?? "INT-3157",
      afterSalesHandling: latestOrder?.afterSalesHandling ?? false,
      lines: {
        create: seedLines,
      },
      shipments: {
        create: {
          shipmentId: `SHIP-${orderId}-${Date.now()}`,
          dispatchNotificationId: `DN-${orderId}`,
          dispatchNotificationCreatedAt: now,
          incoterms: "DDP",
        },
      },
    },
    include: {
      lines: true,
      shipments: true,
    },
  });

  return order;
}

async function loadSupplierLines(prismaAny: any, lineCount: number) {
  const variants = await prismaAny.supplierVariant.findMany({
    take: lineCount,
    orderBy: { updatedAt: "desc" },
    include: { mappings: true },
  });

  if (!variants.length) {
    throw new Error("No supplier variants available. Run supplier sync first.");
  }

  return variants.map((variant: any, index: number) => {
    const mapping = variant.mappings?.[0] ?? null;
    const supplierPid = mapping?.providerKey ?? variant.supplierVariantId;
    const gtin = mapping?.gtin ?? null;
    const quantity = 1;
    const unitNetPrice = Number(variant.price ?? 0);
    const lineNetAmount = unitNetPrice * quantity;

    return {
      lineNumber: index + 1,
      supplierSku: variant.supplierSku ?? `PL-SKU-${index + 1}`,
      supplierVariantId: variant.supplierVariantId ?? `PL-VAR-${index + 1}`,
      productName: variant.supplierSku ?? `Test Product ${index + 1}`,
      description: null,
      size: variant.sizeRaw ?? null,
      gtin,
      providerKey: supplierPid,
      supplierPid,
      quantity,
      orderUnit: "C62",
      vatRate: 8.1,
      taxAmountPerUnit: null,
      unitNetPrice,
      lineNetAmount,
      priceLineAmount: lineNetAmount,
      currencyCode: "CHF",
    };
  });
}

function buildSeedLines(options: {
  orderId: string;
  lineCount: number;
  latestOrder: any | null;
}) {
  if (options.latestOrder?.lines?.length) {
    const lines = options.latestOrder.lines.slice(0, options.lineCount).map((line: any, index: number) => ({
      lineNumber: index + 1,
      supplierSku: line.supplierSku ?? `PL-SKU-${index + 1}`,
      supplierVariantId: line.supplierVariantId ?? `PL-VAR-${index + 1}`,
      productName: line.productName ?? `Test Product ${index + 1}`,
      description: line.description ?? null,
      size: line.size ?? null,
      gtin: line.gtin ?? null,
      providerKey: line.providerKey ?? `PK-${options.orderId}-${index + 1}`,
      quantity: line.quantity ?? 1,
      vatRate: line.vatRate ?? "8.1",
      taxAmountPerUnit: line.taxAmountPerUnit ?? null,
      unitNetPrice: line.unitNetPrice ?? "50",
      lineNetAmount: line.lineNetAmount ?? "50",
      priceLineAmount: line.priceLineAmount ?? null,
      currencyCode: line.currencyCode ?? "CHF",
    }));
    if (lines.length) return lines;
  }

  return Array.from({ length: options.lineCount }, (_, index) => {
    const lineNumber = index + 1;
    const quantity = 1 + (lineNumber % 3);
    const unitNetPrice = 50 + (lineNumber % 10) * 7.5;
    const vatRate = lineNumber % 5 === 0 ? 2.6 : 8.1;
    const lineNetAmount = unitNetPrice * quantity;
    const size = `EU ${36 + (lineNumber % 12)}`;
    const providerKey = `PK-${options.orderId}-${lineNumber}`;

    return {
      lineNumber,
      supplierSku: `PL-SKU-${lineNumber}`,
      supplierVariantId: `PL-VAR-${lineNumber}`,
      productName: `Test Product ${lineNumber}`,
      description: `Sample product description ${lineNumber}`,
      size,
      gtin: providerKey,
      providerKey,
      quantity,
      vatRate,
      unitNetPrice,
      lineNetAmount,
      currencyCode: "CHF",
    };
  });
}
