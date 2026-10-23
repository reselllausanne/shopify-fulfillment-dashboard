/**
 * Overwrite StxPurchaseUnit.stockxSettledAmount from StockX API settled
 * for linked buys whose unit OCR is above match API amount.
 *
 * Usage:
 *   npx tsx scripts/fix-unit-settled-from-api.ts 03-B23R8BR10J 03-DTKFF9ADUV ...
 */
import { prisma } from "@/app/lib/prisma";
import { readGalaxusStockxToken } from "@/lib/stockxGalaxusAuth";
import { refreshLinkedStxUnitsByStoredRefs } from "@/galaxus/stx/linkedUnitRefresh";

const EXPECTED_LIVE: Record<string, number> = {
  "03-B23R8BR10J": 135.27,
  "03-DTKFF9ADUV": 121.06,
  "01-C3BHZVESJB": 122.67,
  "01-ARFS6QHMFA": 140.24,
};

async function main() {
  const orderNumbers = process.argv.slice(2).filter(Boolean);
  if (!orderNumbers.length) {
    throw new Error("pass stockx order numbers");
  }

  const token = await readGalaxusStockxToken();
  if (!token) throw new Error("missing galaxus stockx token");

  const units = await (prisma as any).stxPurchaseUnit.findMany({
    where: { stockxOrderNumber: { in: orderNumbers } },
    select: {
      id: true,
      stockxOrderNumber: true,
      galaxusOrderId: true,
      stockxSettledAmount: true,
    },
  });
  if (!units.length) throw new Error("no units found");

  const byGalaxus = new Map<string, typeof units>();
  for (const u of units) {
    const gid = String(u.galaxusOrderId ?? "").trim();
    if (!gid) continue;
    const list = byGalaxus.get(gid) ?? [];
    list.push(u);
    byGalaxus.set(gid, list);
  }

  for (const [galaxusOrderId, list] of byGalaxus) {
    console.log(
      JSON.stringify({
        phase: "refresh",
        galaxusOrderId,
        units: list.map((u: any) => ({
          stockxOrderNumber: u.stockxOrderNumber,
          before: u.stockxSettledAmount != null ? Number(u.stockxSettledAmount) : null,
        })),
      })
    );
    const stats = await refreshLinkedStxUnitsByStoredRefs(token, galaxusOrderId);
    console.log(JSON.stringify({ phase: "stats", galaxusOrderId, stats }));
  }

  const after = await (prisma as any).stxPurchaseUnit.findMany({
    where: { stockxOrderNumber: { in: orderNumbers } },
    select: {
      stockxOrderNumber: true,
      stockxSettledAmount: true,
      stockxSettledCurrency: true,
    },
  });
  const matches = await (prisma as any).galaxusStockxMatch.findMany({
    where: { stockxOrderNumber: { in: orderNumbers } },
    select: { stockxOrderNumber: true, stockxAmount: true, stockxCurrencyCode: true },
  });
  const matchByNum = new Map(
    matches.map((m: any) => [String(m.stockxOrderNumber), Number(m.stockxAmount)])
  );

  let ok = true;
  for (const u of after) {
    const num = String(u.stockxOrderNumber);
    const unitSettled = u.stockxSettledAmount != null ? Number(u.stockxSettledAmount) : null;
    const matchAmount = matchByNum.get(num) ?? null;
    const expected = EXPECTED_LIVE[num] ?? null;
    const row = {
      stockxOrderNumber: num,
      unitSettled,
      matchAmount,
      expected,
      unitOk: expected == null || (unitSettled != null && Math.abs(unitSettled - expected) < 0.02),
      matchOk: expected == null || (matchAmount != null && Math.abs(matchAmount - expected) < 0.02),
      aligned:
        unitSettled != null && matchAmount != null && Math.abs(unitSettled - matchAmount) < 0.02,
    };
    if (!row.unitOk || !row.matchOk || !row.aligned) ok = false;
    console.log(JSON.stringify({ phase: "verify", ...row }));
  }

  if (!ok) {
    process.exitCode = 1;
    throw new Error("verify failed: unit/match not all live");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => null);
  });
