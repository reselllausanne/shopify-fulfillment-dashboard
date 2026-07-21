import { NextResponse } from "next/server";
import { readShopifyReturnLabelFile } from "@/shopify/returns/label";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ key: string }> };

export async function GET(_request: Request, { params }: Params) {
  try {
    const { key } = await params;
    const file = await readShopifyReturnLabelFile(key);
    const filename = String(key || "return-label.pdf");
    const body = new Uint8Array(file.content);
    return new NextResponse(body, {
      status: 200,
      headers: {
        "content-type": file.mimeType,
        "content-disposition": `inline; filename="${filename}"`,
        "cache-control": "private, max-age=3600",
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: "LABEL_NOT_FOUND", message: error?.message ?? "Label not found" },
      { status: 404 }
    );
  }
}
