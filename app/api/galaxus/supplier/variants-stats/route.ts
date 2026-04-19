import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const [total, withGtin, withoutGtin] = await Promise.all([
    prisma.variantMapping.count(),
    prisma.variantMapping.count({ where: { gtin: { not: null } } }),
    prisma.variantMapping.count({ where: { gtin: null } }),
  ]);

  return NextResponse.json({
    ok: true,
    stats: { total, withGtin, withoutGtin },
  });
}

