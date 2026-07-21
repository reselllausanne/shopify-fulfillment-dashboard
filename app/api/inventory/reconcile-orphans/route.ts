import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { checkSharedSecret } from "@/app/api/kickdb/auth";
import { importStxProductByInput } from "@/galaxus/stx/importProduct";
import { convergeVariant } from "@/shopify/inventory/convergence";
import { isManualOnlyGtin } from "@/shopify/inventory/manualOnlyGtins";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600;

/**
 * Phase 4 — orphan reconciliation.
 *
 * Physical stock in the mirror without a matching STX SupplierVariant means
 * marketplace feeds have nothing to attach the physical qty to (the resolver
 * merges into an existing STX row). This endpoint finds those orphans and,
 * when a KickDB match exists, imports the STX product with `forceImport: true`
 * so non-express clothing / one-off items get their row.
 *
 * Two modes:
 *   GET  → audit only, reports the orphan set + KickDB match candidates
 *   POST → same audit + attempts import for every match; runs convergence
 *          afterwards so the newly-imported STX row picks up the physical qty
 *          and enters liquidation state on the same call.
 *
 * Private-label GTINs (no KickDB match) stay Shopify-only by design; we skip
 * them and report them so the operator knows the marketplace won't see them.
 */

type OrphanRow = {
  gtin: string;
  physicalQty: number;
  preferredLocation: string | null;
  kickdbSlug: string | null;
  kickdbProductName: string | null;
  status: "matched" | "unmatched";
};

async function loadOrphans(): Promise<OrphanRow[]> {
  const rows = await prisma.$queryRaw<
    Array<{
      gtin: string;
      qty: bigint;
      loc: string | null;
      slug: string | null;
      product_name: string | null;
    }>
  >`
    WITH phys AS (
      SELECT s."gtin",
             SUM(s."available")::bigint AS qty,
             (ARRAY_AGG(s."locationName" ORDER BY s."priority" ASC))[1] AS loc
      FROM "public"."ShopifyVariantLocationStock" s
      WHERE s."sourceType" = 'physical'
        AND s."available" > 0
        AND s."gtin" IS NOT NULL
      GROUP BY s."gtin"
    ),
    with_supplier AS (
      SELECT DISTINCT sv."gtin" AS gtin
      FROM "public"."SupplierVariant" sv
      WHERE sv."supplierVariantId" LIKE 'stx\_%' ESCAPE '\\'
        AND sv."gtin" IS NOT NULL
    )
    SELECT p."gtin",
           p.qty,
           p.loc,
           kp."urlKey" AS slug,
           kp."name"   AS product_name
    FROM phys p
    LEFT JOIN with_supplier ws ON ws."gtin" = p."gtin"
    LEFT JOIN "public"."KickDBVariant" kv ON kv."gtin" = p."gtin"
    LEFT JOIN "public"."KickDBProduct" kp ON kp."id" = kv."productId"
    WHERE ws."gtin" IS NULL
    ORDER BY p.loc, p."gtin"
  `;
  return rows.map((r) => ({
    gtin: r.gtin,
    physicalQty: Number(r.qty ?? 0),
    preferredLocation: r.loc,
    kickdbSlug: r.slug,
    kickdbProductName: r.product_name,
    status: r.slug ? "matched" : "unmatched",
  }));
}

export async function GET(req: Request) {
  const authError = checkSharedSecret(req);
  if (authError) return authError;
  try {
    const orphans = await loadOrphans();
    const matched = orphans.filter((o) => o.status === "matched");
    const unmatched = orphans.filter((o) => o.status === "unmatched");
    return NextResponse.json({
      ok: true,
      mode: "audit",
      summary: {
        orphans: orphans.length,
        matched: matched.length,
        unmatched: unmatched.length,
        note: unmatched.length
          ? "Unmatched GTINs are private-label / not on KickDB. They stay Shopify-only (no marketplace publish)."
          : "All orphans matched to KickDB — ready to reconcile.",
      },
      matched,
      unmatched,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "audit_failed" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const authError = checkSharedSecret(req);
  if (authError) return authError;
  const startedAt = Date.now();
  try {
    const orphans = await loadOrphans();
    const manualOnly = orphans.filter((o) => isManualOnlyGtin(o.gtin));
    const matched = orphans.filter(
      (o) => o.status === "matched" && o.kickdbSlug && !isManualOnlyGtin(o.gtin)
    );
    const unmatched = orphans.filter((o) => o.status === "unmatched");

    const results: Array<{
      gtin: string;
      slug: string | null;
      imported: boolean;
      importedVariants: number;
      converged: boolean;
      convergeChanges?: string[];
      errors?: string[];
      warnings?: string[];
    }> = [];

    // Deduplicate by slug — one KickDB product can have many orphan sizes.
    const slugsSeen = new Set<string>();
    for (const orphan of matched) {
      const slug = orphan.kickdbSlug!;
      let importedVariants = 0;
      let importErrors: string[] = [];
      let importWarnings: string[] = [];
      const isFirstForSlug = !slugsSeen.has(slug);
      slugsSeen.add(slug);

      if (isFirstForSlug) {
        try {
          const res = await importStxProductByInput(slug, { forceImport: true });
          importedVariants = res.importedVariantsCount ?? 0;
          importErrors = res.errors ?? [];
          importWarnings = res.warnings ?? [];
        } catch (err: any) {
          importErrors = [err?.message ?? "import_failed"];
        }
      }

      // Even when we didn't call import again (slug already handled in this
      // loop), the new supplier row should now exist for this GTIN — run
      // convergence to lock its liquidation state.
      let converged = false;
      let convergeChanges: string[] | undefined;
      try {
        const conv = await convergeVariant(orphan.gtin);
        converged = conv.changed;
        convergeChanges = conv.changes;
        if (conv.warnings.length) importWarnings.push(...conv.warnings);
      } catch (err: any) {
        importErrors.push(`converge:${err?.message ?? err}`);
      }

      results.push({
        gtin: orphan.gtin,
        slug,
        imported: importedVariants > 0 || (isFirstForSlug && importErrors.length === 0),
        importedVariants,
        converged,
        convergeChanges,
        errors: importErrors.length ? importErrors : undefined,
        warnings: importWarnings.length ? importWarnings : undefined,
      });
    }

    return NextResponse.json({
      ok: true,
      mode: "reconcile",
      summary: {
        attempted: matched.length,
        distinctSlugs: slugsSeen.size,
        skippedPrivateLabel: unmatched.length,
        skippedManualOnly: manualOnly.length,
        ms: Date.now() - startedAt,
      },
      results,
      skippedPrivateLabel: unmatched.map((o) => ({
        gtin: o.gtin,
        physicalQty: o.physicalQty,
        location: o.preferredLocation,
      })),
      skippedManualOnly: manualOnly.map((o) => ({
        gtin: o.gtin,
        physicalQty: o.physicalQty,
        location: o.preferredLocation,
        reason: "manual_only_gtin",
      })),
    });
  } catch (e: any) {
    console.error("[reconcile-orphans] error", e);
    return NextResponse.json(
      { ok: false, error: e?.message ?? "reconcile_failed", ms: Date.now() - startedAt },
      { status: 500 }
    );
  }
}
