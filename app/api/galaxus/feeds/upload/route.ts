import { NextResponse } from "next/server";
import {
  GALAXUS_SFTP_HOST,
  GALAXUS_SFTP_IN_DIR,
  GALAXUS_SFTP_OUT_DIR,
  GALAXUS_SFTP_PASSWORD,
  GALAXUS_SFTP_PORT,
  GALAXUS_SFTP_USER,
  GALAXUS_SUPPLIER_ID,
  assertSftpConfig,
} from "@/galaxus/edi/config";
import { uploadTempThenRename, withSftp } from "@/galaxus/edi/sftpClient";
import { buildTimestamp } from "@/galaxus/edi/filenames";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type UploadedFile = {
  name: string;
  path: string;
  size: number;
};

function buildFilename(prefix: string, supplier: string | null, timestamp: string): string {
  const safeSupplier = supplier?.trim() ? supplier.trim() : "all";
  return `${prefix}-${safeSupplier}-${timestamp}.csv`;
}

export async function POST(request: Request) {
  try {
    assertSftpConfig();
    const { searchParams } = new URL(request.url);
    const supplier = searchParams.get("supplier");
    const origin = new URL(request.url).origin;
    const timestamp = buildTimestamp();
    const supplierParam = supplier?.trim() ? `&supplier=${encodeURIComponent(supplier.trim())}` : "";

    const masterUrl = `${origin}/api/galaxus/export/master?all=1${supplierParam}`;
    const stockUrl = `${origin}/api/galaxus/export/stock?all=1${supplierParam}`;

    const [masterRes, stockRes] = await Promise.all([
      fetch(masterUrl, { cache: "no-store" }),
      fetch(stockUrl, { cache: "no-store" }),
    ]);

    if (!masterRes.ok) {
      throw new Error(`Master export failed: ${masterRes.status} ${masterRes.statusText}`);
    }
    if (!stockRes.ok) {
      throw new Error(`Stock export failed: ${stockRes.status} ${stockRes.statusText}`);
    }

    const [masterCsv, stockCsv] = await Promise.all([masterRes.text(), stockRes.text()]);

    const masterName = buildFilename("galaxus-master", supplier, timestamp);
    const stockName = buildFilename("galaxus-stock", supplier, timestamp);

    const uploads: UploadedFile[] = [];

    await withSftp(
      {
        host: GALAXUS_SFTP_HOST,
        port: GALAXUS_SFTP_PORT,
        username: GALAXUS_SFTP_USER,
        password: GALAXUS_SFTP_PASSWORD,
      },
      async (client) => {
        await uploadTempThenRename(client, GALAXUS_SFTP_OUT_DIR, masterName, masterCsv);
        uploads.push({
          name: masterName,
          path: `${GALAXUS_SFTP_OUT_DIR.replace(/\/$/, "")}/${masterName}`,
          size: Buffer.byteLength(masterCsv),
        });

        await uploadTempThenRename(client, GALAXUS_SFTP_OUT_DIR, stockName, stockCsv);
        uploads.push({
          name: stockName,
          path: `${GALAXUS_SFTP_OUT_DIR.replace(/\/$/, "")}/${stockName}`,
          size: Buffer.byteLength(stockCsv),
        });
      }
    );

    return NextResponse.json({
      ok: true,
      supplierId: GALAXUS_SUPPLIER_ID,
      inDir: GALAXUS_SFTP_IN_DIR,
      outDir: GALAXUS_SFTP_OUT_DIR,
      uploaded: uploads,
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
