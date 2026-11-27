import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const q = String(req.nextUrl.searchParams.get("q") || "")
    .trim()
    .toLowerCase();
  const [rows, scans] = await Promise.all([
    prisma.aubonneStoreStock.findMany({
      where: q
        ? {
            OR: [
              { styleColor: { contains: q, mode: "insensitive" } },
              { name: { contains: q, mode: "insensitive" } },
            ],
          }
        : undefined,
      orderBy: [{ styleColor: "asc" }, { sizeEu: "asc" }],
    }),
    prisma.aubonneScanState.findMany(),
  ]);

  const byStyle = new Map<
    string,
    {
      styleColor: string;
      name: string | null;
      imageUrl: string | null;
      lastCheckedAt: string;
      sizes: { gtin: string; sizeEu: string | null; level: string; nikeModifiedAt: string | null }[];
    }
  >();
  for (const row of rows) {
    let card = byStyle.get(row.styleColor);
    if (!card) {
      card = {
        styleColor: row.styleColor,
        name: row.name,
        imageUrl: row.imageUrl,
        lastCheckedAt: row.lastCheckedAt.toISOString(),
        sizes: [],
      };
      byStyle.set(row.styleColor, card);
    }
    if (row.lastCheckedAt.toISOString() > card.lastCheckedAt) {
      card.lastCheckedAt = row.lastCheckedAt.toISOString();
    }
    card.sizes.push({
      gtin: row.gtin,
      sizeEu: row.sizeEu,
      level: row.level,
      nikeModifiedAt: row.nikeModifiedAt ? row.nikeModifiedAt.toISOString() : null,
    });
  }

  const styles = [...byStyle.values()]
    .filter((card) => card.sizes.some((s) => s.level !== "OOS"))
    .sort((a, b) => (a.name || a.styleColor).localeCompare(b.name || b.styleColor));

  return NextResponse.json({
    styles,
    inStock: styles.length,
    scans: scans.map((s) => ({
      id: s.id,
      startedAt: s.startedAt,
      finishedAt: s.finishedAt,
      cursor: s.cursor,
      total: s.total,
      found: s.found,
      errors: s.errors,
    })),
  });
}
