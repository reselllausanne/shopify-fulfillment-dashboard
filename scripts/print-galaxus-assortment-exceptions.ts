/**
 * Plain-text dump of Galaxus assortment gate exceptions (Tali mail body).
 *
 *   npx tsx scripts/print-galaxus-assortment-exceptions.ts
 *   npx tsx scripts/print-galaxus-assortment-exceptions.ts --include-inactive
 */
import { formatGalaxusAssortmentExceptionsMail } from "@/galaxus/exports/galaxusAssortmentExceptions";

const includeInactive = process.argv.includes("--include-inactive");
process.stdout.write(formatGalaxusAssortmentExceptionsMail({ includeInactive }));
process.stdout.write("\n");
