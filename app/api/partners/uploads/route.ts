import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { getPartnerSession } from "@/app/lib/partnerAuth";
import { parseCsv } from "@/app/lib/csv";
import { buildProviderKey } from "@/galaxus/supplier/providerKey";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REQUIRED_HEADERS = [
  "partnerVariantId",
  "sku",
  "productName",
  "brand",
  "sizeRaw",
  "stock",
  "price",
  "imageUrls",
  "gtin",
];

function isAbsoluteUrl(value: string) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function parseImageUrls(value: string): string[] {
  return value
    .split(/[|,;]/g)
    .map((item) => item.trim())
    .filter((item) => item.length > 0 && isAbsoluteUrl(item));
}

export async function POST(req: NextRequest) {
  const session = await getPartnerSession(req);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  if (!file) {
    return NextResponse.json({ error: "CSV file required" }, { status: 400 });
  }

  const upload = await (prisma as any).partnerUpload.create({
    data: {
      partnerId: session.partnerId,
      filename: file.name ?? "upload.csv",
      status: "PROCESSING",
    },
  });

  try {
    const text = await file.text();
    const rows = parseCsv(text);
    if (!rows.length) {
      throw new Error("CSV is empty");
    }

    const headers = rows[0].map((value) => value.trim());
    const headerMap = new Map(headers.map((value, index) => [value, index]));
    const missingHeaders = REQUIRED_HEADERS.filter((header) => !headerMap.has(header));
    if (missingHeaders.length) {
      throw new Error(`Missing headers: ${missingHeaders.join(", ")}`);
    }

    const errors: Array<{ row: number; field: string; message: string }> = [];
    let importedRows = 0;

    for (let i = 1; i < rows.length; i += 1) {
      const row = rows[i];
      const read = (header: string) => row[headerMap.get(header) ?? -1]?.trim() ?? "";

      const partnerVariantId = read("partnerVariantId");
      const sku = read("sku");
      const productName = read("productName");
      const brand = read("brand");
      const sizeRaw = read("sizeRaw");
      const stockRaw = read("stock");
      const priceRaw = read("price");
      const imageUrlsRaw = read("imageUrls");
      const gtin = read("gtin");

      if (!partnerVariantId) {
        errors.push({ row: i + 1, field: "partnerVariantId", message: "Required" });
        continue;
      }
      if (!productName) {
        errors.push({ row: i + 1, field: "productName", message: "Required" });
        continue;
      }
      if (!brand) {
        errors.push({ row: i + 1, field: "brand", message: "Required" });
        continue;
      }
      if (!sizeRaw) {
        errors.push({ row: i + 1, field: "sizeRaw", message: "Required" });
        continue;
      }

      const stock = Number.parseInt(stockRaw, 10);
      if (!Number.isFinite(stock)) {
        errors.push({ row: i + 1, field: "stock", message: "Invalid number" });
        continue;
      }
      const price = Number.parseFloat(priceRaw);
      if (!Number.isFinite(price)) {
        errors.push({ row: i + 1, field: "price", message: "Invalid number" });
        continue;
      }

      const images = parseImageUrls(imageUrlsRaw);
      if (!images.length) {
        errors.push({ row: i + 1, field: "imageUrls", message: "At least one image URL required" });
        continue;
      }

      const saved = await (prisma as any).partnerVariant.upsert({
        where: { partnerId_partnerVariantId: { partnerId: session.partnerId, partnerVariantId } },
        create: {
          partnerId: session.partnerId,
          partnerVariantId,
          externalSku: sku || null,
          productName,
          brand,
          sizeRaw,
          stock,
          price,
          images,
          gtin: gtin || null,
          lastSyncAt: new Date(),
        },
        update: {
          externalSku: sku || null,
          productName,
          brand,
          sizeRaw,
          stock,
          price,
          images,
          gtin: gtin || null,
          lastSyncAt: new Date(),
        },
      });

      if (gtin) {
        const providerKey = buildProviderKey(gtin, `${session.partnerKey}:${partnerVariantId}`);
        await (prisma as any).variantMapping.upsert({
          where: { partnerVariantId: saved.id },
          create: {
            partnerVariantId: saved.id,
            gtin,
            providerKey,
            status: "PARTNER_GTIN",
          },
          update: {
            gtin,
            providerKey,
            status: "PARTNER_GTIN",
          },
        });
      }

      importedRows += 1;
    }

    await (prisma as any).partnerUpload.update({
      where: { id: upload.id },
      data: {
        status: errors.length ? "COMPLETED_WITH_ERRORS" : "COMPLETED",
        totalRows: Math.max(rows.length - 1, 0),
        importedRows,
        errorRows: errors.length,
        errorsJson: errors.length ? errors : null,
      },
    });

    return NextResponse.json({
      ok: true,
      result: {
        uploadId: upload.id,
        importedRows,
        errorRows: errors.length,
        errors,
      },
    });
  } catch (error: any) {
    await (prisma as any).partnerUpload.update({
      where: { id: upload.id },
      data: {
        status: "FAILED",
        errorsJson: [{ message: error.message ?? "Upload failed" }],
      },
    });
    return NextResponse.json({ error: error.message ?? "Upload failed" }, { status: 500 });
  }
}
