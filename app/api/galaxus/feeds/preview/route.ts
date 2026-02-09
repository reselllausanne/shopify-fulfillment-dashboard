import { NextResponse } from "next/server";
import {
  GALAXUS_SFTP_HOST,
  GALAXUS_SFTP_OUT_DIR,
  GALAXUS_SFTP_PASSWORD,
  GALAXUS_SFTP_PORT,
  GALAXUS_SFTP_USER,
  assertSftpConfig,
} from "@/galaxus/edi/config";
import { downloadRemoteFile, listRemoteFiles, withSftp } from "@/galaxus/edi/sftpClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PreviewType = "master" | "stock";

function resolvePrefix(type: PreviewType): string {
  return `galaxus-${type}-`;
}

export async function GET(request: Request) {
  try {
    assertSftpConfig();
    const { searchParams } = new URL(request.url);
    const type = (searchParams.get("type") ?? "master") as PreviewType;
    if (type !== "master" && type !== "stock") {
      return NextResponse.json({ ok: false, error: "Invalid type." }, { status: 400 });
    }

    const lineCount = Math.min(Math.max(Number(searchParams.get("lines") ?? "5"), 1), 50);
    const prefix = resolvePrefix(type);

    const result = await withSftp(
      {
        host: GALAXUS_SFTP_HOST,
        port: GALAXUS_SFTP_PORT,
        username: GALAXUS_SFTP_USER,
        password: GALAXUS_SFTP_PASSWORD,
      },
      async (client) => {
        const files = await listRemoteFiles(client, GALAXUS_SFTP_OUT_DIR);
        const matching = files.filter((file) => file.name.startsWith(prefix));
        if (!matching.length) {
          return { file: null, head: [] as string[] };
        }
        matching.sort((a, b) => (b.modifyTime ?? 0) - (a.modifyTime ?? 0));
        const latest = matching[0];
        const content = await downloadRemoteFile(client, latest.path);
        const head = content.split(/\r?\n/).slice(0, lineCount);
        return { file: latest, head };
      }
    );

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
