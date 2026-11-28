/**
 * One-shot: reopen Galaxus DD order 210305079 after the wrong item (Salomon) shipped.
 * Marks shipment SUPERSEDED_WRONG_ITEM (audit kept), voids DELR EdiFile row, blocks new line-based INVO.
 * Sends NOTHING to Galaxus / Swiss Post.
 *
 *   npx tsx scripts/reopen-galaxus-wrong-item-210305079.ts          # dry-run
 *   npx tsx scripts/reopen-galaxus-wrong-item-210305079.ts --apply
 */
import { supersedeWrongItemShipment } from "@/galaxus/warehouse/supersedeWrongItemShipment";

async function main() {
  const res = await supersedeWrongItemShipment({
    shipmentId: "85b03ae9-9212-4a66-b45e-f795b7c000cd",
    reason: "Customer received Salomon XT-6 (EAN 0198720517202, NER_198720517202) instead of Nike x Jacquemus France jersey S",
    ticket: "26530931",
    blockInvoice: true,
    dryRun: !process.argv.includes("--apply"),
  });
  console.log(JSON.stringify(res, null, 2));
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
