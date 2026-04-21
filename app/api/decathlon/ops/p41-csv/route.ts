import { prepareProductOnboarding } from "@/decathlon/mirakl/products";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Default ON (same as P41 upload with AI). Use `useAiEnrichment=0` for strict PM11-only CSV rows. */
function parseUseAiEnrichment(raw: string | null): boolean {
  const v = raw?.trim().toLowerCase();
  if (v === undefined || v === "") return true;
  if (v === "0" || v === "false" || v === "no") return false;
  return true;
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const limitRaw = searchParams.get("limit");
    const offsetRaw = searchParams.get("offset");
    const limitParsed = limitRaw ? Number.parseInt(limitRaw, 10) : NaN;
    const offsetParsed = offsetRaw ? Number.parseInt(offsetRaw, 10) : 0;
    const limit = Number.isFinite(limitParsed) && limitParsed > 0 ? limitParsed : undefined;
    const offset = Number.isFinite(offsetParsed) && offsetParsed >= 0 ? offsetParsed : 0;
    const useAiEnrichment = parseUseAiEnrichment(searchParams.get("useAiEnrichment"));

    const payload = await prepareProductOnboarding({ limit, offset, useAiEnrichment });
    const buffer = Buffer.from(payload.csv, "utf8");
    const stamp = new Date().toISOString().slice(0, 10);
    const filename = `decathlon-p41-products-${stamp}.csv`;

    return new Response(buffer, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${filename}"`,
        "content-length": String(buffer.length),
        "x-decathlon-p41-row-count": String(payload.rows.length),
      },
    });
  } catch (error: any) {
    console.error("[DECATHLON][OPS][P41-CSV] Failed", error);
    return new Response(JSON.stringify({ ok: false, error: error?.message ?? "P41 CSV build failed" }), {
      status: 500,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }
}
