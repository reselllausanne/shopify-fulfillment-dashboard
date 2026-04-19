import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { parseCsv } from "@/app/lib/csv";
import { toNumberSafe } from "@/app/utils/numbers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CHANNELS = ["SHOPIFY", "GALAXUS", "DECATHLON"] as const;
type MarketplaceChannel = (typeof CHANNELS)[number];

function normalizeChannel(value: string | null | undefined): MarketplaceChannel | null {
  if (!value) return null;
  const upper = value.trim().toUpperCase();
  return CHANNELS.includes(upper as MarketplaceChannel) ? (upper as MarketplaceChannel) : null;
}

function getCell(row: string[], map: Map<string, number>, keys: string[]) {
  for (const key of keys) {
    const idx = map.get(key);
    if (idx !== undefined) return row[idx]?.trim() ?? "";
  }
  return "";
}

export async function POST(req: NextRequest) {
  try {
    const contentType = req.headers.get("content-type") || "";
    let csvText = "";
    let sourceFile: string | null = null;

    if (contentType.includes("multipart/form-data")) {
      const formData = await req.formData();
      const file = formData.get("file") as File | null;
      if (!file) {
        return NextResponse.json({ error: "CSV file required" }, { status: 400 });
      }
      sourceFile = file.name || null;
      csvText = await file.text();
    } else {
      csvText = await req.text();
    }

    if (!csvText.trim()) {
      return NextResponse.json({ error: "CSV is empty" }, { status: 400 });
    }

    const rows = parseCsv(csvText);
    if (rows.length < 2) {
      return NextResponse.json({ error: "CSV must include a header + data rows" }, { status: 400 });
    }

    const headers = rows[0].map((value) => value.trim());
    const headerMap = new Map(headers.map((value, index) => [value, index]));

    const errors: Array<{ row: number; message: string }> = [];
    const records: Array<{
      channel: MarketplaceChannel;
      paidAt: Date;
      amountChf: number;
      currencyCode: string;
      reference: string | null;
      sourceFile: string | null;
    }> = [];

    for (let i = 1; i < rows.length; i += 1) {
      const row = rows[i];
      if (!row.length || row.every((cell) => !cell.trim())) continue;

      const channelRaw = getCell(row, headerMap, ["channel", "marketplace"]);
      const channel = normalizeChannel(channelRaw);
      if (!channel) {
        errors.push({ row: i + 1, message: "Invalid channel" });
        continue;
      }

      const paidAtRaw = getCell(row, headerMap, ["paidAt", "paid_at", "date"]);
      const paidAt = paidAtRaw ? new Date(paidAtRaw) : null;
      if (!paidAt || isNaN(paidAt.getTime())) {
        errors.push({ row: i + 1, message: "Invalid paidAt date" });
        continue;
      }

      const amountRaw = getCell(row, headerMap, ["amountChf", "amount", "netAmount", "net"]);
      const normalizedAmount = amountRaw.replace(",", ".");
      const amountChf = toNumberSafe(normalizedAmount, 0);
      if (!amountChf) {
        errors.push({ row: i + 1, message: "Invalid amountChf" });
        continue;
      }

      const currencyCode =
        getCell(row, headerMap, ["currencyCode", "currency"]).toUpperCase() || "CHF";
      const reference = getCell(row, headerMap, ["reference", "ref", "payoutId", "invoice"]) || null;

      records.push({
        channel,
        paidAt,
        amountChf,
        currencyCode,
        reference,
        sourceFile,
      });
    }

    if (errors.length) {
      return NextResponse.json(
        { error: "CSV validation failed", errors: errors.slice(0, 20), totalErrors: errors.length },
        { status: 400 }
      );
    }

    const result = await prisma.marketplaceRemittance.createMany({
      data: records,
    });

    return NextResponse.json({
      success: true,
      inserted: result.count,
      sourceFile,
    });
  } catch (error: any) {
    console.error("[CASHFLOW/REMITTANCES] Import error:", error);
    return NextResponse.json(
      { error: "Failed to import remittances", details: error.message },
      { status: 500 }
    );
  }
}
