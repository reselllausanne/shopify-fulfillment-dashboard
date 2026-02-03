import { NextResponse } from "next/server";
import { createGoldenSupplierClient } from "@/galaxus/supplier/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = Math.min(Number(searchParams.get("limit") ?? "50"), 500);

    const client = createGoldenSupplierClient();
    const items = await client.fetchCatalog();
    const sliced = items.slice(0, limit).map((item) => ({
      supplierVariantId: item.supplierVariantId,
      supplierSku: item.supplierSku,
      price: item.price,
      stock: item.stock,
      sizeRaw: item.sizeRaw,
      images: item.images,
      productName: item.sourcePayload.product_name,
      brand: item.sourcePayload.brand_name,
      sizeUs: item.sourcePayload.size_us,
      sizeEu: item.sourcePayload.size_eu,
      barcode: item.sourcePayload.barcode,
    }));

    return NextResponse.json({ ok: true, total: items.length, items: sliced });
  } catch (error: any) {
    console.error("[GALAXUS][SUPPLIER][PREVIEW] Failed:", error);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}
