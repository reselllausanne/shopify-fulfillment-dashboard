import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseSupplierKeyFilter(input: string): string | null {
  const trimmed = String(input ?? "").trim();
  if (!trimmed) return null;
  const cleaned = trimmed.replace(/[:_]+$/g, "");
  if (!cleaned) return null;
  if (/^[A-Za-z0-9]{2,10}$/.test(cleaned)) return cleaned.toLowerCase();
  return null;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const limit = Math.min(Math.max(Number(searchParams.get("limit") ?? "200"), 1), 500);
  const offset = Math.max(Number(searchParams.get("offset") ?? "0"), 0);
  const supplier = (searchParams.get("supplier") ?? "").trim();
  const q = (searchParams.get("q") ?? "").trim();
  const supplierKeyParam = parseSupplierKeyFilter(searchParams.get("supplierKey") ?? "");

  const where: Record<string, unknown> = {};
  if (supplier) {
    where.supplierVariantId = { startsWith: `${supplier}:`, mode: "insensitive" };
  }
  if (supplierKeyParam) {
    where.AND = [
      {
        OR: [
          { supplierVariantId: { startsWith: `${supplierKeyParam}:`, mode: "insensitive" } },
          { supplierVariantId: { startsWith: `${supplierKeyParam}_`, mode: "insensitive" } },
          { providerKey: { startsWith: `${supplierKeyParam.toUpperCase()}_`, mode: "insensitive" } },
        ],
      },
    ];
  }
  if (q) {
    const qAsSupplierKey = q.endsWith("_") || q.endsWith(":") ? parseSupplierKeyFilter(q) : null;
    if (qAsSupplierKey) {
      const existingAnd = Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : [];
      where.AND = [
        ...existingAnd,
        {
          OR: [
            { supplierVariantId: { startsWith: `${qAsSupplierKey}:`, mode: "insensitive" } },
            { supplierVariantId: { startsWith: `${qAsSupplierKey}_`, mode: "insensitive" } },
            { providerKey: { startsWith: `${qAsSupplierKey.toUpperCase()}_`, mode: "insensitive" } },
          ],
        },
      ];
    } else {
      where.OR = [
        { supplierVariantId: { contains: q, mode: "insensitive" } },
        { providerKey: { contains: q, mode: "insensitive" } },
        { gtin: { contains: q, mode: "insensitive" } },
        { supplierSku: { contains: q, mode: "insensitive" } },
        { supplierProductName: { contains: q, mode: "insensitive" } },
      ];
    }
  }

  const rows = await (prisma as any).supplierVariant.findMany({
    where,
    include: {
      mappings: {
        include: {
          kickdbVariant: { include: { product: true } },
        },
      },
    },
    orderBy: { updatedAt: "desc" },
    take: limit,
    skip: offset,
  });

  const nextOffset = rows.length === limit ? offset + limit : null;
  return NextResponse.json({ ok: true, items: rows, nextOffset });
}

