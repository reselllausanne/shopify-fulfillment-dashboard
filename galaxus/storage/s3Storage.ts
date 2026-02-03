import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { Readable } from "stream";
import {
  SUPABASE_DOCS_BUCKET,
  SUPABASE_SERVICE_ROLE_KEY,
  SUPABASE_SERVICE_ROLE_KEY_SECRET,
  SUPABASE_URL,
} from "../config";
import type { StorageAdapter, StoredFile, StorageFileResult } from "./types";

export function createS3Storage(bucketOverride?: string): StorageAdapter {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !SUPABASE_SERVICE_ROLE_KEY_SECRET) {
    throw new Error("Supabase S3 env vars are missing.");
  }

  const client = new S3Client({
    region: "auto",
    endpoint: SUPABASE_URL,
    credentials: {
      accessKeyId: SUPABASE_SERVICE_ROLE_KEY,
      secretAccessKey: SUPABASE_SERVICE_ROLE_KEY_SECRET,
    },
    forcePathStyle: true,
  });

  const bucket = bucketOverride ?? SUPABASE_DOCS_BUCKET;

  return {
    async uploadPdf(key: string, content: Buffer): Promise<StoredFile> {
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: content,
          ContentType: "application/pdf",
        })
      );
      return { storageUrl: `s3://${bucket}/${key}` };
    },

    async getPdf(storageUrl: string): Promise<StorageFileResult> {
      const { bucket: parsedBucket, key } = parseS3Url(storageUrl);
      const response = await client.send(
        new GetObjectCommand({
          Bucket: parsedBucket,
          Key: key,
        })
      );
      if (!response.Body) {
        throw new Error("S3 download failed: empty body.");
      }
      const content = await streamToBuffer(response.Body as Readable);
      return { content };
    },
  };
}

export function isS3Url(storageUrl: string): boolean {
  return storageUrl.startsWith("s3://");
}

export function parseS3Url(storageUrl: string): { bucket: string; key: string } {
  const withoutPrefix = storageUrl.replace("s3://", "");
  const [bucket, ...keyParts] = withoutPrefix.split("/");
  if (!bucket || keyParts.length === 0) {
    throw new Error(`Invalid s3 storage url: ${storageUrl}`);
  }
  return { bucket, key: keyParts.join("/") };
}

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
