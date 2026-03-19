import { NextResponse } from "next/server";
import { runImageSync } from "@/galaxus/jobs/imageSync";
import { prisma } from "@/app/lib/prisma";

function normalizeSupplierVariantId(value: string): string {
  const raw = value.trim();
  if (!raw) return raw;
  if (raw.toUpperCase().startsWith("STX_")) return `stx_${raw.slice(4)}`;
  return raw;
}

function looksLikeProviderKey(value: string): boolean {
  return /^[A-Za-z]{3}_[0-9]{8,14}$/.test(value.trim());
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const input = body?.supplierVariantId ? String(body.supplierVariantId) : undefined;
    const limit = body?.limit ? Math.max(1, Number(body.limit)) : 1;
    let supplierVariantId = input ? normalizeSupplierVariantId(input) : undefined;

    if (supplierVariantId && looksLikeProviderKey(supplierVariantId)) {
      const providerKey = supplierVariantId.toUpperCase();
      const found = await prisma.supplierVariant.findFirst({
        where: { providerKey },
        select: { supplierVariantId: true },
      });
      if (found?.supplierVariantId) {
        supplierVariantId = found.supplierVariantId;
      }
    }

    if (supplierVariantId && !looksLikeProviderKey(supplierVariantId)) {
      const found = await prisma.supplierVariant.findFirst({
        where: { supplierVariantId: { equals: supplierVariantId, mode: "insensitive" } },
        select: { supplierVariantId: true },
      });
      if (found?.supplierVariantId) {
        supplierVariantId = found.supplierVariantId;
      } else {
        return NextResponse.json(
          { ok: false, error: "Supplier variant not found for provided id" },
          { status: 404 }
        );
      }
    }

    const result = await runImageSync({
      supplierVariantId,
      limit,
      force: true,
    });
    return NextResponse.json({ ok: true, result });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error?.message ?? "Image sync failed" }, { status: 500 });
  }
}
