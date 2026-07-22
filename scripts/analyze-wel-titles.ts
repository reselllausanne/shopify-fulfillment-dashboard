import { prismaDirect } from "@/app/lib/prisma";

async function main() {
  const rows = await prismaDirect.supplierVariant.findMany({
    where: { supplierVariantId: { startsWith: "wel_" } },
    select: { supplierProductName: true, supplierBrand: true },
    take: 10000,
  });

  const brands = new Map<string, number>();
  const patterns = new Map<string, number>();
  const PATS = [
    "tcg", "board game", "deck", "booster", "display", "starter", "sleeve", "dice",
    "miniature", "figure", "bag", "sticker", "playmat", "ugg", "sandal", "boot",
    "shoe", "sneaker", "jersey", "hoodie", "cap", "hat", "lego", "pokemon",
    "magic:", "mtg", "warhammer", "gloomhaven", "catan", "monopoly", "expansion",
    "accessory", "token", "mat ", " mat", "insert", "organizer", "painted",
    "collectible", "plush", "puzzle", "rpg", "dnd", "d&d", "card game",
    "trading card", "elite trainer", "blister", "bundle", "core set",
  ];

  for (const r of rows) {
    const b = (r.supplierBrand || "").trim() || "(none)";
    brands.set(b, (brands.get(b) || 0) + 1);
    const t = (r.supplierProductName || "").toLowerCase();
    for (const pat of PATS) {
      if (t.includes(pat)) patterns.set(pat, (patterns.get(pat) || 0) + 1);
    }
  }

  console.log("WEL sample count:", rows.length);
  console.log("\nTop brands:");
  for (const [b, n] of [...brands.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30)) {
    console.log(`  ${n}\t${b}`);
  }
  console.log("\nTitle patterns:");
  for (const [p, n] of [...patterns.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${n}\t${p}`);
  }

  // sample unmatched-looking titles (no pattern hit)
  const unmatched: string[] = [];
  for (const r of rows) {
    const t = (r.supplierProductName || "").toLowerCase();
    const hit = PATS.some((p) => t.includes(p));
    if (!hit && unmatched.length < 40) unmatched.push(r.supplierProductName || "");
  }
  console.log("\nSample titles with no pattern hit:");
  for (const t of unmatched.slice(0, 40)) console.log(" ", t.slice(0, 90));
}

main().finally(() => process.exit(0));
