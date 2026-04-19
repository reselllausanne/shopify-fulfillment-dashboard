import { NextResponse } from "next/server";
import {
  GALAXUS_SFTP_HOST,
  GALAXUS_SFTP_IN_DIR,
  GALAXUS_SFTP_PASSWORD,
  GALAXUS_SFTP_PORT,
  GALAXUS_SFTP_USER,
  assertSftpConfig,
} from "@/galaxus/edi/config";
import { listRemoteFiles, withSftp } from "@/galaxus/edi/sftpClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    assertSftpConfig();
    const result = await withSftp(
      {
        host: GALAXUS_SFTP_HOST,
        port: GALAXUS_SFTP_PORT,
        username: GALAXUS_SFTP_USER,
        password: GALAXUS_SFTP_PASSWORD,
      },
      async (client) => {
        const files = await listRemoteFiles(client, GALAXUS_SFTP_IN_DIR);
        return {
          ok: true,
          inDir: GALAXUS_SFTP_IN_DIR,
          fileCount: files.length,
        };
      }
    );

    return NextResponse.json(result);
  } catch (error: any) {
    console.error("[GALAXUS][EDI][PING] Failed:", error);
    return NextResponse.json(
      { ok: false, error: error?.message ?? "Ping failed." },
      { status: 500 }
    );
  }
}
