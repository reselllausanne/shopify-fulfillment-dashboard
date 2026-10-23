/**
 * Regenerate DELIVERY_NOTE + LABEL PDFs for a shipment.
 *
 *   npx tsx scripts/regen-shipment-docs.ts <shipmentId>
 */
import "dotenv/config";
import { DocumentType } from "@prisma/client";
import { DocumentService } from "@/galaxus/documents/DocumentService";

async function main() {
  const shipmentId = process.argv[2];
  if (!shipmentId) throw new Error("Usage: regen-shipment-docs.ts <shipmentId>");

  const service = new DocumentService();
  const docs = await service.generateForShipment({
    shipmentId,
    types: [DocumentType.DELIVERY_NOTE, DocumentType.LABEL],
  });
  console.log(
    "Generated:",
    docs.map((d) => `${d.type} v${d.version} -> ${d.storageUrl}`).join("\n")
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
