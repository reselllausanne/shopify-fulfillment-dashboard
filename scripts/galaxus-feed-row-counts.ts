/**
 * One-shot: same CSV bodies as POST /api/galaxus/feeds/upload would fetch (all=1).
 * Also runs GET check-all?all=1&summary=1 for comparison (upload uses this for gating).
 *
 * Usage:
 *   npx tsx scripts/galaxus-feed-row-counts.ts
 *   npx tsx scripts/galaxus-feed-row-counts.ts --stock-offer-only --out=tmp/stock-offer-keys.json
 *
 * Read-only: invokes export GET handlers in-process (CSV generation). Does not push to Galaxus.
 */
import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { GET as getCheckAll } from "../app/api/galaxus/export/check-all/route";
import { GET as getMaster } from "../app/api/galaxus/export/master/route";
import { GET as getStock } from "../app/api/galaxus/export/stock/route";
import { GET as getOffer } from "../app/api/galaxus/export/offer/route";
import { GET as getSpecs } from "../app/api/galaxus/export/specifications/route";

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function argValue(name: string): string | null {
  const prefix = `--${name}=`;
  const raw = process.argv.find((a) => a.startsWith(prefix));
  return raw ? raw.slice(prefix.length) : null;
}

function countCsvRows(csv: string): number {
  if (!csv) return 0;
  const lines = csv.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) return 0;
  return Math.max(0, lines.length - 1);
}

/** First column = ProviderKey for stock/offer CSV. */
function providerKeysFromCsv(csv: string | null): string[] {
  if (!csv) return [];
  const lines = csv.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length <= 1) return [];
  const keys = new Set<string>();
  for (const line of lines.slice(1)) {
    const first = line.split(",")[0]?.replace(/^"|"$/g, "").trim() ?? "";
    if (first) keys.add(first);
  }
  return Array.from(keys).sort();
}

async function textOrJson(res: Response): Promise<{ csv: string | null; json: unknown; status: number }> {
  const status = res.status;
  const ct = res.headers.get("content-type") ?? "";
  const text = await res.text();
  if (ct.includes("application/json")) {
    try {
      return { csv: null, json: JSON.parse(text), status };
    } catch {
      return { csv: null, json: { raw: text.slice(0, 500) }, status };
    }
  }
  return { csv: text, json: null, status };
}

async function main() {
  const base = "http://script.local";
  const stockOfferOnly = hasFlag("stock-offer-only");
  const outPath = argValue("out");
  console.error(
    `[galaxus-feed-row-counts] starting ${stockOfferOnly ? "stock+offer" : "all"} export handlers (all=1)…`
  );

  if (stockOfferOnly) {
    // Sequential to keep peak memory down (full all=1 CSVs are huge).
    const stockRes = await getStock(new Request(`${base}/api/galaxus/export/stock?all=1`));
    const stock = await textOrJson(stockRes);
    const stockKeys = providerKeysFromCsv(stock.csv);
    const stockRows = stock.csv != null ? countCsvRows(stock.csv) : null;
    const stockStatus = stock.status;
    // Drop CSV body before building offer (GC).
    (stock as { csv: string | null }).csv = null;

    const offerRes = await getOffer(new Request(`${base}/api/galaxus/export/offer?all=1`));
    const offer = await textOrJson(offerRes);
    const offerKeys = providerKeysFromCsv(offer.csv);
    const offerRows = offer.csv != null ? countCsvRows(offer.csv) : null;
    const offerStatus = offer.status;
    (offer as { csv: string | null }).csv = null;

    const stockSet = new Set(stockKeys);
    const offerSet = new Set(offerKeys);
    const onlyStock = stockKeys.filter((k) => !offerSet.has(k));
    const onlyOffer = offerKeys.filter((k) => !stockSet.has(k));
    const report = {
      note: "Dry-run only — GET handlers generate CSV in-process; no Galaxus upload.",
      stock: {
        status: stockStatus,
        dataRows: stockRows,
        providerKeyCount: stockKeys.length,
      },
      offer: {
        status: offerStatus,
        dataRows: offerRows,
        providerKeyCount: offerKeys.length,
      },
      stockVsOfferExactKeys: onlyStock.length === 0 && onlyOffer.length === 0,
      onlyStockSample: onlyStock.slice(0, 20),
      onlyOfferSample: onlyOffer.slice(0, 20),
    };
    console.log(JSON.stringify(report, null, 2));
    if (outPath) {
      mkdirSync(dirname(outPath), { recursive: true });
      writeFileSync(
        outPath,
        JSON.stringify({ ...report, stockProviderKeys: stockKeys, offerProviderKeys: offerKeys }, null, 2)
      );
      console.error(`wrote ${outPath}`);
    }
    if (stockStatus >= 400 || offerStatus >= 400) process.exitCode = 1;
    return;
  }

  const [checkRes, masterRes, stockRes, offerRes, specsRes] = await Promise.all([
    getCheckAll(new Request(`${base}/api/galaxus/export/check-all?all=1&summary=1`)),
    getMaster(new Request(`${base}/api/galaxus/export/master?all=1`)),
    getStock(new Request(`${base}/api/galaxus/export/stock?all=1`)),
    getOffer(new Request(`${base}/api/galaxus/export/offer?all=1`)),
    getSpecs(new Request(`${base}/api/galaxus/export/specifications?all=1`)),
  ]);

  const checkParsed = await textOrJson(checkRes);
  const master = await textOrJson(masterRes);
  const stock = await textOrJson(stockRes);
  const offer = await textOrJson(offerRes);
  const specs = await textOrJson(specsRes);

  console.log(
    JSON.stringify(
      {
        note: "Row counts = data rows excluding CSV header. Upload fetches master/stock/offer/specs exports; validation uses check-all (master row count there can differ from real master export).",
        checkAll: {
          status: checkParsed.status,
          summary: (checkParsed.json as any)?.report?.summary ?? checkParsed.json,
        },
        uploadedStyleExports: {
          master: {
            status: master.status,
            dataRows: master.csv != null ? countCsvRows(master.csv) : null,
            error: master.status >= 400 ? master.json : undefined,
          },
          stock: {
            status: stock.status,
            dataRows: stock.csv != null ? countCsvRows(stock.csv) : null,
            error: stock.status >= 400 ? stock.json : undefined,
          },
          offer: {
            status: offer.status,
            dataRows: offer.csv != null ? countCsvRows(offer.csv) : null,
            error: offer.status >= 400 ? offer.json : undefined,
          },
          specifications: {
            status: specs.status,
            dataRows: specs.csv != null ? countCsvRows(specs.csv) : null,
            error: specs.status >= 400 ? specs.json : undefined,
          },
        },
        parity: {
          stockVsOffer:
            stock.csv && offer.csv && stock.status === 200 && offer.status === 200
              ? countCsvRows(stock.csv) === countCsvRows(offer.csv)
              : null,
          masterVsCheckAllMaster:
            checkParsed.status === 200 && master.csv && master.status === 200
              ? {
                  checkAllMasterRows: (checkParsed.json as any)?.report?.summary?.master?.totalRows,
                  realMasterRows: countCsvRows(master.csv),
                  delta:
                    (checkParsed.json as any)?.report?.summary?.master?.totalRows -
                    countCsvRows(master.csv),
                }
              : null,
        },
      },
      null,
      2
    )
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
