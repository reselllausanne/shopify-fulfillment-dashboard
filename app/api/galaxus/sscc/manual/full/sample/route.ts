import { NextResponse } from "next/server";
import { generateCustomSsccLabelPdf } from "@/galaxus/labels/ssccLabel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const widthMm = Number(searchParams.get("widthMm") ?? "100");
    const heightMm = Number(searchParams.get("heightMm") ?? "62");
    const rotate180 = String(searchParams.get("rotate180") ?? "1") !== "0";

    const label = await generateCustomSsccLabelPdf({
      sscc: "7609999696800141",
      shipmentId: "SAMPLE-4350051",
      orderNumbers: ["SAMPLE-180774081"],
      sender: {
        name: "Sample Sender",
        line1: "Sample street 1",
        line2: null,
        postalCode: "1000",
        city: "Lausanne",
        country: "Switzerland",
        vatId: null,
      },
      recipient: {
        name: "Digitec Galaxus AG",
        line1: "Dock A19 - A39",
        line2: "Ferroring 23",
        postalCode: "CH-5612",
        city: "Villmergen",
        country: "Schweiz",
        vatId: null,
      },
      printOptions: {
        width: `${Number.isFinite(widthMm) && widthMm > 0 ? widthMm : 100}mm`,
        height: `${Number.isFinite(heightMm) && heightMm > 0 ? heightMm : 62}mm`,
        rotate180,
        marginTop: "0mm",
        marginRight: "0mm",
        marginBottom: "0mm",
        marginLeft: "0mm",
      },
    });

    return new Response(label.pdf as unknown as BodyInit, {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `inline; filename="sscc-sample-${widthMm}x${heightMm}.pdf"`,
        "x-sscc": label.sscc,
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message ?? "Sample SSCC label failed" },
      { status: 500 }
    );
  }
}
