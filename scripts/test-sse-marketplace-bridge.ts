/**
 * Force-test the SSE → marketplace DB bridge end to end WITHOUT burning KicksDB quota.
 *
 * It drives the REAL API routes in-process (no running server needed) with a synthetic product,
 * then asserts the DB after every transition. Proves, deterministically and offline (0 KicksDB calls):
 *
 *   1. CREATE      — a fresh product's offered variants are created in SupplierVariant + VariantMapping
 *                    + KickDBVariant, with the right mapping status (GTIN → SUPPLIER_GTIN,
 *                    no-GTIN → PENDING_GTIN), and only offered variants are created.
 *   2. MAINTAIN    — a StockX price/asks change re-POSTed updates price + stock (and the Shopify
 *                    buffer rawJson the consumer reads), lastSyncAt bumps.
 *   3. LOST OFFER  — asks→0 sets stock 0 but KEEPS the last price (stock is the single control).
 *   4. DELIST      — notFound (fetch 404) zeros all its stock + flags notFound.
 *   5. GALAXUS lane — the GTIN variant is picked by the feed candidate selector; the no-GTIN one is
 *                     excluded (PENDING_GTIN + no gtin).
 *   6. SHOPIFY lane — /api/kickdb/fresh returns the product (untracked) with the up-to-date rawJson.
 *
 * Modes:
 *   npx tsx scripts/test-sse-marketplace-bridge.ts                # offline synthetic, full flow (0 API calls)
 *   npx tsx scripts/test-sse-marketplace-bridge.ts --keep         # don't clean up the synthetic rows
 *   npx tsx scripts/test-sse-marketplace-bridge.ts --live-slug <slug>   # 1 KicksDB call: real product wiring
 *   npx tsx scripts/test-sse-marketplace-bridge.ts --verify-sale <gtin> # read-only: show a GTIN's DB state
 *
 * On the VPS run it inside the web container so it uses the same DB + env:
 *   docker compose -f /opt/resell/docker-compose.yml exec -T web \
 *     npx tsx scripts/test-sse-marketplace-bridge.ts
 */
import "dotenv/config";
import { Prisma } from "@prisma/client";
import { prisma } from "../app/lib/prisma";
import { POST as upsertPOST } from "../app/api/kickdb/upsert/route";
import { GET as freshGET } from "../app/api/kickdb/fresh/route";
import { accumulateBestCandidates } from "../galaxus/exports/gtinSelection";
import { FEED_MAPPING_INCLUDE } from "../galaxus/exports/feedMappingLoader";
import { fetchStockxProductByIdOrSlugRaw } from "../galaxus/kickdb/client";

const INTERNAL_TOKEN = process.env.KICKDB_INTERNAL_TOKEN ?? "";

// ── tiny assert harness ───────────────────────────────────────────────────────
type Check = { name: string; ok: boolean; detail: string };
const checks: Check[] = [];
function assert(name: string, ok: boolean, detail = "") {
  checks.push({ name, ok, detail });
  const tag = ok ? "PASS" : "FAIL";
  console.log(`  [${tag}] ${name}${detail ? ` — ${detail}` : ""}`);
}
function section(title: string) {
  console.log(`\n=== ${title} ===`);
}

// ── in-process route callers ──────────────────────────────────────────────────
async function callUpsert(body: unknown): Promise<any> {
  const req = new Request("http://local/api/kickdb/upsert", {
    method: "POST",
    headers: { "content-type": "application/json", "x-internal-token": INTERNAL_TOKEN },
    body: JSON.stringify(body),
  });
  const res = await upsertPOST(req);
  return res.json();
}
async function callFresh(status: string, limit = 500): Promise<any> {
  const req = new Request(`http://local/api/kickdb/fresh?status=${status}&limit=${limit}`, {
    method: "GET",
    headers: { "x-internal-token": INTERNAL_TOKEN },
  });
  const res = await freshGET(req);
  return res.json();
}

// ── synthetic fixture (valid EAN-13 checksum, test-namespaced to avoid collisions) ──
const RUN = Date.now().toString(36);
const PID = `stxtest-${RUN}`;
const V1 = `stxtest-${RUN}-v1`; // has offer + GTIN     → SUPPLIER_GTIN, feed-eligible
const V2 = `stxtest-${RUN}-v2`; // has offer, NO GTIN   → PENDING_GTIN, feed-excluded
const V3 = `stxtest-${RUN}-v3`; // no usable offer      → NOT created
const SV1 = `stx_${V1}`;
const SV2 = `stx_${V2}`;
const SV3 = `stx_${V3}`;
const GTIN1 = "9990000000012"; // valid EAN-13 (checksum 2), unlikely to exist in catalog

function buildPayload(opts: {
  v1Price: number;
  v1Asks: number;
  v1HasOffer?: boolean;
}): any {
  const { v1Price, v1Asks, v1HasOffer = true } = opts;
  return {
    id: PID,
    slug: `test-sneaker-${RUN}`,
    url_key: `test-sneaker-${RUN}`,
    sku: `TST-${RUN}`,
    brand: "TestBrand",
    title: "Test Sneaker (synthetic)",
    image: "https://example.test/img.jpg",
    gallery: ["https://example.test/img.jpg", "https://example.test/img2.jpg"],
    variants: [
      {
        id: V1,
        size: "42",
        size_eu: "42",
        size_us: "9",
        gtin: GTIN1,
        prices: v1HasOffer ? [{ type: "express_standard", price: v1Price, asks: v1Asks }] : [],
      },
      {
        id: V2,
        size: "43",
        size_eu: "43",
        size_us: "9.5",
        // no gtin / no ean / no identifiers → stored as PENDING_GTIN
        prices: [{ type: "express_standard", price: 300, asks: 2 }],
      },
      {
        id: V3,
        size: "44",
        size_eu: "44",
        size_us: "10",
        gtin: null,
        prices: [], // no usable offer → not created
      },
    ],
  };
}

async function svByIds(ids: string[]) {
  return prisma.supplierVariant.findMany({
    where: { supplierVariantId: { in: ids } },
    select: {
      supplierVariantId: true,
      gtin: true,
      providerKey: true,
      price: true,
      stock: true,
      lastSyncAt: true,
      updatedAt: true,
    },
  });
}
async function mappingByIds(ids: string[]) {
  return prisma.variantMapping.findMany({
    where: { supplierVariantId: { in: ids } },
    select: { supplierVariantId: true, gtin: true, providerKey: true, status: true, kickdbVariantId: true },
  });
}
const priceOf = (rows: Awaited<ReturnType<typeof svByIds>>, id: string) =>
  rows.find((r) => r.supplierVariantId === id)?.price ?? null;
const stockOf = (rows: Awaited<ReturnType<typeof svByIds>>, id: string) =>
  rows.find((r) => r.supplierVariantId === id)?.stock ?? null;

async function cleanup() {
  const svIds = [SV1, SV2, SV3];
  const extIds = [V1, V2, V3];
  await prisma.$executeRaw`DELETE FROM "public"."VariantMapping" WHERE "supplierVariantId" IN (${Prisma.join(svIds)})`;
  await prisma.$executeRaw`DELETE FROM "public"."SupplierVariant" WHERE "supplierVariantId" IN (${Prisma.join(svIds)})`;
  await prisma.$executeRaw`DELETE FROM "public"."KickDBVariant" WHERE "kickdbVariantId" IN (${Prisma.join(extIds)})`;
  await prisma.$executeRaw`DELETE FROM "public"."ShopifySyncState" WHERE "kickdbProductId" = ${PID}`;
  await prisma.$executeRaw`DELETE FROM "public"."KickDBProduct" WHERE "kickdbProductId" = ${PID}`;
}

async function runOffline(keep: boolean) {
  console.log(JSON.stringify({ mode: "offline-synthetic", productId: PID, gtin: GTIN1 }, null, 2));

  // Preflight: make sure our synthetic GTIN / ids don't already exist (would pollute real rows).
  const collide = await prisma.supplierVariant.findMany({
    where: { OR: [{ gtin: GTIN1 }, { supplierVariantId: { in: [SV1, SV2, SV3] } }] },
    select: { supplierVariantId: true, gtin: true },
  });
  if (collide.length > 0) {
    throw new Error(`Preflight collision — pick a different GTIN/run: ${JSON.stringify(collide)}`);
  }

  try {
    // ── STEP 1: CREATE ──────────────────────────────────────────────────────
    section("STEP 1 — CREATE (new product from SSE)");
    const r1 = await callUpsert({ data: buildPayload({ v1Price: 250, v1Asks: 3 }) });
    assert("upsert ok", r1?.ok === true, JSON.stringify(r1?.supplierVariantSync ?? r1));
    assert("created 2 offered variants (v1+v2, not v3)", r1?.supplierVariantSync?.created === 2, `created=${r1?.supplierVariantSync?.created}`);

    let sv = await svByIds([SV1, SV2, SV3]);
    assert("v1 (GTIN) created", sv.some((r) => r.supplierVariantId === SV1), `${sv.map((r) => r.supplierVariantId)}`);
    assert("v2 (no GTIN) created", sv.some((r) => r.supplierVariantId === SV2));
    assert("v3 (no offer) NOT created", !sv.some((r) => r.supplierVariantId === SV3));
    assert("v1 stock = asks (3)", stockOf(sv, SV1) === 3, `stock=${stockOf(sv, SV1)}`);
    assert("v1 providerKey = STX_<gtin>", sv.find((r) => r.supplierVariantId === SV1)?.providerKey === `STX_${GTIN1}`);
    assert("v2 providerKey null (no gtin)", sv.find((r) => r.supplierVariantId === SV2)?.providerKey === null);

    const maps = await mappingByIds([SV1, SV2]);
    assert("v1 mapping SUPPLIER_GTIN", maps.find((m) => m.supplierVariantId === SV1)?.status === "SUPPLIER_GTIN");
    assert("v2 mapping PENDING_GTIN", maps.find((m) => m.supplierVariantId === SV2)?.status === "PENDING_GTIN");
    assert("v1 mapping linked to KickDBVariant", Boolean(maps.find((m) => m.supplierVariantId === SV1)?.kickdbVariantId));

    // Galaxus lane: feed candidate selector picks v1, excludes v2 (no gtin).
    const feedMaps = await prisma.variantMapping.findMany({
      where: { supplierVariantId: { in: [SV1, SV2] } },
      include: FEED_MAPPING_INCLUDE,
    });
    const best = accumulateBestCandidates(feedMaps as any[], new Map());
    assert("Galaxus feed includes v1 GTIN", best.has(GTIN1), `keys=${[...best.keys()]}`);
    assert("Galaxus feed excludes v2 (no GTIN)", best.size === 1, `candidates=${best.size}`);

    // Shopify lane: consumer sees the product (untracked) with rawJson.
    const fresh1 = await callFresh("untracked");
    const p1 = (fresh1?.products ?? []).find((p: any) => p.kickdbProductId === PID);
    assert("Shopify /fresh returns product (untracked)", Boolean(p1));
    assert("Shopify /fresh carries rawJson", Boolean(p1?.rawJson));

    // ── STEP 2: MAINTAIN (price change on StockX) ───────────────────────────
    section("STEP 2 — MAINTAIN (StockX price/asks change)");
    const before = (await svByIds([SV1]))[0];
    await new Promise((res) => setTimeout(res, 20));
    const r2 = await callUpsert({ data: buildPayload({ v1Price: 199, v1Asks: 7 }) });
    assert("upsert ok", r2?.ok === true, JSON.stringify(r2?.supplierVariantSync ?? r2));
    assert("no new creates on maintain", r2?.supplierVariantSync?.created === 0, `created=${r2?.supplierVariantSync?.created}`);
    sv = await svByIds([SV1]);
    const after = sv[0];
    assert("v1 stock updated 3 → 7", stockOf(sv, SV1) === 7, `stock=${stockOf(sv, SV1)}`);
    assert("v1 price changed", Number(before.price) !== Number(after.price), `before=${before.price} after=${after.price}`);
    assert("v1 lastSyncAt bumped", (after.lastSyncAt?.getTime() ?? 0) >= (before.lastSyncAt?.getTime() ?? 0));

    // Shopify buffer reflects the new price (what main_from_db pushes).
    const fresh2 = await callFresh("untracked");
    const p2 = (fresh2?.products ?? []).find((p: any) => p.kickdbProductId === PID);
    const rawV1Price = (p2?.rawJson?.variants ?? []).find((v: any) => v.id === V1)?.prices?.[0]?.price;
    assert("Shopify buffer rawJson shows new price (199)", Number(rawV1Price) === 199, `rawPrice=${rawV1Price}`);

    // ── STEP 3: LOST OFFER (asks → 0, keep price) ───────────────────────────
    section("STEP 3 — LOST OFFER (asks→0 keeps last price)");
    const priceBeforeZero = Number((await svByIds([SV1]))[0].price);
    const r3 = await callUpsert({ data: buildPayload({ v1Price: 199, v1Asks: 0, v1HasOffer: false }) });
    assert("upsert ok", r3?.ok === true, JSON.stringify(r3?.supplierVariantSync ?? r3));
    sv = await svByIds([SV1]);
    assert("v1 stock → 0", stockOf(sv, SV1) === 0, `stock=${stockOf(sv, SV1)}`);
    assert("v1 price PRESERVED", Number(priceOf(sv, SV1)) === priceBeforeZero, `price=${priceOf(sv, SV1)} (was ${priceBeforeZero})`);

    // ── STEP 4: DELIST (fetch 404) ──────────────────────────────────────────
    section("STEP 4 — DELIST (product 404 on update)");
    // Re-offer first so there is live stock to zero.
    await callUpsert({ data: buildPayload({ v1Price: 199, v1Asks: 5 }) });
    const r4 = await callUpsert({ data: { id: PID }, notFound: true });
    assert("delist ok", r4?.ok === true && r4?.delisted === true, JSON.stringify(r4));
    sv = await svByIds([SV1, SV2]);
    assert("all stock zeroed on delist", sv.every((r) => r.stock === 0), `${sv.map((r) => `${r.supplierVariantId}:${r.stock}`)}`);
    const prod = await prisma.kickDBProduct.findFirst({ where: { kickdbProductId: PID }, select: { notFound: true } });
    assert("product flagged notFound", prod?.notFound === true, `notFound=${prod?.notFound}`);
  } finally {
    if (keep) {
      console.log(`\n(--keep) synthetic rows left in DB for product ${PID}`);
    } else {
      section("CLEANUP");
      await cleanup();
      console.log("  synthetic rows removed");
    }
  }
}

async function runLive(slug: string) {
  console.log(JSON.stringify({ mode: "live-slug", slug }, null, 2));
  section("LIVE — 1 KicksDB fetch, real product wiring");
  const res = await fetchStockxProductByIdOrSlugRaw(slug);
  const data = res.product as any;
  const pid = String(data?.id ?? "");
  assert("KicksDB returned a product", Boolean(pid), `id=${pid} slug=${data?.slug}`);
  const r = await callUpsert({ data });
  assert("upsert ok", r?.ok === true, JSON.stringify(r?.supplierVariantSync ?? r));
  console.log("  supplierVariantSync:", JSON.stringify(r?.supplierVariantSync));

  const feedMaps = await prisma.variantMapping.findMany({
    where: { kickdbVariant: { product: { kickdbProductId: pid } } },
    include: FEED_MAPPING_INCLUDE,
  });
  const best = accumulateBestCandidates(feedMaps as any[], new Map());
  assert("has ≥1 Galaxus feed candidate", best.size >= 1, `candidates=${best.size}`);

  const fresh = await callFresh("untracked");
  const p = (fresh?.products ?? []).find((x: any) => x.kickdbProductId === pid);
  assert("Shopify /fresh returns it", Boolean(p));
  console.log("  (live product left as-is — no cleanup)");
}

async function verifySale(gtin: string) {
  console.log(JSON.stringify({ mode: "verify-sale", gtin }, null, 2));
  section("VERIFY SALE — read-only DB state for GTIN");
  const sv = await prisma.supplierVariant.findMany({
    where: { gtin },
    select: {
      supplierVariantId: true,
      gtin: true,
      price: true,
      stock: true,
      manualLock: true,
      manualNote: true,
      lastSyncAt: true,
      updatedAt: true,
    },
  });
  console.log("SupplierVariant rows:");
  console.table(sv);
  const maps = await prisma.variantMapping.findMany({
    where: { gtin },
    select: { supplierVariantId: true, status: true, providerKey: true, updatedAt: true },
  });
  console.log("VariantMapping rows:");
  console.table(maps);
  assert("GTIN present in marketplace DB", sv.length > 0, `${sv.length} row(s)`);
  console.log(
    "\nNote: physical-sale price/compareAt live on Shopify — verify there with the Shopify GraphQL " +
      "productVariant query for this GTIN (price, compareAtPrice, inventoryQuantity)."
  );
}

async function main() {
  const argv = process.argv.slice(2);
  const liveIdx = argv.indexOf("--live-slug");
  const saleIdx = argv.indexOf("--verify-sale");
  const keep = argv.includes("--keep");

  if (liveIdx >= 0) {
    await runLive(argv[liveIdx + 1]);
  } else if (saleIdx >= 0) {
    await verifySale(argv[saleIdx + 1]);
  } else {
    await runOffline(keep);
  }

  const failed = checks.filter((c) => !c.ok);
  section("SUMMARY");
  console.log(`  ${checks.length - failed.length}/${checks.length} checks passed`);
  if (failed.length > 0) {
    console.log("  FAILED:");
    for (const f of failed) console.log(`   - ${f.name}${f.detail ? ` (${f.detail})` : ""}`);
    process.exitCode = 1;
  } else {
    console.log("  ALL GREEN ✅");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
