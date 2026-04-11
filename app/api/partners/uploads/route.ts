import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { getPartnerSession } from "@/app/lib/partnerAuth";
import { enqueueJob } from "@/galaxus/jobs/queue";
import {
  partnerCsvQueueFilePath,
  runPartnerCsvImport,
} from "@/galaxus/partners/partnerCsvImport";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Large CSV upload over the wire; processing runs in a worker */
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const session = await getPartnerSession(req);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const dryRun = ["1", "true", "yes"].includes((searchParams.get("dryRun") ?? "").toLowerCase());
  const sync = searchParams.get("sync") === "1";

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  if (!file) {
    return NextResponse.json({ error: "CSV file required" }, { status: 400 });
  }

  const prismaAny = prisma as any;
  const origin = new URL(req.url).origin;

  if (dryRun) {
    try {
      const text = await file.text();
      const result = await runPartnerCsvImport(text, {
        partnerId: session.partnerId,
        uploadId: null,
        dryRun: true,
        origin: null,
      });
      return NextResponse.json({ ok: true, result });
    } catch (error: any) {
      return NextResponse.json({ error: error.message ?? "Upload failed" }, { status: 500 });
    }
  }

  if (sync) {
    const upload = await prismaAny.partnerUpload.create({
      data: {
        partnerId: session.partnerId,
        filename: file.name ?? "upload.csv",
        status: "PROCESSING",
      },
    });
    try {
      const text = await file.text();
      const result = await runPartnerCsvImport(text, {
        partnerId: session.partnerId,
        uploadId: upload.id,
        dryRun: false,
        origin,
      });
      return NextResponse.json({ ok: true, result });
    } catch (error: any) {
      await prismaAny.partnerUpload.update({
        where: { id: upload.id },
        data: {
          status: "FAILED",
          errorsJson: [{ message: error.message ?? "Upload failed" }],
        },
      });
      return NextResponse.json({ error: error.message ?? "Upload failed" }, { status: 500 });
    }
  }

  const upload = await prismaAny.partnerUpload.create({
    data: {
      partnerId: session.partnerId,
      filename: file.name ?? "upload.csv",
      status: "QUEUED",
    },
  });

  const filePath = partnerCsvQueueFilePath(upload.id);
  try {
    await mkdir(path.dirname(filePath), { recursive: true });
    const buffer = Buffer.from(await file.arrayBuffer());
    await writeFile(filePath, buffer);
  } catch (error: any) {
    await prismaAny.partnerUpload
      .delete({ where: { id: upload.id } })
      .catch(() => {});
    return NextResponse.json(
      { error: error?.message ?? "Could not store upload for processing" },
      { status: 500 }
    );
  }

  const job = await enqueueJob(
    "partner-csv-import",
    { uploadId: upload.id, partnerId: session.partnerId, origin },
    { priority: 5, groupKey: `partner:${session.partnerId}` }
  );

  return NextResponse.json(
    { ok: true, queued: true, jobId: job.id, uploadId: upload.id },
    { status: 202 }
  );
}
