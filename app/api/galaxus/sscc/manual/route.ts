import { NextResponse } from "next/server";
import { allocateSscc } from "@/galaxus/sscc/generator";
import { generateBasicSsccLabelPdf } from "@/galaxus/labels/ssccLabel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const sscc = String(searchParams.get("sscc") ?? "").trim();
    if (!sscc) {
      return NextResponse.json({ ok: false, error: "sscc is required" }, { status: 400 });
    }
    const label = await generateBasicSsccLabelPdf(sscc);
    return new Response(label.pdf as unknown as BodyInit, {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `inline; filename="sscc-${label.sscc}.pdf"`,
        "x-sscc": label.sscc,
      },
    });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error?.message ?? "SSCC label failed" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const ssccInput = String(body?.sscc ?? "").trim();
    const sscc = ssccInput || (await allocateSscc());
    const url = `/api/galaxus/sscc/manual?sscc=${encodeURIComponent(sscc)}`;
    return NextResponse.json({
      ok: true,
      sscc,
      url,
      reference: body?.reference ?? null,
      shipmentId: body?.shipmentId ?? null,
    });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error?.message ?? "SSCC label failed" }, { status: 500 });
  }
}
