import { SUPABASE_DOCS_BUCKET, SUPABASE_IMAGES_BUCKET } from "@/galaxus/config";
import { getStorageAdapterForBucket } from "@/galaxus/storage/storage";

const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_MAX_RETRIES = 2;

type HostedImageResult = {
  storageUrl: string;
  publicUrl: string;
  contentType: string;
  sizeBytes: number;
};

type DownloadResult = {
  buffer: Buffer;
  contentType: string;
  sizeBytes: number;
};

function isAbsoluteUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function normalizeContentType(value: string | null): string {
  if (!value) return "";
  return value.split(";")[0]?.trim().toLowerCase() ?? "";
}

function extensionFromContentType(contentType: string): string {
  switch (contentType) {
    case "image/jpeg":
    case "image/jpg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    case "image/avif":
      return "avif";
    default:
      return "jpg";
  }
}

function buildHeaders(sourceUrl: string): Record<string, string> {
  const headers: Record<string, string> = {
    "User-Agent": "Mozilla/5.0",
    Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
  };
  if (sourceUrl.includes("stockx")) {
    headers.Referer = "https://stockx.com/";
  }
  return headers;
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      method: "GET",
      redirect: "follow",
      headers: buildHeaders(url),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function downloadImage(sourceUrl: string, attempt = 0): Promise<DownloadResult> {
  const maxAttempts = DEFAULT_MAX_RETRIES + 1;
  try {
    if (!isAbsoluteUrl(sourceUrl)) {
      throw new Error("Source image URL is not absolute");
    }
    const response = await fetchWithTimeout(sourceUrl, DEFAULT_TIMEOUT_MS);
    if (!response.ok) {
      throw new Error(`Image download failed (${response.status})`);
    }
    const contentType = normalizeContentType(response.headers.get("content-type"));
    if (!contentType.startsWith("image/")) {
      throw new Error(`Invalid image content-type (${contentType || "unknown"})`);
    }
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    if (buffer.length === 0) {
      throw new Error("Downloaded image is empty");
    }
    return { buffer, contentType, sizeBytes: buffer.length };
  } catch (error: any) {
    if (attempt + 1 < maxAttempts) {
      const waitMs = 300 * (attempt + 1);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      return downloadImage(sourceUrl, attempt + 1);
    }
    throw error;
  }
}

export async function hostSupplierImage(params: {
  supplierVariantId: string;
  sourceImageUrl: string;
  imageVersion: number;
}): Promise<HostedImageResult> {
  const { supplierVariantId, sourceImageUrl, imageVersion } = params;
  const download = await downloadImage(sourceImageUrl);
  const extension = extensionFromContentType(download.contentType);
  const key = `supplier-images/${supplierVariantId}/main-v${imageVersion}.${extension}`;
  const bucket = SUPABASE_IMAGES_BUCKET || SUPABASE_DOCS_BUCKET;
  const storage = getStorageAdapterForBucket(bucket);
  if (!storage.uploadBinary) {
    throw new Error("Storage adapter does not support binary uploads.");
  }
  const stored = await storage.uploadBinary(key, download.buffer, download.contentType);
  const publicUrl = stored.publicUrl ?? null;
  if (!publicUrl) {
    throw new Error("Hosted image public URL missing (bucket may not be public).");
  }
  return {
    storageUrl: stored.storageUrl,
    publicUrl,
    contentType: download.contentType,
    sizeBytes: download.sizeBytes,
  };
}
