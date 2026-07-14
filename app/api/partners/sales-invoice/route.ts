import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { getPartnerSession } from "@/app/lib/partnerAuth";
import { renderPdfFromHtml } from "@/galaxus/documents/renderers/playwrightRenderer";
import {
  buildPartnerSalesInvoice,
  partnerSalesInvoiceToCsv,
  partnerSalesInvoiceToHtml,
} from "@/galaxus/partners/partnerSalesInvoice";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/partners/sales-invoice?date=YYYY-MM-DD&format=csv|pdf|json
 * Partner sales report for one day (Galaxus order date, Europe/Zurich).
 * Product fields from Galaxus order lines only.
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getPartnerSession(req);
    if (!session) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const date = (searchParams.get("date") ?? "").trim();
    const format = (searchParams.get("format") ?? "json").trim().toLowerCase();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json(
        { ok: false, error: "date is required (YYYY-MM-DD)" },
        { status: 400 }
      );
    }
    if (!["json", "csv", "pdf"].includes(format)) {
      return NextResponse.json(
        { ok: false, error: 'format must be "json", "csv", or "pdf"' },
        { status: 400 }
      );
    }

    const partner = await prisma.partner.findUnique({
      where: { id: session.partnerId },
      select: { name: true, key: true },
    });

    const invoice = await buildPartnerSalesInvoice({
      partnerKey: session.partnerKey,
      partnerName: partner?.name ?? session.partnerKey,
      date,
    });

    const baseName = `partner-sales-${invoice.partnerKey.toLowerCase()}-${date}`;

    if (format === "csv") {
      const csv = partnerSalesInvoiceToCsv(invoice);
      return new NextResponse(csv, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${baseName}.csv"`,
        },
      });
    }

    if (format === "pdf") {
      const html = partnerSalesInvoiceToHtml(invoice);
      const pdf = await renderPdfFromHtml({ html, format: "A4", showPageNumbers: false });
      return new NextResponse(new Uint8Array(pdf), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="${baseName}.pdf"`,
        },
      });
    }

    return NextResponse.json({ ok: true, invoice });
  } catch (error: unknown) {
    console.error("[PARTNERS][SALES-INVOICE] Failed:", error);
    const message = error instanceof Error ? error.message : "Failed to build sales invoice";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
