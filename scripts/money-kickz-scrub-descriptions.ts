/**
 * Rewrite Money Kickz product descriptions: French only, no supplier mentions.
 * Usage: npx tsx scripts/money-kickz-scrub-descriptions.ts --write
 */
import "dotenv/config";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { shopifyGraphQL } from "@/lib/shopifyAdmin";

const WRITE = process.argv.includes("--write");

type OfferMeta = {
  title: string;
  brand: string;
  vendor?: string;
  colorway?: string | null;
  category?: string | null;
};

function buildFrDescription(offer: OfferMeta): string {
  const vendor = offer.vendor || offer.brand;
  const color = offer.colorway ? ` — ${offer.colorway}` : "";
  const cat = offer.category ? ` (${offer.category})` : "";
  return [
    `<p>Découvrez ${offer.title}${color}${cat} de ${vendor}. Disponible chez Resell Lausanne — chaque article est authentifié et vérifié manuellement avant expédition. Livraison en Suisse et en Europe.</p>`,
    `<p><strong>Coloris :</strong> ${offer.colorway ?? "—"}<br><strong>Marque :</strong> ${offer.brand}<br><strong>Catégorie :</strong> ${offer.category ?? "Apparel"}</p>`,
    `<p>Produit 100% authentique. Resell Lausanne sélectionne uniquement des articles en parfait état.</p>`,
  ].join("\n");
}

function needsRewrite(html: string): boolean {
  return /money\s*kickz|jmoneykicks?|supplier\s*:|fournisseur\s*:|auth_pending|provenance\s+fournisseur|Entdecken Sie|Discover |Colorway:|Brand:|Category:/i.test(
    html
  );
}

async function main() {
  const status = JSON.parse(
    readFileSync("tmp/money-kickz/final-status-2026-08-08.json", "utf8")
  ) as {
    rows: Array<{
      id: string;
      handle: string;
      title: string;
      action?: string;
    }>;
  };

  const bootstrap = JSON.parse(
    readFileSync("tmp/money-kickz/bootstrap-write-2026-08-08.json", "utf8")
  ) as {
    rows?: Array<{
      productId?: string;
      title: string;
      brand?: string;
      vendor?: string;
      colorway?: string | null;
      category?: string | null;
      key?: string;
    }>;
  };

  const byId = new Map<string, OfferMeta>();
  for (const r of bootstrap.rows ?? []) {
    if (!r.productId) continue;
    byId.set(r.productId, {
      title: r.title,
      brand: r.brand || "—",
      vendor: r.vendor || r.brand || "—",
      colorway: r.colorway ?? null,
      category: r.category ?? null,
    });
  }

  // Enrich file may have better colorway/category
  try {
    const enrich = JSON.parse(
      readFileSync("tmp/money-kickz/enrich-write-2026-08-08.json", "utf8")
    ) as {
      rows?: Array<{
        productId?: string;
        title: string;
        brand?: string;
        vendor?: string;
        colorway?: string | null;
        category?: string | null;
      }>;
    };
    for (const r of enrich.rows ?? []) {
      if (!r.productId) continue;
      byId.set(r.productId, {
        title: r.title,
        brand: r.brand || byId.get(r.productId)?.brand || "—",
        vendor: r.vendor || r.brand || byId.get(r.productId)?.vendor || "—",
        colorway: r.colorway ?? byId.get(r.productId)?.colorway ?? null,
        category: r.category ?? byId.get(r.productId)?.category ?? null,
      });
    }
  } catch {
    // optional
  }

  const report: Array<Record<string, unknown>> = [];

  for (const row of status.rows) {
    const { data, errors } = await shopifyGraphQL<{
      product: {
        id: string;
        handle: string;
        title: string;
        vendor: string;
        descriptionHtml: string | null;
      } | null;
    }>(
      `query($id: ID!) {
        product(id: $id) { id handle title vendor descriptionHtml }
      }`,
      { id: row.id }
    );
    if (errors?.length) throw new Error(errors.map((e) => e.message).join("; "));
    const product = data?.product;
    if (!product) {
      report.push({ handle: row.handle, status: "missing" });
      continue;
    }

    const before = product.descriptionHtml ?? "";
    const meta = byId.get(product.id) ?? {
      title: product.title,
      brand: product.vendor,
      vendor: product.vendor,
      colorway: null,
      category: null,
    };

    // Always rewrite if polluted OR if multi-lang junk present; also rewrite CREATE stubs that got the bad template.
    if (!needsRewrite(before) && before.trim().length > 0) {
      // Still force rewrite for any description that contains German/English template leftovers
      report.push({ handle: row.handle, status: "left_alone" });
      continue;
    }

    const cleaned = buildFrDescription({
      ...meta,
      title: product.title,
      vendor: product.vendor || meta.vendor,
      brand: meta.brand || product.vendor,
    });

    if (WRITE) {
      const upd = await shopifyGraphQL<{
        productUpdate: { userErrors: Array<{ message: string }> };
      }>(
        `mutation($input: ProductInput!) {
          productUpdate(input: $input) { userErrors { message } }
        }`,
        { input: { id: product.id, descriptionHtml: cleaned } }
      );
      const ue = upd.data?.productUpdate?.userErrors ?? [];
      if (upd.errors?.length || ue.length) {
        throw new Error(
          `${row.handle}: ${
            (upd.errors ?? []).map((e) => e.message).join("; ") ||
            ue.map((e) => e.message).join("; ")
          }`
        );
      }
    }

    report.push({
      handle: row.handle,
      status: WRITE ? "rewritten_fr" : "would_rewrite_fr",
      beforeSnippet: before.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 180),
      afterSnippet: cleaned.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 180),
    });
    console.log(`${WRITE ? "OK" : "WOULD"} ${row.handle}`);
  }

  const outDir = path.join(process.cwd(), "tmp/money-kickz");
  mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "scrub-descriptions.json");
  writeFileSync(
    outPath,
    JSON.stringify({ at: new Date().toISOString(), write: WRITE, report }, null, 2)
  );
  console.log(
    JSON.stringify(
      {
        write: WRITE,
        rewritten: report.filter((r) => String(r.status).includes("rewrite")).length,
        leftAlone: report.filter((r) => r.status === "left_alone").length,
        outPath,
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
