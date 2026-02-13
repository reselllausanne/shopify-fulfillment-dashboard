import { NextResponse } from "next/server";
import {
  GALAXUS_SFTP_HOST,
  GALAXUS_PROVIDER_NAME,
  GALAXUS_ASSORTMENT_FILE,
  GALAXUS_SFTP_FEEDS_DIR,
  GALAXUS_SFTP_IN_DIR,
  GALAXUS_SFTP_OUT_DIR,
  GALAXUS_SFTP_PASSWORD,
  GALAXUS_SFTP_PORT,
  GALAXUS_SFTP_USER,
  GALAXUS_SUPPLIER_ID,
  assertSftpConfig,
} from "@/galaxus/edi/config";
import { uploadTempThenRename, withSftp } from "@/galaxus/edi/sftpClient";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type UploadedFile = {
  name: string;
  path: string;
  size: number;
};

function normalizeProviderName(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "").toLowerCase() || "digitecgalaxus";
}

function buildFeedFilename(
  type: "product" | "price" | "stock",
  providerName: string,
  assortmentFile: string
): string {
  const safeProvider = normalizeProviderName(providerName);
  const isAssortment = assortmentFile.toLowerCase() === type;
  const suffix = isAssortment ? "_assortment" : "";
  if (type === "price") return `PriceData_${safeProvider}${suffix}.csv`;
  if (type === "stock") return `StockData_${safeProvider}${suffix}.csv`;
  return `ProductData_${safeProvider}${suffix}.csv`;
}

export async function POST(request: Request) {
  try {
    assertSftpConfig();
    const { searchParams } = new URL(request.url);
    const supplier = searchParams.get("supplier");
    const type = (searchParams.get("type") ?? "all").toLowerCase();
    const limitRaw = searchParams.get("limit");
    const limit = limitRaw ? Math.max(1, Math.min(Number(limitRaw), 1000)) : null;
    const origin = new URL(request.url).origin;
    const supplierParam = supplier?.trim() ? `&supplier=${encodeURIComponent(supplier.trim())}` : "";
    const limitParam = limit ? `&limit=${limit}` : "";
    const providerParam = searchParams.get("provider")?.trim();
    const providerName = providerParam || GALAXUS_PROVIDER_NAME || "digitecgalaxus";
    const assortmentFile = searchParams.get("assortment")?.trim() || GALAXUS_ASSORTMENT_FILE || "price";

    const masterUrl = `${origin}/api/galaxus/export/master?${limit ? "limit=" + limit : "all=1"}${supplierParam}${limitParam}&minimal=1`;
    const stockUrl = `${origin}/api/galaxus/export/stock?${limit ? "limit=" + limit : "all=1"}${supplierParam}${limitParam}`;
    const offerUrl = `${origin}/api/galaxus/export/offer?${limit ? "limit=" + limit : "all=1"}${supplierParam}${limitParam}`;

    const needsMaster = type === "all" || type === "master";
    const needsStock = type === "all" || type === "stock" || type === "offer";

    const needsOffer = type === "offer" || type === "all";
    const [masterRes, stockRes, offerRes] = await Promise.all([
      needsMaster ? fetch(masterUrl, { cache: "no-store" }) : Promise.resolve(null),
      needsStock ? fetch(stockUrl, { cache: "no-store" }) : Promise.resolve(null),
      needsOffer ? fetch(offerUrl, { cache: "no-store" }) : Promise.resolve(null),
    ]);

    if (masterRes && !masterRes.ok) {
      throw new Error(`Master export failed: ${masterRes.status} ${masterRes.statusText}`);
    }
    if (stockRes && !stockRes.ok) {
      throw new Error(`Stock export failed: ${stockRes.status} ${stockRes.statusText}`);
    }
    if (offerRes && !offerRes.ok) {
      throw new Error(`Offer export failed: ${offerRes.status} ${offerRes.statusText}`);
    }

    const [masterCsv, stockCsv, offerCsv] = await Promise.all([
      masterRes ? masterRes.text() : Promise.resolve(""),
      stockRes ? stockRes.text() : Promise.resolve(""),
      offerRes ? offerRes.text() : Promise.resolve(""),
    ]);

    const masterName = buildFeedFilename("product", providerName, assortmentFile);
    const stockName = buildFeedFilename("stock", providerName, assortmentFile);
    const offerName = buildFeedFilename("price", providerName, assortmentFile);

    const uploads: UploadedFile[] = [];

    await withSftp(
      {
        host: GALAXUS_SFTP_HOST,
        port: GALAXUS_SFTP_PORT,
        username: GALAXUS_SFTP_USER,
        password: GALAXUS_SFTP_PASSWORD,
      },
      async (client) => {
        if (needsMaster) {
          await uploadTempThenRename(client, GALAXUS_SFTP_FEEDS_DIR, masterName, masterCsv);
          uploads.push({
            name: masterName,
            path: `${GALAXUS_SFTP_FEEDS_DIR.replace(/\/$/, "")}/${masterName}`,
            size: Buffer.byteLength(masterCsv),
          });
        }

        if (needsStock) {
          await uploadTempThenRename(client, GALAXUS_SFTP_FEEDS_DIR, stockName, stockCsv);
          uploads.push({
            name: stockName,
            path: `${GALAXUS_SFTP_FEEDS_DIR.replace(/\/$/, "")}/${stockName}`,
            size: Buffer.byteLength(stockCsv),
          });
        }
        if (needsOffer) {
          await uploadTempThenRename(client, GALAXUS_SFTP_FEEDS_DIR, offerName, offerCsv);
          uploads.push({
            name: offerName,
            path: `${GALAXUS_SFTP_FEEDS_DIR.replace(/\/$/, "")}/${offerName}`,
            size: Buffer.byteLength(offerCsv),
          });
        }
      }
    );

    const isLocal =
      !GALAXUS_SFTP_HOST ||
      GALAXUS_SFTP_HOST === "localhost" ||
      GALAXUS_SFTP_HOST === "127.0.0.1" ||
      GALAXUS_SFTP_HOST.startsWith("192.168.");
    return NextResponse.json({
      ok: true,
      type,
      limit,
      sftpHost: GALAXUS_SFTP_HOST,
      sftpPort: GALAXUS_SFTP_PORT,
      supplierId: GALAXUS_SUPPLIER_ID,
      inDir: GALAXUS_SFTP_IN_DIR,
      outDir: GALAXUS_SFTP_OUT_DIR,
      feedsDir: GALAXUS_SFTP_FEEDS_DIR,
      uploaded: uploads,
      isRealGalaxus: GALAXUS_SFTP_HOST === "ftp.digitecgalaxus.ch",
      warning: isLocal
        ? "Uploaded to LOCAL SFTP. Galaxus staff cannot see these files."
        : null,
    });
  } catch (error: any) {
    console.error("[GALAXUS][FEEDS][UPLOAD] Failed:", error);
    return NextResponse.json(
      { ok: false, error: error?.message ?? "Upload failed." },
      { status: 500 }
    );
  }
}

export async function GET(request: Request) {
  return POST(request);
}
