import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { getStorageAdapterForUrl } from "@/galaxus/storage/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_TYPES = new Set(["products", "offers", "prices", "stock"]);
const FILE_NAMES: Record<string, string> = {
  products: "products-fr_CH.xlsx",
  offers: "offers-fr_CH.xlsx",
  prices: "prices-fr_CH.xlsx",
  stock: "stock-fr_CH.xlsx",
};

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const runId = searchParams.get("runId")?.trim();
    const type = searchParams.get("type")?.trim();
    if (!runId || !type || !VALID_TYPES.has(type)) {
      return NextResponse.json({ ok: false, error: "Invalid runId or type" }, { status: 400 });
    }

    const prismaAny = prisma as any;
    const file = await prismaAny.decathlonExportFile.findFirst({
      where: { runId, fileType: type },
    });
    if (!file || !file.storageUrl) {
      return NextResponse.json({ ok: false, error: "File not found" }, { status: 404 });
    }

    const storage = getStorageAdapterForUrl(file.storageUrl);
    const blob = await storage.getPdf(file.storageUrl);
    const filename = FILE_NAMES[type] ?? `decathlon-${type}-${runId}.xlsx`;
    return new Response(blob.content as unknown as BodyInit, {
      headers: {
        "content-type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition": `attachment; filename="${filename}"`,
        "content-length": String(blob.content.length ?? 0),
      },
    });
  } catch (error: any) {
    console.error("[DECATHLON][EXPORT] Download failed", error);
    return NextResponse.json(
      { ok: false, error: error?.message ?? "Download failed" },
      { status: 500 }
    );
  }
}
