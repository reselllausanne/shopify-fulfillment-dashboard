import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { buildProviderKey } from "@/galaxus/supplier/providerKey";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ExportRow = Record<string, string>;

type Issue = {
  feed: "master" | "stock" | "specs";
  row: number;
  column?: string;
  message: string;
  value?: string;
};

type KickDbPayload = {
  title?: string;
  primary_title?: string;
  secondary_title?: string;
  description?: string;
  brand?: string;
  model?: string;
  sku?: string;
  category?: string;
  secondary_category?: string;
  product_type?: string;
  breadcrumbs?: Array<{ value?: string }>;
  gallery?: string[];
  image?: string;
};

const MASTER_REQUIRED_HEADERS = [
  "ProviderKey",
  "Gtin",
  "ManufacturerKey",
  "BrandName",
  "ProductCategory",
  "ProductTitle_de",
  "LongDescription_de",
  "MainImageUrl",
];

const MASTER_IMAGE_HEADERS = [
  "MainImageUrl",
  "ImageUrl_1",
  "ImageUrl_2",
  "ImageUrl_3",
  "ImageUrl_4",
  "ImageUrl_5",
  "ImageUrl_6",
  "ImageUrl_7",
  "ImageUrl_8",
];

function sanitizeText(value?: string | null): string {
  if (!value) return "";
  return value.replace(/[™®©]/g, "").replace(/\s+/g, " ").trim();
}

function normalizeBrand(value?: string | null): string {
  const trimmed = sanitizeText(value);
  if (!trimmed) return "";
  return trimmed[0].toUpperCase() + trimmed.slice(1);
}

function stripBrandPrefix(name: string, brand: string): string {
  if (!name || !brand) return name;
  const lowerName = name.toLowerCase();
  const lowerBrand = brand.toLowerCase();
  if (lowerName.startsWith(lowerBrand)) {
    const remaining = name.slice(brand.length).trim();
    return remaining.replace(/^[\-–—:]+/, "").trim();
  }
  return name;
}

function stripToken(name: string, token: string): string {
  if (!name || !token) return name;
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return name.replace(new RegExp(`\\b${escaped}\\b`, "gi"), "").replace(/\s+/g, " ").trim();
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return value.slice(0, max).trim();
}

function stripParenthetical(text: string): string {
  return text.replace(/\s*\([^)]*\)\s*$/g, "").trim();
}

function stripGenderTokens(text: string): string {
  return text
    .replace(/\b(women's|womens|women|men's|mens|men|gs|youth|kids)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isAbsoluteUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function buildProductTitle(payload: KickDbPayload | null, fallbackSku?: string | null): string {
  const brand = normalizeBrand(payload?.brand ?? "");
  const sku = sanitizeText(payload?.sku ?? "");
  const primary = sanitizeText(payload?.primary_title ?? "");
  const model = sanitizeText(payload?.model ?? "");
  const title = sanitizeText(payload?.title ?? "");
  const secondary = sanitizeText(payload?.secondary_title ?? "");

  let base = primary || model || title || fallbackSku || "";
  if (!base) return "";

  if (secondary && base.toLowerCase().endsWith(secondary.toLowerCase())) {
    base = base.slice(0, base.length - secondary.length).trim();
  }

  base = stripBrandPrefix(base, brand);
  base = stripParenthetical(base);
  base = stripGenderTokens(base);
  base = stripToken(base, brand);
  base = stripToken(base, secondary);
  base = stripToken(base, payload?.product_type ?? "");
  base = stripToken(base, payload?.category ?? "");
  if (sku) base = stripToken(base, sku);
  return truncate(base, 100);
}

function buildVariantName(payload: KickDbPayload | null, fallbackSku?: string | null): string {
  return buildProductTitle(payload, fallbackSku);
}

function buildProductCategory(payload: KickDbPayload | null): string {
  if (!payload) return "";
  const breadcrumb = payload.breadcrumbs
    ?.map((item) => sanitizeText(item.value ?? ""))
    .filter(Boolean);
  if (breadcrumb && breadcrumb.length) {
    return truncate(breadcrumb.join(" > "), 200);
  }
  const category = sanitizeText(payload.category ?? "");
  const secondary = sanitizeText(payload.secondary_category ?? "");
  if (category && secondary) return truncate(`${category} > ${secondary}`, 200);
  return truncate(category || sanitizeText(payload.product_type ?? ""), 200);
}

function cleanDescription(value?: string | null): string {
  if (!value) return "";
  let text = value.replace(/<[^>]*>/g, " ");
  text = text.replace(/https?:\/\/\S+/g, "");
  text = text.replace(/our team[^.]*\./gi, "");
  text = sanitizeText(text);
  return truncate(text, 4000);
}

function extractProductImages(
  payload: KickDbPayload | null,
  supplierImages: unknown,
  fallback?: string | null
): string[] {
  const list: string[] = [];
  if (payload?.image) list.push(payload.image);
  if (Array.isArray(payload?.gallery)) {
    for (const item of payload.gallery) {
      if (typeof item === "string" && item.length) list.push(item);
    }
  }
  if (fallback) list.push(fallback);
  if (Array.isArray(supplierImages)) {
    for (const item of supplierImages) {
      if (typeof item === "string" && item.length) list.push(item);
    }
  }
  return Array.from(new Set(list))
    .filter(Boolean)
    .filter((value) => isAbsoluteUrl(value));
}

function decimalToString(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number") return value.toString();
  return String(value);
}

function isAsciiPrintable(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 32 || code > 126) return false;
  }
  return true;
}

function isValidUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function isValidGtin(value: string): boolean {
  if (!/^\d+$/.test(value)) return false;
  if (![8, 12, 13, 14].includes(value.length)) return false;
  const digits = value.split("").map((d) => Number(d));
  const checkDigit = digits.pop() ?? 0;
  let sum = 0;
  let weight = 3;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    sum += digits[i] * weight;
    weight = weight === 3 ? 1 : 3;
  }
  const calculated = (10 - (sum % 10)) % 10;
  return calculated === checkDigit;
}

function buildMasterRows(mappings: any[]): ExportRow[] {
  const rows: ExportRow[] = mappings.map((mapping) => {
    const supplierVariant = mapping.supplierVariant;
    const product = mapping.kickdbVariant?.product;
    const payload = product?.name || product?.brand
      ? ({
          title: product?.name ?? undefined,
          brand: product?.brand ?? undefined,
          sku: product?.styleId ?? supplierVariant?.supplierSku ?? undefined,
        } as KickDbPayload)
      : null;
    const providerKey = buildProviderKey(mapping.gtin, supplierVariant?.supplierVariantId) ?? "";
    const images = extractProductImages(payload, supplierVariant?.images, product?.imageUrl ?? null);
    const title = buildProductTitle(payload, supplierVariant?.supplierSku ?? null);
    const variantName = buildVariantName(payload, supplierVariant?.supplierSku ?? null);

    const manufacturerBase = sanitizeText(payload?.sku ?? product?.styleId ?? supplierVariant?.supplierSku ?? "");
    const manufacturerKey = truncate(
      manufacturerBase ? `${manufacturerBase}-${mapping.gtin ?? ""}` : mapping.gtin ?? "",
      50
    );

    return {
      ProviderKey: providerKey,
      Gtin: mapping.gtin ?? "",
      ManufacturerKey: manufacturerKey,
      BrandName: normalizeBrand(payload?.brand ?? product?.brand ?? ""),
      ProductCategory: buildProductCategory(payload) || "Sneakers",
      ProductTitle_de: title,
      VariantName: variantName,
      LongDescription_de: cleanDescription(payload?.description ?? ""),
      MainImageUrl: images[0] ?? "",
      ImageUrl_1: images[1] ?? "",
      ImageUrl_2: images[2] ?? "",
      ImageUrl_3: images[3] ?? "",
      ImageUrl_4: images[4] ?? "",
      ImageUrl_5: images[5] ?? "",
      ImageUrl_6: images[6] ?? "",
      ImageUrl_7: images[7] ?? "",
      ImageUrl_8: images[8] ?? "",
    };
  });

  const uniqueRows: ExportRow[] = [];
  const seenProviderKeys = new Set<string>();
  const seenGtins = new Set<string>();
  for (const row of rows) {
    const providerKey = row.ProviderKey;
    const gtin = row.Gtin;
    if (providerKey && seenProviderKeys.has(providerKey)) continue;
    if (gtin && seenGtins.has(gtin)) continue;
    if (providerKey) seenProviderKeys.add(providerKey);
    if (gtin) seenGtins.add(gtin);
    uniqueRows.push(row);
  }

  return uniqueRows;
}

function buildStockRows(mappings: any[]): ExportRow[] {
  return mappings.map((mapping) => {
    const supplierVariant = mapping.supplierVariant;
    const providerKey = buildProviderKey(mapping.gtin, supplierVariant?.supplierVariantId) ?? "";
    const price = decimalToString(supplierVariant?.price ?? "");
    const stock = supplierVariant?.stock ?? 0;

    return {
      ProviderKey: providerKey,
      PurchasePriceExclVat: price,
      PurchasePriceExclVatAndFee: price,
      QuantityOnStock: stock.toString(),
    };
  });
}

function buildSpecsRows(mappings: any[]): ExportRow[] {
  const rows: ExportRow[] = [];
  for (const mapping of mappings) {
    const supplierVariant = mapping.supplierVariant;
    const product = mapping.kickdbVariant?.product;
    const providerKey = buildProviderKey(mapping.gtin, supplierVariant?.supplierVariantId);
    if (!providerKey) continue;

    if (supplierVariant?.sizeRaw) {
      rows.push({
        ProviderKey: providerKey,
        SpecificationKey: "Size EU",
        SpecificationValue: supplierVariant.sizeRaw,
      });
    }
    if (product?.brand) {
      rows.push({
        ProviderKey: providerKey,
        SpecificationKey: "Brand",
        SpecificationValue: product.brand,
      });
    }
  }

  rows.sort((a, b) => a.ProviderKey.localeCompare(b.ProviderKey));
  return rows;
}

function validateMaster(rows: ExportRow[]): Issue[] {
  const issues: Issue[] = [];
  const providerKeyValues = new Map<string, number>();
  const gtinValues = new Map<string, number>();
  const manufacturerValues = new Map<string, number>();

  rows.forEach((row, index) => {
    const rowNumber = index + 2;

    const getValue = (column: string) => row[column]?.trim() ?? "";
    const providerKey = getValue("ProviderKey");
    if (!providerKey) {
      issues.push({ feed: "master", row: rowNumber, column: "ProviderKey", message: "ProviderKey is empty" });
    } else {
      if (!isAsciiPrintable(providerKey)) {
        issues.push({
          feed: "master",
          row: rowNumber,
          column: "ProviderKey",
          message: "ProviderKey contains non-ASCII characters",
          value: providerKey,
        });
      }
      if (providerKey.length > 100) {
        issues.push({
          feed: "master",
          row: rowNumber,
          column: "ProviderKey",
          message: "ProviderKey exceeds 100 characters",
          value: providerKey,
        });
      }
      const existing = providerKeyValues.get(providerKey);
      if (existing) {
        issues.push({
          feed: "master",
          row: rowNumber,
          column: "ProviderKey",
          message: `Duplicate ProviderKey (also row ${existing})`,
          value: providerKey,
        });
      } else {
        providerKeyValues.set(providerKey, rowNumber);
      }
    }

    const gtin = getValue("Gtin");
    if (!gtin) {
      issues.push({ feed: "master", row: rowNumber, column: "Gtin", message: "Gtin is empty" });
    } else {
      const existing = gtinValues.get(gtin);
      if (existing) {
        issues.push({
          feed: "master",
          row: rowNumber,
          column: "Gtin",
          message: `Duplicate Gtin (also row ${existing})`,
          value: gtin,
        });
      } else {
        gtinValues.set(gtin, rowNumber);
      }
      if (!isValidGtin(gtin)) {
        issues.push({
          feed: "master",
          row: rowNumber,
          column: "Gtin",
          message: "Gtin is invalid or has a wrong check digit",
          value: gtin,
        });
      }
    }

    const manufacturerKey = getValue("ManufacturerKey");
    if (!manufacturerKey) {
      issues.push({
        feed: "master",
        row: rowNumber,
        column: "ManufacturerKey",
        message: "ManufacturerKey is empty",
      });
    } else {
      if (manufacturerKey.length < 4 || manufacturerKey.length > 50) {
        issues.push({
          feed: "master",
          row: rowNumber,
          column: "ManufacturerKey",
          message: "ManufacturerKey length must be 4–50",
          value: manufacturerKey,
        });
      }
      const existing = manufacturerValues.get(manufacturerKey);
      if (existing) {
        issues.push({
          feed: "master",
          row: rowNumber,
          column: "ManufacturerKey",
          message: `Duplicate ManufacturerKey (also row ${existing})`,
          value: manufacturerKey,
        });
      } else {
        manufacturerValues.set(manufacturerKey, rowNumber);
      }
    }

    const brand = getValue("BrandName");
    if (!brand) {
      issues.push({ feed: "master", row: rowNumber, column: "BrandName", message: "BrandName is empty" });
    }

    const category = getValue("ProductCategory");
    if (!category) {
      issues.push({
        feed: "master",
        row: rowNumber,
        column: "ProductCategory",
        message: "ProductCategory is empty",
      });
    } else if (category.length > 200) {
      issues.push({
        feed: "master",
        row: rowNumber,
        column: "ProductCategory",
        message: "ProductCategory exceeds 200 characters",
        value: category,
      });
    }

    const title = getValue("ProductTitle_de");
    if (!title) {
      issues.push({
        feed: "master",
        row: rowNumber,
        column: "ProductTitle_de",
        message: "ProductTitle_de is empty",
      });
    } else if (title.length > 100) {
      issues.push({
        feed: "master",
        row: rowNumber,
        column: "ProductTitle_de",
        message: "ProductTitle_de exceeds 100 characters",
        value: title,
      });
    } else if (/[™®©]/.test(title)) {
      issues.push({
        feed: "master",
        row: rowNumber,
        column: "ProductTitle_de",
        message: "ProductTitle_de contains trademark symbols",
        value: title,
      });
    }

    const description = getValue("LongDescription_de");
    if (description.length > 4000) {
      issues.push({
        feed: "master",
        row: rowNumber,
        column: "LongDescription_de",
        message: "LongDescription_de exceeds 4000 characters",
      });
    }

    for (const column of MASTER_IMAGE_HEADERS) {
      const value = getValue(column);
      if (!value) {
        if (column === "MainImageUrl") {
          issues.push({
            feed: "master",
            row: rowNumber,
            column,
            message: "MainImageUrl is empty",
          });
        }
        continue;
      }
      if (value.length > 300) {
        issues.push({
          feed: "master",
          row: rowNumber,
          column,
          message: "Image URL exceeds 300 characters",
          value,
        });
      }
      if (!isValidUrl(value)) {
        issues.push({
          feed: "master",
          row: rowNumber,
          column,
          message: "Image URL is not a valid absolute URL",
          value,
        });
      }
    }
  });

  for (const required of MASTER_REQUIRED_HEADERS) {
    const hasColumn = rows.some((row) => required in row);
    if (!hasColumn) {
      issues.push({
        feed: "master",
        row: 1,
        column: required,
        message: "Missing mandatory header",
      });
    }
  }

  return issues;
}

function validateStock(rows: ExportRow[]): Issue[] {
  const issues: Issue[] = [];
  rows.forEach((row, index) => {
    const rowNumber = index + 2;
    const providerKey = row.ProviderKey?.trim() ?? "";
    if (!providerKey) {
      issues.push({ feed: "stock", row: rowNumber, column: "ProviderKey", message: "ProviderKey is empty" });
    } else if (!isAsciiPrintable(providerKey)) {
      issues.push({
        feed: "stock",
        row: rowNumber,
        column: "ProviderKey",
        message: "ProviderKey contains non-ASCII characters",
        value: providerKey,
      });
    }
    const price = row.PurchasePriceExclVat?.trim() ?? "";
    if (!price) {
      issues.push({
        feed: "stock",
        row: rowNumber,
        column: "PurchasePriceExclVat",
        message: "PurchasePriceExclVat is empty",
      });
    }
    const priceWithFee = row.PurchasePriceExclVatAndFee?.trim() ?? "";
    if (!priceWithFee) {
      issues.push({
        feed: "stock",
        row: rowNumber,
        column: "PurchasePriceExclVatAndFee",
        message: "PurchasePriceExclVatAndFee is empty",
      });
    }
    const quantity = row.QuantityOnStock?.trim() ?? "";
    if (!quantity) {
      issues.push({
        feed: "stock",
        row: rowNumber,
        column: "QuantityOnStock",
        message: "QuantityOnStock is empty",
      });
    } else if (!/^\d+$/.test(quantity)) {
      issues.push({
        feed: "stock",
        row: rowNumber,
        column: "QuantityOnStock",
        message: "QuantityOnStock must be a non-negative integer",
        value: quantity,
      });
    }
  });
  return issues;
}

function validateSpecs(rows: ExportRow[]): Issue[] {
  const issues: Issue[] = [];
  rows.forEach((row, index) => {
    const rowNumber = index + 2;
    const providerKey = row.ProviderKey?.trim() ?? "";
    if (!providerKey) {
      issues.push({ feed: "specs", row: rowNumber, column: "ProviderKey", message: "ProviderKey is empty" });
    } else if (!isAsciiPrintable(providerKey)) {
      issues.push({
        feed: "specs",
        row: rowNumber,
        column: "ProviderKey",
        message: "ProviderKey contains non-ASCII characters",
        value: providerKey,
      });
    }
    const specKey = row.SpecificationKey?.trim() ?? "";
    if (!specKey) {
      issues.push({
        feed: "specs",
        row: rowNumber,
        column: "SpecificationKey",
        message: "SpecificationKey is empty",
      });
    }
    const specValue = row.SpecificationValue?.trim() ?? "";
    if (!specValue) {
      issues.push({
        feed: "specs",
        row: rowNumber,
        column: "SpecificationValue",
        message: "SpecificationValue is empty",
      });
    }
  });
  return issues;
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = Math.min(Number(searchParams.get("limit") ?? "100"), 500);
    const offset = Math.max(Number(searchParams.get("offset") ?? "0"), 0);
    const supplier = searchParams.get("supplier")?.trim();

    const whereSupplier = supplier
      ? { supplierVariant: { supplierVariantId: { startsWith: `${supplier}:` } } }
      : {};

    const mappings = await prisma.variantMapping.findMany({
      where: {
        status: "MATCHED",
        gtin: { not: null },
        ...whereSupplier,
      },
      include: {
        supplierVariant: true,
        kickdbVariant: { include: { product: true } },
      },
      orderBy: { updatedAt: "desc" },
      take: limit,
      skip: offset,
    });

    const masterRows = buildMasterRows(mappings);
    const stockRows = buildStockRows(mappings);
    const specsRows = buildSpecsRows(mappings);

    const masterIssues = validateMaster(masterRows);
    const stockIssues = validateStock(stockRows);
    const specsIssues = validateSpecs(specsRows);

    return NextResponse.json({
      ok: true,
      report: {
        summary: {
          master: { totalRows: masterRows.length, totalIssues: masterIssues.length },
          stock: { totalRows: stockRows.length, totalIssues: stockIssues.length },
          specs: { totalRows: specsRows.length, totalIssues: specsIssues.length },
        },
        issues: {
          master: masterIssues,
          stock: stockIssues,
          specs: specsIssues,
        },
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        error: error?.message ?? "Failed to run export checks.",
      },
      { status: 500 }
    );
  }
}
