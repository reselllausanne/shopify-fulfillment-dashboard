import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { checkSharedSecret } from "@/app/api/kickdb/auth";
import { loadPhysicalMirrorStockByGtin } from "@/shopify/inventory/physicalAvailability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/inventory/physical-diff
 *
 * Read-only preview of what the Phase 2 resolver WOULD change if the
 * `RESOLVER_MERGE_PHYSICAL` flag were flipped ON. No feed writes, no mutations.
 *
 * Shows, per GTIN present in the physical mirror:
 *   - physical qty (Σ Bussigny/Antica/Bienne)
 *   - which STX/THE SupplierVariant rows exist for the same GTIN (feed impact)
 *   - the preferred location (lowest priority number).
 *
 * Purpose: sanity-check the additive merge before flipping the flag, and spot
 * GTIN collisions where both a THE_ and STX_ row exist (double-count risk pre
 * THE_ purge migration).
 */
export async function GET(req: Request) {
  const authError = checkSharedSecret(req);
  if (authError) return authError;

  const { searchParams } = new URL(req.url);
  const limit = Math.min(Math.max(Number(searchParams.get("limit") ?? 200), 1), 5000);

  try {
    const mirrorGtins = await prisma.$queryRaw<Array<{ gtin: string }>>`
      SELECT DISTINCT s."gtin"
      FROM "public"."ShopifyVariantLocationStock" s
      WHERE s."sourceType" = 'physical'
        AND s."available" > 0
        AND s."gtin" IS NOT NULL
      LIMIT ${limit}
    `;
    const gtins = mirrorGtins.map((r) => r.gtin).filter(Boolean);

    if (gtins.length === 0) {
      return NextResponse.json({ ok: true, rows: [], summary: { gtins: 0, withSupplier: 0, collisions: 0 } });
    }

    const physical = await loadPhysicalMirrorStockByGtin(gtins);

    const suppliersRaw = await prisma.$queryRaw<
      Array<{ gtin: string; supplierVariantId: string; providerKey: string | null; stock: number | null }>
    >`
      SELECT sv."gtin" AS gtin,
             sv."supplierVariantId" AS "supplierVariantId",
             sv."providerKey" AS "providerKey",
             sv."stock" AS stock
      FROM "public"."SupplierVariant" sv
      WHERE sv."gtin" = ANY(${gtins}::text[])
    `;

    // Supplier "key" is derived from the supplierVariantId prefix. Format is
    // `<key>_<rest>` for STX/NER/... and `<key>:<rest>` for THE clothing rows
    // (e.g. `the:T-SHIRTESS-M`). Split on the first `_` or `:` — whichever
    // comes first.
    const deriveKey = (id: string): string => {
      const s = String(id ?? "").toLowerCase();
      const u = s.indexOf("_");
      const c = s.indexOf(":");
      const positives = [u, c].filter((n) => n > 0);
      if (positives.length === 0) return s;
      return s.slice(0, Math.min(...positives));
    };

    type SupplierRow = (typeof suppliersRaw)[number] & { key: string };
    const suppliers: SupplierRow[] = suppliersRaw.map((s) => ({ ...s, key: deriveKey(s.supplierVariantId) }));

    const byGtin = new Map<string, SupplierRow[]>();
    for (const s of suppliers) {
      const arr = byGtin.get(s.gtin) ?? [];
      arr.push(s);
      byGtin.set(s.gtin, arr);
    }

    let withSupplier = 0;
    let collisions = 0;

    const rows = gtins.map((gtin) => {
      const p = physical.get(gtin);
      const supplierList = byGtin.get(gtin) ?? [];
      const supplierKeys = new Set(supplierList.map((s) => s.key));
      const hasStx = supplierKeys.has("stx");
      const hasThe = supplierKeys.has("the");
      if (supplierList.length > 0) withSupplier += 1;
      if (hasStx && hasThe) collisions += 1;
      return {
        gtin,
        physicalQty: p?.qty ?? 0,
        preferredLocation: p?.preferredLocationName ?? null,
        suppliers: supplierList.map((s) => ({
          key: s.key,
          providerKey: s.providerKey,
          supplierVariantId: s.supplierVariantId,
          stock: s.stock,
        })),
        collision_stx_and_the: hasStx && hasThe,
      };
    });

    return NextResponse.json({
      ok: true,
      summary: {
        gtins: gtins.length,
        withSupplier,
        collisions,
        note: collisions > 0
          ? "STX+THE collisions exist. Run the THE_ purge migration before flipping RESOLVER_MERGE_PHYSICAL, else physical qty risks double counting on non-winning row."
          : "No STX+THE collisions among stocked physical GTINs.",
      },
      rows,
    });
  } catch (e: any) {
    console.error("[inventory/physical-diff] error", e);
    return NextResponse.json({ ok: false, error: e?.message ?? "failed" }, { status: 500 });
  }
}
