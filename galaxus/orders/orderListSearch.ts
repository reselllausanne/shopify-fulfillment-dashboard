import type { Prisma } from "@prisma/client";
import { compactSearchKey, searchTokens } from "@/lib/searchNormalize";

/**
 * Direct-delivery / Galaxus order list search intent:
 * - text: "midnight" → every order whose product/customer matches
 * - model: "1130" → every Asics 1130 / Gel-1130 style hit
 * - full_sku: "FQ8144-001" → only that SKU (all tokens on same line)
 * - order_id: long numeric Galaxus/order number
 */

export type OrderListSearchKind = "full_sku" | "model" | "text" | "order_id";

const LINE_IDENTITY_FIELDS = [
  "gtin",
  "supplierSku",
  "productName",
  "description",
  "supplierPid",
  "providerKey",
  "buyerPid",
] as const;

function lineFieldOr(variant: string): Prisma.GalaxusOrderLineWhereInput {
  return {
    OR: LINE_IDENTITY_FIELDS.map((field) => ({
      [field]: { contains: variant, mode: "insensitive" as const },
    })),
  };
}

/** Product/SKU fields only — never `size` (Nike "001" colorways false-positive). */
export function lineIdentityContains(variant: string): Prisma.GalaxusOrderWhereInput {
  return { lines: { some: lineFieldOr(variant) } };
}

export function lineIdentityHasAllTokens(tokens: string[]): Prisma.GalaxusOrderWhereInput {
  return {
    lines: {
      some: {
        AND: tokens.map((variant) => lineFieldOr(variant)),
      },
    },
  };
}

export function classifyOrderListSearch(q: string): OrderListSearchKind {
  const raw = q.trim();
  const compact = compactSearchKey(raw);
  if (!compact) return "text";

  const tokens = searchTokens(raw);
  const noSpace = raw.replace(/\s+/g, "");

  // Supplier / marketplace SKU prefixes
  if (/^(stx|rei)[_-]/i.test(raw)) return "full_sku";

  // Explicit style-colorway: FQ8144-001, DM0029_102
  if (
    /^[a-z0-9]+[-_][a-z0-9]+$/i.test(noSpace) &&
    /[a-z]/i.test(compact) &&
    /\d/.test(compact) &&
    compact.length >= 6
  ) {
    return "full_sku";
  }

  // Jammed full SKU without separator (FQ8144001) — long letter+digit blob
  if (
    !/\s/.test(raw) &&
    compact.length >= 9 &&
    /[a-z]/i.test(compact) &&
    /\d/.test(compact)
  ) {
    return "full_sku";
  }

  // Long digit string → Galaxus order id / order number
  if (/^\d{7,}$/.test(compact)) return "order_id";

  // Multi-word ("asics 1130", "gel midnight") → text so tokens AND on one line.
  // Don't jam into model compact ("asics1130") or phrase-contains fails.
  if (tokens.length >= 2) return "text";

  // Model / partial style: 1130, 2002r, FQ8144 (no colorway)
  if (/^\d{3,6}$/.test(compact)) return "model";
  if (/^[a-z]{0,6}\d{2,6}[a-z]{0,4}$/i.test(compact) && compact.length >= 3 && compact.length <= 10) {
    return "model";
  }

  return "text";
}

export function buildOrderListSearchOrClauses(q: string): Prisma.GalaxusOrderWhereInput[] {
  const raw = q.trim();
  if (raw.length < 2) return [];

  const kind = classifyOrderListSearch(raw);
  const tokens = searchTokens(raw);
  const compact = compactSearchKey(raw);
  const clauses: Prisma.GalaxusOrderWhereInput[] = [];

  if (kind === "full_sku") {
    // Precise: full paste + ALL tokens on the same line (style AND colorway).
    clauses.push(lineIdentityContains(raw));
    if (compact.length >= 2 && compact !== raw.toLowerCase()) {
      // Compact rarely matches dashed DB values via SQL contains; keep for jammed SKUs.
      clauses.push(lineIdentityContains(compact));
    }
    const skuTokens = tokens.filter((t) => t.length >= 2);
    if (skuTokens.length >= 2) {
      clauses.push(lineIdentityHasAllTokens(skuTokens));
    } else if (skuTokens.length === 1) {
      clauses.push(lineIdentityContains(skuTokens[0]!));
    }
    return clauses;
  }

  if (kind === "model") {
    // "1130" / "FQ8144" → every matching product line (multi-result OK).
    clauses.push(lineIdentityContains(raw));
    if (compact !== foldLower(raw) && compact.length >= 2) {
      clauses.push(lineIdentityContains(compact));
    }
    return clauses;
  }

  if (kind === "order_id") {
    clauses.push(
      { galaxusOrderId: { contains: raw, mode: "insensitive" } },
      { orderNumber: { contains: raw, mode: "insensitive" } }
    );
    return clauses;
  }

  // text: "midnight", "asics gel", customer name, …
  clauses.push(
    { recipientName: { contains: raw, mode: "insensitive" } },
    { referencePerson: { contains: raw, mode: "insensitive" } },
    { customerName: { contains: raw, mode: "insensitive" } },
    { galaxusOrderId: { contains: raw, mode: "insensitive" } },
    { orderNumber: { contains: raw, mode: "insensitive" } },
    lineIdentityContains(raw)
  );

  const meaningful = tokens.filter((t) => t.length >= 3);
  if (meaningful.length >= 2) {
    // "asics 1130" / "gel midnight" → same line must carry every token.
    clauses.push(lineIdentityHasAllTokens(meaningful));
  } else {
    for (const t of meaningful) {
      if (t === foldLower(raw)) continue;
      clauses.push(lineIdentityContains(t));
    }
  }

  return clauses;
}

function foldLower(value: string): string {
  return value.trim().toLowerCase();
}

/** Catalog SKU resolve helps letter queries; also model digits via SupplierVariant. */
export function shouldResolveCatalogSku(q: string): boolean {
  const raw = q.trim();
  if (raw.length < 2) return false;
  const kind = classifyOrderListSearch(raw);
  return kind === "full_sku" || kind === "model" || kind === "text";
}
