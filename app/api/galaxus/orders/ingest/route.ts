import { NextResponse } from "next/server";
import { ingestGalaxusOrders } from "@/galaxus/orders/ingest";
import type { GalaxusOrderInput } from "@/galaxus/orders/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type IngestBody = {
  orders?: GalaxusOrderInput[];
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as IngestBody;
    const orders = body.orders ?? [];
    const results = await ingestGalaxusOrders(orders);
    return NextResponse.json({ ok: true, results });
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        error: error?.message ?? "Failed to ingest Galaxus orders.",
      },
      { status: 400 }
    );
  }
}
