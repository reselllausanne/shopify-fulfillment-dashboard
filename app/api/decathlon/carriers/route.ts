import { NextResponse } from "next/server";
import { buildDecathlonOrdersClient } from "@/decathlon/mirakl/ordersClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function extractCarriers(payload: any): any[] {
  const raw = payload?.carriers ?? payload?.shipping_carriers ?? payload?.data ?? payload;
  return Array.isArray(raw) ? raw : [];
}

function normalizeText(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

export async function GET() {
  try {
    const client = buildDecathlonOrdersClient();
    const payload: any = await client.listCarriers();
    const carriers = extractCarriers(payload);
    const matches = carriers.filter((carrier) => {
      const code = normalizeText(carrier?.code ?? carrier?.carrier_code ?? carrier?.carrierCode);
      const label = normalizeText(carrier?.label ?? carrier?.carrier_label ?? carrier?.carrierLabel);
      const standard = normalizeText(
        carrier?.standard_code ?? carrier?.standardCode ?? carrier?.standard
      );
      return (
        code.includes("post") ||
        label.includes("post") ||
        label.includes("swiss") ||
        standard.includes("post")
      );
    });
    return NextResponse.json({ ok: true, carriers, matches });
  } catch (error: any) {
    console.error("[DECATHLON][CARRIERS] Failed", error);
    return NextResponse.json(
      { ok: false, error: error?.message ?? "Failed to list carriers" },
      { status: 500 }
    );
  }
}
