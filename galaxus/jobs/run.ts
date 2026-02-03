import { runJob } from "./jobRunner";
import { runCatalogSync } from "./catalogSync";
import { runStockSync } from "./stockSync";

export async function runSupplierSync() {
  const catalog = await runJob("catalog-sync", runCatalogSync);
  const stock = await runJob("stock-sync", runStockSync);
  return { catalog, stock };
}

void runSupplierSync();
