/**
 * StockX buyer CLI.
 *
 *   npx tsx scripts/stockx-buyer.ts run                  # supervisor loop (needs .data/stockx-buyer/buyer.on)
 *   npx tsx scripts/stockx-buyer.ts run --force          # write buyer.on first
 *   npx tsx scripts/stockx-buyer.ts once [--dry] [--orders=#7661,#7682] [--no-galaxus] [--no-shopify]
 *   npx tsx scripts/stockx-buyer.ts status | queue | report | learnings
 *   npx tsx scripts/stockx-buyer.ts stop | halt <why> | resume
 *   npx tsx scripts/stockx-buyer.ts hold <key|#order> <why> | release <key>
 *   npx tsx scripts/stockx-buyer.ts goat <sku> <sizeEU> [stockxAllInChf]
 *   npx tsx scripts/stockx-buyer.ts chrome                 # kill leftover buyer-profile Chromes
 */
import "dotenv/config";
import { prisma } from "@/app/lib/prisma";
import * as control from "@/lib/stockxBuyer/control";
import { configFromEnv, runSupervisor } from "@/lib/stockxBuyer/supervisor";

const args = process.argv.slice(2);
const cmd = args[0] || "status";
const flag = (n: string) => args.includes(`--${n}`);
const opt = (n: string) => args.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const norm = (n: string) => (n.startsWith("#") ? n : `#${n}`);

async function main() {
  switch (cmd) {
    case "run":
    case "once": {
      const cfg = configFromEnv();
      cfg.once = cmd === "once";
      if (flag("dry")) cfg.dryRun = true;
      if (flag("no-galaxus")) cfg.galaxus = false;
      if (flag("no-shopify")) cfg.shopify = false;
      if (flag("no-rebuy")) cfg.rebuy = false;
      const only = opt("orders");
      if (only) cfg.onlyOrders = new Set(only.split(",").map((s) => norm(s.trim())).filter((s) => s !== "#"));
      if (cmd === "run" && flag("force")) console.log(await control.startBuyer());
      await runSupervisor(cfg);
      return;
    }
    case "status":
      console.log(JSON.stringify(await control.status(), null, 2));
      return;
    case "queue":
      console.table(await control.queue({ limit: Number(opt("limit") || 100) }));
      return;
    case "report":
      console.log(await control.report());
      return;
    case "learnings":
      console.log(await control.learnings());
      return;
    case "start":
      console.log(await control.startBuyer());
      return;
    case "stop":
      console.log(await control.stopBuyer());
      return;
    case "halt":
      console.log(await control.haltNow(args.slice(1).join(" ") || "manual"));
      return;
    case "resume":
      console.log(await control.resume());
      return;
    case "hold": {
      const target = args[1];
      if (!target) throw new Error("hold <key|#order> <why>");
      const why = args.slice(2).join(" ") || "manual";
      if (target.startsWith("shopify:") || target.startsWith("galaxus:")) console.log(await control.hold(target, why));
      else console.log(await control.holdOrder(target, why));
      return;
    }
    case "release":
      console.log(await control.release(args[1] || ""));
      return;
    case "goat":
      console.log(JSON.stringify(await control.goat(args[1] || "", args[2] || "", args[3] ? Number(args[3]) : null), null, 2));
      return;
    case "chrome":
      console.log(JSON.stringify(await control.chromeHygiene()));
      return;
    default:
      console.error(`unknown command: ${cmd}`);
      process.exitCode = 2;
  }
}

main()
  .catch((e) => {
    console.error("[stockx-buyer] fatal", e?.message || e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect().catch(() => undefined));
