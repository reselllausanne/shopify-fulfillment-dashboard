import { NextResponse } from "next/server";
import {
  GALAXUS_SFTP_HOST,
  GALAXUS_SFTP_FEEDS_DIR,
  GALAXUS_SFTP_PASSWORD,
  GALAXUS_SFTP_PORT,
  GALAXUS_SFTP_USER,
  assertSftpConfig,
} from "@/galaxus/edi/config";
import { downloadRemoteFile, listRemoteFiles, withSftp } from "@/galaxus/edi/sftpClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PreviewType = "product" | "price" | "stock" | "specs";

function resolvePrefix(type: PreviewType): string {
  if (type === "price") return "PriceData_";
  if (type === "stock") return "StockData_";
  if (type === "specs") return "SpecificationData_";
  return "ProductData_";
}

export async function GET(request: Request) {
  try {
    assertSftpConfig();
    const { searchParams } = new URL(request.url);
    const type = (searchParams.get("type") ?? "product") as PreviewType;
    if (type !== "product" && type !== "stock" && type !== "price" && type !== "specs") {
      return NextResponse.json({ ok: false, error: "Invalid type." }, { status: 400 });
    }

    const lineCount = Math.min(Math.max(Number(searchParams.get("lines") ?? "5"), 1), 50);
    const wantsDownload = ["1", "true", "yes"].includes(
      (searchParams.get("download") ?? "").toLowerCase()
    );
    const prefix = resolvePrefix(type);

    const result = await withSftp(
      {
        host: GALAXUS_SFTP_HOST,
        port: GALAXUS_SFTP_PORT,
        username: GALAXUS_SFTP_USER,
        password: GALAXUS_SFTP_PASSWORD,
      },
      async (client) => {
        const files = await listRemoteFiles(client, GALAXUS_SFTP_FEEDS_DIR);
        const matching = files.filter((file) => file.name.startsWith(prefix));
        if (!matching.length) {
          return { file: null, head: [] as string[] };
        }
        matching.sort((a, b) => (b.modifyTime ?? 0) - (a.modifyTime ?? 0));
        const latest = matching[0];
        const content = await downloadRemoteFile(client, latest.path);
        const head = content.split(/\r?\n/).slice(0, lineCount);
        return { file: latest, head, content };
      }
    );

    if (wantsDownload && result.file) {
      return new NextResponse(result.content ?? "", {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${result.file.name}"`,
          "X-Remote-Path": result.file.path,
        },
      });
    }

    return NextResponse.json({
      ok: true,
      file: result.file,
      head: result.head,
    });
  } catch (error: any) {
    console.error("[GALAXUS][FEEDS][PREVIEW] Failed:", error);
    return NextResponse.json(
      { ok: false, error: error?.message ?? "Preview failed." },
      { status: 500 }
    );
  }
}
