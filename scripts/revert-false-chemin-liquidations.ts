/**
 * One-off repair: undo liquidations that were triggered by Chemin (dropship pool) qty.
 *
 * Convergence briefly treated `homeQty > 0` at the online location as owned home stock.
 * Every StockX-listed size sits at Chemin qty 1, so variants we do not physically own
 * were locked (manualLock) at soldes prices with a compareAt marker.
 *
 * Repair per GTIN: clear the DB lock, then run convergence with forceDropship so the
 * existing dropship path unlocks `custom.price_locked`, restores the market price and
 * clears the stale compareAt.
 *
 * Usage: npx tsx scripts/revert-false-chemin-liquidations.ts [--dry-run]
 */
import { prisma } from "@/app/lib/prisma";
import { convergeVariant } from "@/shopify/inventory/convergence";

const DRY_RUN = process.argv.includes("--dry-run");

async function main() {
  const rows = await prisma.supplierVariant.findMany({
    where: { manualNote: { startsWith: "phase4:liquidation home=" } },
    select: {
      id: true,
      supplierVariantId: true,
      gtin: true,
      manualNote: true,
      manualPrice: true,
      manualLock: true,
    },
  });

  // Only the ones with no warehouse stock behind them are false positives.
  const targets = rows.filter((row) => /bussigny=0/.test(String(row.manualNote ?? "")));
  console.log(
    `[revert] home-note variants=${rows.length} false-liquidations=${targets.length} dryRun=${DRY_RUN}`
  );

  let unlocked = 0;
  let converged = 0;
  const failures: Array<{ gtin: string | null; error: string }> = [];

  for (const row of targets) {
    const gtin = String(row.gtin ?? "").trim();
    console.log(
      `[revert] ${gtin || row.supplierVariantId} lock=${row.manualLock} soldesPrice=${String(row.manualPrice)}`
    );
    if (DRY_RUN) continue;

    try {
      await prisma.supplierVariant.update({
        where: { id: row.id },
        data: {
          manualLock: false,
          manualPrice: null,
          manualStock: null,
          manualUpdatedAt: new Date(),
          manualNote: "phase4:dropship revert-false-chemin-liquidation",
        },
      });
      unlocked += 1;
    } catch (err: any) {
      failures.push({ gtin, error: `db unlock: ${err?.message ?? err}` });
      continue;
    }

    if (!gtin) continue;
    try {
      const res = await convergeVariant(gtin, { forceDropship: true });
      converged += 1;
      console.log(
        `[revert] ${gtin} changes=${JSON.stringify(res.changes)} warnings=${JSON.stringify(res.warnings)}`
      );
    } catch (err: any) {
      failures.push({ gtin, error: `converge: ${err?.message ?? err}` });
    }
  }

  console.log(`[revert] done unlocked=${unlocked} converged=${converged} failures=${failures.length}`);
  if (failures.length) console.log(JSON.stringify(failures, null, 1));
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("[revert] fatal", err);
  await prisma.$disconnect();
  process.exit(1);
});
