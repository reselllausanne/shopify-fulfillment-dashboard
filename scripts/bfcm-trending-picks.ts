/**
 * Trending (StockX/GOAT sales, Nov 2026) pairs that are on the site but NOT warehouse stock and NOT soldes.
 * Writes /tmp/bfcm-trending.json
 */
import { writeFileSync } from "node:fs";
import { prisma } from "@/app/lib/prisma";
import { shopifyGraphQL } from "@/lib/shopifyAdmin";

// rank = trend order. seg: m men/unisex-leaning, w women, u unisex
const CANDIDATES: { handle: string; seg: "m" | "w" | "u" }[] = [
  { handle: "timberland-6-inch-premium-waterproof-wheat", seg: "m" },
  { handle: "salomon-xt-6-black-coffee-burro-bitter-chocolate", seg: "u" },
  { handle: "salomon-xt-6-vanilla-ice-black-silver-cloud", seg: "u" },
  { handle: "air-jordan-4-retro-og-bred-2026", seg: "m" },
  { handle: "air-jordan-5-retro-halloween", seg: "m" },
  { handle: "air-jordan-6-retro-infrared-white-2026", seg: "m" },
  { handle: "nike-air-max-95-gore-tex-big-bubble-black", seg: "m" },
  { handle: "ugg-classic-ultra-mini-chestnut-w", seg: "w" },
  { handle: "adidas-samba-og-mule-preloved-brown-white-womens", seg: "w" },
  { handle: "nike-caitlin-1-cave-stone-womens", seg: "w" },
  { handle: "ugg-tasman-ii-slipper-black", seg: "u" },
];

const Q = `query($h:String!){productByHandle(handle:$h){id handle title status featuredImage{url} soldes:metafield(namespace:"custom",key:"soldes_48h"){value} variants(first:80){nodes{id title availableForSale selectedOptions{name value}}}}}`;

(async () => {
  const out: any[] = [];
  for (const c of CANDIDATES) {
    const r: any = await shopifyGraphQL(Q, { h: c.handle });
    const p = (r.data ?? r).productByHandle;
    if (!p) { console.log("MISSING on site:", c.handle); continue; }
    const ids = p.variants.nodes.map((v: any) => v.id);
    const phys = await prisma.shopifyVariantLocationStock.count({
      where: { shopifyVariantId: { in: ids }, sourceType: "physical", available: { gt: 0 } },
    });
    const sizes = p.variants.nodes.filter((v: any) => v.availableForSale).map((v: any) => ({ id: v.id.split("/").pop(), size: v.selectedOptions[0]?.value }));
    const ok = p.status === "ACTIVE" && p.soldes?.value !== "true" && phys === 0 && sizes.length > 0;
    console.log(ok ? "OK  " : "SKIP", c.handle, "| status", p.status, "| soldes", p.soldes?.value ?? "-", "| physicalVariants", phys, "| sizes", sizes.length);
    if (ok) out.push({ ...c, title: p.title, image: p.featuredImage?.url, sizes });
  }
  writeFileSync("/tmp/bfcm-trending.json", JSON.stringify(out));
  console.log("eligible", out.length);
  await prisma.$disconnect();
})();
