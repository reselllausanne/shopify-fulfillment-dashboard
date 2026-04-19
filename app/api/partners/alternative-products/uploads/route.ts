import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { getPartnerSession } from "@/app/lib/partnerAuth";
import { parseCsv } from "@/app/lib/csv";
import {
  ALTERNATIVE_PRODUCT_ALLOWED_HEADERS,
  ALTERNATIVE_PRODUCT_REQUIRED_HEADERS,
  buildAlternativeProviderKey,
  isAbsoluteUrl,
  isAlternativeProductsPartnerKey,
  normalizeCurrency,
  normalizeVatRate,
  parseImageUrls,
  parseSpecsJson,
} from "@/app/lib/alternativeProducts";
import { parsePriceSafe, validateGtin } from "@/app/lib/normalize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 900;

type RowIssue = { row: number; field: string; message: string };

type RowOutcome = {
  row: number;
  status: "IMPORTED" | "ERROR" | "DUPLICATE_IGNORED";
  error?: string;
  warning?: string;
};

type ValidImportRow = {
  partnerId: string;
  uploadId: string;
  externalKey: string;
  gtin: string;
  providerKey: string;
  brand: string;
  title: string;
  variantName: string;
  description: string;
  category: string;
  size: string;
  mainImageUrl: string;
  extraImageUrls: string[] | null;
  color: string | null;
  gender: string | null;
  material: string | null;
  stock: number;
  priceExVat: number;
  vatRate: number;
  currency: string;
  leadTimeDays: number | null;
  specsJson: Record<string, string> | null;
  decathlonLogisticClass: string | null;
  decathlonLeadTimeToShip: number | null;
  exportEnabled: boolean;
  status: string;
  validationErrorsJson: { warnings?: string[] } | null;
};

function buildDuplicateKey(externalKey: string, gtin: string): string | null {
  const cleanKey = externalKey.trim().toUpperCase();
  const cleanGtin = gtin.trim();
  if (!cleanKey || !cleanGtin) return null;
  return `${cleanKey}|${cleanGtin}`;
}

function computeLastRowByKey(rows: string[][], headerMap: Map<string, number>): Map<string, number> {
  const lastRowByKey = new Map<string, number>();
  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i];
    const externalKey = row[headerMap.get("externalKey") ?? -1]?.trim() ?? "";
    const gtin = row[headerMap.get("gtin") ?? -1]?.trim() ?? "";
    const key = buildDuplicateKey(externalKey, gtin);
    if (!key) continue;
    lastRowByKey.set(key, i);
  }
  return lastRowByKey;
}

function chunkArray<T>(input: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < input.length; i += size) {
    chunks.push(input.slice(i, i + size));
  }
  return chunks;
}

export async function POST(req: NextRequest) {
  const session = await getPartnerSession(req);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isAlternativeProductsPartnerKey(session.partnerKey)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const mode = (searchParams.get("mode") ?? "").toLowerCase();
  const replaceExisting = mode === "replace";

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  if (!file) {
    return NextResponse.json({ error: "CSV file required" }, { status: 400 });
  }

  const prismaAny = prisma as any;
  const upload = await prismaAny.alternativeProductUpload.create({
    data: {
      partnerId: session.partnerId,
      filename: file.name ?? "alternative-products.csv",
      status: "PROCESSING",
    },
  });

  try {
    const text = await file.text();
    const rows = parseCsv(text);
    if (!rows.length) {
      throw new Error("CSV is empty");
    }
    if (rows.length === 1) {
      throw new Error("CSV contains no data rows");
    }

    const headers = rows[0].map((value) => value.trim());
    const headerMap = new Map(headers.map((value, index) => [value, index]));
    const missingHeaders = ALTERNATIVE_PRODUCT_REQUIRED_HEADERS.filter((header) => !headerMap.has(header));
    if (missingHeaders.length) {
      throw new Error(`Missing headers: ${missingHeaders.join(", ")}`);
    }
    const unknownHeaders = headers.filter((header) => !ALTERNATIVE_PRODUCT_ALLOWED_HEADERS.includes(header));
    if (unknownHeaders.length) {
      throw new Error(`Unknown headers: ${unknownHeaders.join(", ")}`);
    }

    const errors: RowIssue[] = [];
    const warnings: RowIssue[] = [];
    let errorRowCount = 0;
    const rowOutcomes: RowOutcome[] = [];
    const validImports: ValidImportRow[] = [];
    const lastRowByKey = computeLastRowByKey(rows, headerMap);

    for (let i = 1; i < rows.length; i += 1) {
      const row = rows[i];
      const read = (header: string) => row[headerMap.get(header) ?? -1]?.trim() ?? "";
      const rowErrors: string[] = [];
      const rowWarnings: string[] = [];

      const externalKey = read("externalKey");
      const gtin = read("gtin");
      const duplicateKey = buildDuplicateKey(externalKey, gtin);
      if (duplicateKey && lastRowByKey.get(duplicateKey) !== i) {
        rowOutcomes.push({
          row: i + 1,
          status: "DUPLICATE_IGNORED",
          warning: "Duplicate row, last occurrence wins",
        });
        continue;
      }

      if (!externalKey) rowErrors.push("externalKey: required");
      if (!gtin || !validateGtin(gtin)) rowErrors.push("gtin: invalid");
      const providerKeyValue = gtin ? buildAlternativeProviderKey(session.partnerKey, gtin) : null;
      if (!providerKeyValue) rowErrors.push("providerKey: could not derive from partner key + GTIN");
      const providerKeyRaw = read("providerKey");
      if (providerKeyRaw && providerKeyValue && providerKeyRaw !== providerKeyValue) {
        rowErrors.push(`providerKey: must be ${providerKeyValue}`);
      }

      const brand = read("brand");
      if (!brand) rowErrors.push("brand: required");
      const title = read("title");
      if (!title) rowErrors.push("title: required");
      const description = read("description");
      if (!description) rowErrors.push("description: required");
      const category = read("category");
      if (!category) rowErrors.push("category: required");
      const size = read("size");
      if (!size) rowErrors.push("size: required");

      const mainImageUrl = read("mainImageUrl");
      if (!mainImageUrl) rowErrors.push("mainImageUrl: required");
      if (mainImageUrl && !isAbsoluteUrl(mainImageUrl)) rowErrors.push("mainImageUrl: invalid URL");

      const { urls: extraImageUrls, error: imageError } = parseImageUrls(read("imageUrls"));
      if (imageError) rowErrors.push(`imageUrls: ${imageError}`);
      if (extraImageUrls.some((url) => !isAbsoluteUrl(url))) {
        rowErrors.push("imageUrls: all URLs must be absolute");
      }

      const stockRaw = read("stock").replace(/\u00A0/g, " ").trim();
      if (!/^\d+$/.test(stockRaw)) rowErrors.push("stock: invalid number");
      const stock = Number.parseInt(stockRaw, 10);
      if (!Number.isFinite(stock) || stock < 0) rowErrors.push("stock: must be >= 0");

      const priceExVat = parsePriceSafe(read("priceExVat"));
      if (priceExVat === null || priceExVat <= 0) rowErrors.push("priceExVat: invalid number");

      const vatRate = normalizeVatRate(read("vatRate"));
      if (vatRate === null) rowErrors.push("vatRate: invalid number");
      if (vatRate !== null && vatRate > 1) rowErrors.push("vatRate: must be <= 1.0");

      const currency = normalizeCurrency(read("currency"));
      if (!currency) rowErrors.push("currency: must be a 3-letter code");

      const variantName = read("variantName") || title;
      const color = read("color") || null;
      const gender = read("gender") || null;
      const material = read("material") || null;

      const leadTimeRaw = read("leadTimeDays");
      let leadTimeDays: number | null = null;
      if (leadTimeRaw) {
        const parsed = Number.parseInt(leadTimeRaw, 10);
        if (!Number.isFinite(parsed) || parsed < 0) rowErrors.push("leadTimeDays: invalid number");
        else leadTimeDays = parsed;
      }

      const decathlonLeadRaw = read("decathlonLeadTimeToShip");
      let decathlonLeadTimeToShip: number | null = null;
      if (decathlonLeadRaw) {
        const parsed = Number.parseInt(decathlonLeadRaw, 10);
        if (!Number.isFinite(parsed) || parsed < 0) rowErrors.push("decathlonLeadTimeToShip: invalid number");
        else decathlonLeadTimeToShip = parsed;
      }

      const decathlonLogisticClass = read("decathlonLogisticClass") || null;

      const { specs, error: specsError } = parseSpecsJson(read("specsJson"));
      if (specsError) rowErrors.push(`specsJson: ${specsError}`);

      if (rowErrors.length > 0) {
        errorRowCount += 1;
        rowErrors.forEach((message) => errors.push({ row: i + 1, field: message.split(":")[0], message }));
        rowOutcomes.push({
          row: i + 1,
          status: "ERROR",
          error: rowErrors.join("; "),
        });
        continue;
      }

      if (rowWarnings.length > 0) {
        rowWarnings.forEach((message) => warnings.push({ row: i + 1, field: "warning", message }));
      }

      validImports.push({
        partnerId: session.partnerId,
        uploadId: upload.id,
        externalKey,
        gtin,
        providerKey: providerKeyValue!,
        brand,
        title,
        variantName,
        description,
        category,
        size,
        mainImageUrl,
        extraImageUrls: extraImageUrls.length > 0 ? extraImageUrls : null,
        color,
        gender,
        material,
        stock,
        priceExVat: priceExVat!,
        vatRate: vatRate!,
        currency: currency!,
        leadTimeDays,
        specsJson: specs ?? null,
        decathlonLogisticClass,
        decathlonLeadTimeToShip,
        exportEnabled: true,
        status: rowWarnings.length > 0 ? "ACTIVE_WITH_WARNINGS" : "ACTIVE",
        validationErrorsJson: rowWarnings.length > 0 ? { warnings: rowWarnings } : null,
      });

      rowOutcomes.push({
        row: i + 1,
        status: "IMPORTED",
        warning: rowWarnings.length > 0 ? rowWarnings.join("; ") : undefined,
      });
    }

    if (replaceExisting && validImports.length === 0) {
      throw new Error("Replace mode requires at least one valid row.");
    }

    if (replaceExisting) {
      await prismaAny.alternativeProduct.updateMany({
        where: { partnerId: session.partnerId, archivedAt: null },
        data: { archivedAt: new Date(), exportEnabled: false, status: "ARCHIVED" },
      });
    }

    if (validImports.length > 0) {
      for (const batch of chunkArray(validImports, 500)) {
        await prismaAny.alternativeProduct.createMany({ data: batch });
      }
    }

    const errorsJson = {
      errors: errors.slice(0, 500),
      warnings: warnings.slice(0, 500),
    };

    await prismaAny.alternativeProductUpload.update({
      where: { id: upload.id },
      data: {
        status: "COMPLETED",
        totalRows: rows.length - 1,
        importedRows: validImports.length,
        errorRows: errorRowCount,
        errorsJson,
      },
    });

    return NextResponse.json({
      ok: true,
      uploadId: upload.id,
      totalRows: rows.length - 1,
      importedRows: validImports.length,
      errorRows: errorRowCount,
      errors,
      warnings,
      rows: rowOutcomes,
    });
  } catch (error: any) {
    await prismaAny.alternativeProductUpload.update({
      where: { id: upload.id },
      data: {
        status: "FAILED",
        errorsJson: { error: error?.message ?? "Upload failed" },
      },
    });
    return NextResponse.json(
      { error: error?.message ?? "Upload failed" },
      { status: 400 }
    );
  }
}
