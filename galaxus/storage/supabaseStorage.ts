import { createClient } from "@supabase/supabase-js";
import { GALAXUS_DOCS_BUCKET, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL } from "../config";
import type { StorageAdapter, StoredFile, StorageFileResult } from "./types";

export function createSupabaseStorage(bucketOverride?: string): StorageAdapter {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Supabase storage env vars are missing.");
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const bucket = bucketOverride ?? GALAXUS_DOCS_BUCKET;

  return {
    async uploadPdf(key: string, content: Buffer): Promise<StoredFile> {
      const { error } = await supabase.storage.from(bucket).upload(key, content, {
        contentType: "application/pdf",
        upsert: true,
      });

      if (error) {
        throw new Error(`Supabase upload failed: ${error.message}`);
      }

      return { storageUrl: `supabase://${bucket}/${key}` };
    },

    async getPdf(storageUrl: string): Promise<StorageFileResult> {
      const { bucket: parsedBucket, key } = parseSupabaseUrl(storageUrl);
      const { data, error } = await supabase.storage.from(parsedBucket).download(key);
      if (error || !data) {
        throw new Error(`Supabase download failed: ${error?.message ?? "no data"}`);
      }
      const arrayBuffer = await data.arrayBuffer();
      return { content: Buffer.from(arrayBuffer) };
    },
  };
}

export function isSupabaseUrl(storageUrl: string): boolean {
  return storageUrl.startsWith("supabase://");
}

export function parseSupabaseUrl(storageUrl: string): { bucket: string; key: string } {
  const withoutPrefix = storageUrl.replace("supabase://", "");
  const [bucket, ...keyParts] = withoutPrefix.split("/");
  if (!bucket || keyParts.length === 0) {
    throw new Error(`Invalid supabase storage url: ${storageUrl}`);
  }
  return { bucket, key: keyParts.join("/") };
}
