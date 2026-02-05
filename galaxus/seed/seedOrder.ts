import { prisma } from "../../app/lib/prisma";
import { addDays } from "date-fns";

type SeedOptions = {
  lineCount?: number;
};

export async function seedGalaxusOrder(options: SeedOptions = {}) {
  const lineCount = options.lineCount ?? 120;
  const orderId = `GX-${Date.now()}`;
  const now = new Date();

  const lines = Array.from({ length: lineCount }, (_, index) => {
    const lineNumber = index + 1;
    const quantity = 1 + (lineNumber % 3);
    const unitNetPrice = 50 + (lineNumber % 10) * 7.5;
    const vatRate = lineNumber % 5 === 0 ? 2.6 : 8.1;
    const lineNetAmount = unitNetPrice * quantity;
    const size = `EU ${36 + (lineNumber % 12)}`;
    const providerKey = `PK-${orderId}-${lineNumber}`;

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

  const order = await prisma.galaxusOrder.create({
    data: {
      galaxusOrderId: orderId,
      orderNumber: `PO-${orderId}`,
      orderDate: now,
      deliveryDate: addDays(now, 3),
      currencyCode: "CHF",
      customerName: "Galaxus AG",
      customerAddress1: "Industriestrasse 18",
      customerAddress2: null,
      customerPostalCode: "8604",
      customerCity: "Volketswil",
      customerCountry: "Switzerland",
      customerVatId: "CHE-123.456.789",
      recipientName: "Digitec Galaxus AG Receiving Wohlen",
      recipientAddress1: "Ferroring 23",
      recipientAddress2: null,
      recipientPostalCode: "CH-5612",
      recipientCity: "Villmergen",
      recipientCountry: "Switzerland",
      recipientPhone: "043 408 9778",
      referencePerson: "M. Haller",
      yourReference: "INT-3157",
      afterSalesHandling: false,
      lines: {
        create: lines,
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
