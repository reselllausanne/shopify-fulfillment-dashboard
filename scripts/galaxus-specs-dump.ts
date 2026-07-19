/**
 * Dump the Galaxus specs feed rows for a single providerKey.
 * Usage: npx tsx scripts/galaxus-specs-dump.ts STX_191526411576
 */
import "dotenv/config";

import { GET as getSpecs } from "../app/api/galaxus/export/specifications/route";

async function main() {
  const providerKey = process.argv[2] ?? "STX_191526411576";
  const base = "http://script.local";
  const url = `${base}/api/galaxus/export/specifications?all=1&providerKeys=${encodeURIComponent(
    providerKey
  )}`;
  const res = await getSpecs(new Request(url));
  const ct = res.headers.get("content-type") ?? "";
  const text = await res.text();
  console.log("status:", res.status, "content-type:", ct);
  if (ct.includes("application/json")) {
    console.log(JSON.stringify(JSON.parse(text), null, 2));
  } else {
    console.log(text);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
