/**
 * One-shot: same CSV bodies as POST /api/galaxus/feeds/upload would fetch (all=1).
 * Also runs GET check-all?all=1&summary=1 for comparison (upload uses this for gating).
 *
 * Usage: npx tsx scripts/galaxus-feed-row-counts.ts
 */
import "dotenv/config";

import { GET as getCheckAll } from "../app/api/galaxus/export/check-all/route";
import { GET as getMaster } from "../app/api/galaxus/export/master/route";
import { GET as getStock } from "../app/api/galaxus/export/stock/route";
import { GET as getOffer } from "../app/api/galaxus/export/offer/route";
import { GET as getSpecs } from "../app/api/galaxus/export/specifications/route";

function countCsvRows(csv: string): number {
  if (!csv) return 0;
  const lines = csv.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) return 0;
  return Math.max(0, lines.length - 1);
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
  console.error("[galaxus-feed-row-counts] starting parallel export handlers (all=1)…");

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

  console.log(JSON.stringify({
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
  }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
