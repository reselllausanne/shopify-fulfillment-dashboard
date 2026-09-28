import "dotenv/config";
import { writeFileSync } from "node:fs";
import { GET as getStock } from "../app/api/galaxus/export/stock/route";
import { GET as getOffer } from "../app/api/galaxus/export/offer/route";

function keysFromCsv(csv: string): Set<string> {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim());
  const keys = new Set<string>();
  for (const line of lines.slice(1)) {
    const first = line.split(",")[0]?.replace(/^"|"$/g, "").trim();
    if (first) keys.add(first);
  }
  return keys;
}

async function load(kind: "stock" | "offer") {
  const base = "http://script.local";
  const res =
    kind === "stock"
      ? await getStock(new Request(`${base}/api/galaxus/export/stock?all=1`))
      : await getOffer(new Request(`${base}/api/galaxus/export/offer?all=1`));
  const text = await res.text();
  if (res.status >= 400) throw new Error(`${kind} status=${res.status} ${text.slice(0, 200)}`);
  return keysFromCsv(text);
}

async function main() {
  console.error("[main-baseline] loading stock…");
  const stock = await load("stock");
  console.error("[main-baseline] stock keys", stock.size);
  console.error("[main-baseline] loading offer…");
  const offer = await load("offer");
  console.error("[main-baseline] offer keys", offer.size);
  const onlyOffer = [...offer].filter((k) => !stock.has(k)).sort();
  const onlyStock = [...stock].filter((k) => !offer.has(k)).sort();
  const out = {
    ref: "origin/main",
    stockCount: stock.size,
    offerCount: offer.size,
    onlyOfferCount: onlyOffer.length,
    onlyStockCount: onlyStock.length,
    onlyOffer,
  };
  const dest =
    "/Users/resell-lausanne/Projects/shopify-fulfillment-dashboard/tmp/main-stock-offer-keys.json";
  writeFileSync(dest, JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
