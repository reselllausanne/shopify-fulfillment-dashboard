import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { getPartnerSession } from "@/app/lib/partnerAuth";
import { normalizeProviderKey } from "@/galaxus/supplier/providerKey";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function pickString(value: unknown): string {
  return String(value ?? "").trim();
}

function normalizeCountryCode(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const upper = raw.toUpperCase();
  if (/^[A-Z]{2}$/.test(upper)) return upper;
  const iso3: Record<string, string> = { CHE: "CH", DEU: "DE", FRA: "FR", ITA: "IT", AUT: "AT" };
  if (iso3[upper]) return iso3[upper];
  const lower = raw.toLowerCase();
  if (["schweiz", "suisse", "svizzera", "switzerland", "swiss"].includes(lower)) return "CH";
  if (["deutschland", "germany"].includes(lower)) return "DE";
  if (["france"].includes(lower)) return "FR";
  if (["italy", "italia"].includes(lower)) return "IT";
  if (["austria", "österreich", "osterreich"].includes(lower)) return "AT";
  return null;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ orderId: string }> }
) {
  try {
    const { orderId } = await params;
    const body = await request.json().catch(() => ({}));
    const order =
      (await prisma.decathlonOrder.findUnique({
        where: { id: orderId },
        include: { lines: true },
      })) ??
      (await prisma.decathlonOrder.findUnique({
        where: { orderId },
        include: { lines: true },
      }));
    if (!order) {
      return NextResponse.json({ ok: false, error: "Order not found" }, { status: 404 });
    }

    const partnerSession = await getPartnerSession(request);
    const partnerKey = normalizeProviderKey(partnerSession?.partnerKey ?? null);
    if (partnerSession && partnerKey) {
      const orderKey = normalizeProviderKey(order.partnerKey ?? null);
      const lineMatch = (order.lines ?? []).some((line: any) =>
        String(line.offerSku ?? "").toUpperCase().startsWith(`${partnerKey}_`)
      );
      if (orderKey && orderKey !== partnerKey && !lineMatch) {
        return NextResponse.json({ ok: false, error: "Order not found" }, { status: 404 });
      }
    }

    const recipientName = pickString(body.recipientName);
    const recipientAddress1 = pickString(body.recipientAddress1);
    const recipientAddress2 = pickString(body.recipientAddress2);
    const recipientPostalCode = pickString(body.recipientPostalCode);
    const recipientCity = pickString(body.recipientCity);
    const recipientEmail = pickString(body.recipientEmail);
    const recipientPhone = pickString(body.recipientPhone);
    const recipientCountryCode =
      normalizeCountryCode(body.recipientCountryCode ?? body.recipientCountry) ?? null;
    const recipientCountry =
      pickString(body.recipientCountry) || recipientCountryCode || "";

    if (!recipientName || !recipientAddress1 || !recipientPostalCode || !recipientCity) {
      return NextResponse.json(
        {
          ok: false,
          error: "Recipient name, address, postal code, and city are required.",
        },
        { status: 400 }
      );
    }

    const updated = await prisma.decathlonOrder.update({
      where: { id: order.id },
      data: {
        recipientName,
        recipientAddress1,
        recipientAddress2: recipientAddress2 || null,
        recipientPostalCode,
        recipientCity,
        recipientCountry: recipientCountry || null,
        recipientCountryCode: recipientCountryCode || null,
        recipientEmail: recipientEmail || null,
        recipientPhone: recipientPhone || null,
        recipientAddressLocked: true,
      },
    });

    return NextResponse.json({ ok: true, order: updated });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message ?? "Failed to update address" },
      { status: 500 }
    );
  }
}
