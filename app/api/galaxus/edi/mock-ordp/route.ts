import { NextResponse } from "next/server";
import { create } from "xmlbuilder2";
import { prisma } from "@/app/lib/prisma";
import {
  GALAXUS_SFTP_HOST,
  GALAXUS_SFTP_IN_DIR,
  GALAXUS_SFTP_PASSWORD,
  GALAXUS_SFTP_PORT,
  GALAXUS_SFTP_USER,
  GALAXUS_SUPPLIER_ID,
  assertSftpConfig,
} from "@/galaxus/edi/config";
import { buildEdiFilename, buildTimestamp } from "@/galaxus/edi/filenames";
import { uploadTempThenRename, withSftp } from "@/galaxus/edi/sftpClient";
import { buildProviderKey } from "@/galaxus/supplier/providerKey";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type MockLine = {
  lineNumber: number;
  supplierPid: string;
  buyerPid?: string | null;
  gtin?: string | null;
  description: string;
  quantity: number;
  orderUnit: string;
  unitNetPrice: number;
  taxAmount: number;
  taxRate: number;
  lineNetAmount: number;
};

const OPENTRANS_NS = "http://www.bmecat.org/bmecat/2005";
const XSI_NS = "http://www.w3.org/2001/XMLSchema-instance";

function formatDateTime(value: Date): string {
  return value.toISOString().replace(/\.\d{3}Z$/, "Z");
}

function addParty(parent: any, role: string, data: {
  id: string;
  gln?: string;
  name: string;
  street: string;
  postalCode: string;
  city: string;
  country: string;
  countryCode: string;
  email?: string;
  phone?: string;
}) {
  const party = parent.ele("PARTY", { PARTY_ROLE: role });
  party.ele("PARTY_ID", { type: `${role}_specific` }).txt(data.id);
  if (data.gln) {
    party.ele("PARTY_ID", { type: "gln" }).txt(data.gln);
  }
  const address = party.ele("ADDRESS");
  address.ele("NAME").txt(data.name);
  address.ele("STREET").txt(data.street);
  address.ele("ZIP").txt(data.postalCode);
  address.ele("CITY").txt(data.city);
  address.ele("COUNTRY").txt(data.country);
  address.ele("COUNTRY_CODED").txt(data.countryCode);
  if (data.email) address.ele("EMAIL").txt(data.email);
  if (data.phone) address.ele("PHONE").txt(data.phone);
}

function buildMockOrderXml(orderId: string, lines: MockLine[]): string {
  const now = new Date();
  const root = create({ version: "1.0", encoding: "UTF-8" }).ele("ORDER", {
    xmlns: OPENTRANS_NS,
    "xmlns:xsi": XSI_NS,
    version: "2.1",
  });

  const header = root.ele("ORDER_HEADER");
  const control = header.ele("CONTROL_INFO");
  control.ele("GENERATION_DATE").txt(formatDateTime(now));

  const info = header.ele("ORDER_INFO");
  info.ele("ORDER_ID").txt(orderId);
  info.ele("ORDER_DATE").txt(formatDateTime(now));
  info.ele("LANGUAGE").txt("ger");
  info.ele("CURRENCY").txt("CHF");

  const parties = info.ele("PARTIES");
  addParty(parties, "buyer", {
    id: "2045638",
    gln: "7640151820008",
    name: "Digitec Galaxus AG",
    street: "Pfingstweidstrasse 60b",
    postalCode: "8005",
    city: "Zürich",
    country: "Schweiz",
    countryCode: "CH",
    email: "noreply@galaxus.ch",
  });
  addParty(parties, "supplier", {
    id: GALAXUS_SUPPLIER_ID || "SUPPLIER",
    name: "Supplier",
    street: "Supplier Street 1",
    postalCode: "8000",
    city: "Zürich",
    country: "Schweiz",
    countryCode: "CH",
  });
  addParty(parties, "delivery", {
    id: "delivery",
    name: "Test Customer",
    street: "Test Street 1",
    postalCode: "8000",
    city: "Zürich",
    country: "Schweiz",
    countryCode: "CH",
  });

  const orderRefs = info.ele("ORDER_PARTIES_REFERENCE");
  orderRefs.ele("BUYER_IDREF").txt("2045638");
  orderRefs.ele("SUPPLIER_IDREF").txt(GALAXUS_SUPPLIER_ID || "SUPPLIER");

  const udx = info.ele("HEADER_UDX");
  udx.ele("UDX.DG.CUSTOMER_TYPE").txt("private_customer");
  udx.ele("UDX.DG.DELIVERY_TYPE").txt("warehouse_delivery");
  udx.ele("UDX.DG.IS_COLLECTIVE_ORDER").txt("false");
  udx.ele("UDX.DG.PHYSICAL_DELIVERY_NOTE_REQUIRED").txt("false");
  udx.ele("UDX.DG.SATURDAY_DELIVERY_ALLOWED").txt("false");

  const items = root.ele("ORDER_ITEM_LIST");
  let totalAmount = 0;
  let totalQty = 0;

  for (const line of lines) {
    totalAmount += line.lineNetAmount;
    totalQty += line.quantity;

    const item = items.ele("ORDER_ITEM");
    item.ele("LINE_ITEM_ID").txt(line.lineNumber.toString());
    const product = item.ele("PRODUCT_ID");
    product.ele("SUPPLIER_PID").txt(line.supplierPid);
    if (line.gtin) product.ele("INTERNATIONAL_PID").txt(line.gtin);
    if (line.buyerPid) product.ele("BUYER_PID").txt(line.buyerPid);
    item.ele("DESCRIPTION_SHORT").txt(line.description);
    item.ele("QUANTITY").txt(line.quantity.toString());
    item.ele("ORDER_UNIT").txt(line.orderUnit);

    const price = item.ele("PRODUCT_PRICE_FIX");
    price.ele("PRICE_AMOUNT").txt(line.unitNetPrice.toFixed(2));
    const tax = price.ele("TAX_DETAILS_FIX");
    tax.ele("TAX_AMOUNT").txt(line.taxAmount.toFixed(2));
    tax.ele("TAX_RATE").txt(line.taxRate.toFixed(2));

    // Parser expects TAX_RATE at item level; include for robustness.
    item.ele("TAX_RATE").txt(line.taxRate.toFixed(2));
    item.ele("PRICE_LINE_AMOUNT").txt(line.lineNetAmount.toFixed(2));
  }

  const summary = root.ele("ORDER_SUMMARY");
  summary.ele("TOTAL_ITEM_NUM").txt(totalQty.toString());
  summary.ele("TOTAL_AMOUNT").txt(totalAmount.toFixed(2));

  return root.end({ prettyPrint: true });
}

export async function POST(request: Request) {
  try {
    assertSftpConfig();
    const body = await request.json().catch(() => ({}));
    const lineCount = Math.max(3, Math.min(Number(body?.lineCount ?? 150), 200));

    const baseWhere = [
      `vm."status" IN ('MATCHED','SUPPLIER_GTIN','PARTNER_GTIN')`,
      `vm."gtin" IS NOT NULL`,
      `sv."stock" > 0`,
      `sv."price" > 0`,
      `sv."sizeRaw" IS NOT NULL`,
    ].join(" AND ");

    const queryIds = async (whereClause: string, limit: number) =>
      prisma.$queryRawUnsafe<{ id: string }[]>(
        `SELECT vm."id"
         FROM "public"."VariantMapping" vm
         JOIN "public"."SupplierVariant" sv
           ON sv."supplierVariantId" = vm."supplierVariantId"
         WHERE ${baseWhere} AND ${whereClause}
         ORDER BY RANDOM()
         LIMIT ${limit}`
      );

    const [trmIds, goldenIds, partnerIds] = await Promise.all([
      queryIds(`sv."supplierVariantId" ILIKE 'trm:%'`, 1),
      queryIds(`sv."supplierVariantId" ILIKE 'golden:%'`, 1),
      queryIds(
        `sv."supplierVariantId" NOT ILIKE 'trm:%' AND sv."supplierVariantId" NOT ILIKE 'golden:%'`,
        1
      ),
    ]);

    const missingBuckets: string[] = [];
    if (!trmIds.length) missingBuckets.push("TRM");
    if (!goldenIds.length) missingBuckets.push("GOLDEN");
    if (!partnerIds.length) missingBuckets.push("PARTNER");
    if (missingBuckets.length > 0) {
      return NextResponse.json(
        { ok: false, error: `Missing eligible variants for: ${missingBuckets.join(", ")}` },
        { status: 400 }
      );
    }

    const selectedIds = [trmIds[0].id, goldenIds[0].id, partnerIds[0].id];
    const remaining = Math.max(lineCount - selectedIds.length, 0);
    if (remaining > 0) {
      const excluded = selectedIds.map((id) => `'${id.replace(/'/g, "''")}'`).join(",");
      const exclusionClause = excluded ? `vm."id" NOT IN (${excluded})` : "TRUE";
      const extraIds = await queryIds(exclusionClause, remaining);
      selectedIds.push(...extraIds.map((row) => row.id));
    }

    const mappings = await prisma.variantMapping.findMany({
      where: { id: { in: selectedIds } },
      include: { supplierVariant: true },
    });
    const mappingById = new Map(mappings.map((mapping) => [mapping.id, mapping]));
    const validMappings = selectedIds
      .map((id) => mappingById.get(id))
      .filter((mapping): mapping is (typeof mappings)[number] => Boolean(mapping))
      .filter((mapping) => mapping.gtin && String(mapping.gtin).trim().length > 0);

    if (!validMappings.length) {
      return NextResponse.json(
        { ok: false, error: "No mapped variants found to build a mock order." },
        { status: 400 }
      );
    }

    const defaultVatRate = 8.1;
    const lines: MockLine[] = validMappings.map((mapping, index) => {
      const mappingAny = mapping as any;
      const supplierVariant = mapping.supplierVariant as any;
      const providerKey = buildProviderKey(mapping.gtin, supplierVariant?.supplierVariantId) ?? "";
      const priceRaw = supplierVariant?.price ?? 0;
      const unitPrice = Number(priceRaw) || 0;
      const stockRaw = Number(supplierVariant?.stock ?? 0);
      const stockQty = Number.isFinite(stockRaw) ? Math.max(1, Math.floor(stockRaw)) : 1;
      const quantity = stockQty > 1 ? stockQty : 1;
      const lineNetAmount = unitPrice * quantity;
      const taxRate = Number.isFinite(mappingAny.vatRate) ? Number(mappingAny.vatRate) : defaultVatRate;
      const taxAmount = (unitPrice * taxRate) / 100;
      return {
        lineNumber: index + 1,
        supplierPid: providerKey,
        buyerPid: mappingAny.buyerPid ?? null,
        gtin: mapping.gtin ?? null,
        description:
          supplierVariant?.productName ??
          supplierVariant?.supplierProductName ??
          supplierVariant?.supplierSku ??
          "Item",
        quantity,
        orderUnit: "C62",
        unitNetPrice: unitPrice,
        taxAmount,
        taxRate,
        lineNetAmount,
      };
    });

    const timestamp = buildTimestamp();
    const orderId = `GX-${timestamp.replace(/[^0-9]/g, "")}`;
    const filename = buildEdiFilename({
      docType: "ORDP",
      supplierId: GALAXUS_SUPPLIER_ID || "SUPPLIER",
      orderId,
      timestamp,
    });
    const xml = buildMockOrderXml(orderId, lines);

    await withSftp(
      {
        host: GALAXUS_SFTP_HOST,
        port: GALAXUS_SFTP_PORT,
        username: GALAXUS_SFTP_USER,
        password: GALAXUS_SFTP_PASSWORD,
      },
      async (client) => {
        await uploadTempThenRename(client, GALAXUS_SFTP_IN_DIR, filename, xml);
      }
    );

    return NextResponse.json({
      ok: true,
      filename,
      orderId,
      lineCount: lines.length,
      inDir: GALAXUS_SFTP_IN_DIR,
    });
  } catch (error: any) {
    console.error("[GALAXUS][EDI][MOCK-ORDP] Failed:", error);
    return NextResponse.json(
      { ok: false, error: error?.message ?? "Failed to create mock order." },
      { status: 500 }
    );
  }
}
