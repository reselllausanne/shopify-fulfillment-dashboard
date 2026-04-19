import { NextResponse } from "next/server";
import { allocateSscc } from "@/galaxus/sscc/generator";
import { generateCustomSsccLabelPdf } from "@/galaxus/labels/ssccLabel";
import type { Address } from "@/galaxus/documents/types";
import {
  GALAXUS_SSCC_RECIPIENT_CITY,
  GALAXUS_SSCC_RECIPIENT_COUNTRY,
  GALAXUS_SSCC_RECIPIENT_LINE2,
  GALAXUS_SSCC_RECIPIENT_NAME,
  GALAXUS_SSCC_RECIPIENT_POSTAL_CODE,
  GALAXUS_SSCC_RECIPIENT_STREET,
  GALAXUS_SUPPLIER_ADDRESS_LINES,
  GALAXUS_SUPPLIER_NAME,
} from "@/galaxus/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parsePostalLine(line?: string) {
  if (!line) return { postalCode: "", city: "" };
  const parts = line.split(" ");
  const postalCode = parts.shift() ?? "";
  return { postalCode, city: parts.join(" ") };
}

function buildDefaultRecipient(): Address {
  return {
    name: GALAXUS_SSCC_RECIPIENT_NAME,
    line1: GALAXUS_SSCC_RECIPIENT_STREET,
    line2: GALAXUS_SSCC_RECIPIENT_LINE2,
    postalCode: GALAXUS_SSCC_RECIPIENT_POSTAL_CODE,
    city: GALAXUS_SSCC_RECIPIENT_CITY,
    country: GALAXUS_SSCC_RECIPIENT_COUNTRY,
    vatId: null,
  };
}

function buildDefaultSender(): Address {
  const [line1, postalLine, countryLine] = GALAXUS_SUPPLIER_ADDRESS_LINES;
  const { postalCode, city } = parsePostalLine(postalLine);
  return {
    name: GALAXUS_SUPPLIER_NAME,
    line1: line1 ?? "",
    line2: null,
    postalCode,
    city,
    country: countryLine ?? "",
    vatId: null,
  };
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const ssccInput = String(body?.sscc ?? "").trim();
    const sscc = ssccInput || (await allocateSscc());
    const shipmentId = body?.shipmentId ? String(body.shipmentId).trim() : "";
    const reference = body?.reference ? String(body.reference).trim() : "";
    const orderNumbersRaw = Array.isArray(body?.orderNumbers)
      ? body.orderNumbers
      : body?.orderNumbers
      ? [body.orderNumbers]
      : reference
      ? [reference]
      : [];
    const orderNumbers = orderNumbersRaw
      .map((value: any) => String(value).trim())
      .filter(Boolean);
    const sender: Address =
      body?.sender && typeof body.sender === "object"
        ? {
            name: String(body.sender.name ?? ""),
            line1: String(body.sender.line1 ?? ""),
            line2: body.sender.line2 ? String(body.sender.line2) : null,
            postalCode: String(body.sender.postalCode ?? ""),
            city: String(body.sender.city ?? ""),
            country: String(body.sender.country ?? ""),
            vatId: null,
          }
        : buildDefaultSender();
    const recipient: Address =
      body?.recipient && typeof body.recipient === "object"
        ? {
            name: String(body.recipient.name ?? ""),
            line1: String(body.recipient.line1 ?? ""),
            line2: body.recipient.line2 ? String(body.recipient.line2) : null,
            postalCode: String(body.recipient.postalCode ?? ""),
            city: String(body.recipient.city ?? ""),
            country: String(body.recipient.country ?? ""),
            vatId: null,
          }
        : buildDefaultRecipient();

    const widthMm = Number(body?.print?.widthMm);
    const heightMm = Number(body?.print?.heightMm);
    const rotate180 = Boolean(body?.print?.rotate180);
    const rotateDegrees = Number(body?.print?.rotateDegrees);
    const printOptions =
      Number.isFinite(widthMm) && widthMm > 0 && Number.isFinite(heightMm) && heightMm > 0
        ? {
            width: `${widthMm}mm`,
            height: `${heightMm}mm`,
            rotate180,
            rotateDegrees: Number.isFinite(rotateDegrees) ? rotateDegrees : undefined,
            marginTop: "0mm",
            marginRight: "0mm",
            marginBottom: "0mm",
            marginLeft: "0mm",
          }
        : undefined;

    const label = await generateCustomSsccLabelPdf({
      sscc,
      shipmentId,
      orderNumbers,
      sender,
      recipient,
      printOptions,
    });

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
