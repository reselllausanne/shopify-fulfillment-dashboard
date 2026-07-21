import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { buildSwissPostPayloadToHome, extractSwissPostLabelPayload } from "@/lib/swissPostHomeLabel";
import { requestSwissPostLabel } from "@/lib/swissPost";
import { createS3Storage } from "@/galaxus/storage/s3Storage";

const DEFAULT_LABEL_DIR = path.join(process.cwd(), ".data", "shopify-return-labels");
const LABEL_STORAGE_PREFIX = "return-labels";

function normalizeBaseUrl(value: string) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function extensionToMimeType(extension: string) {
  const ext = String(extension || "").trim().toLowerCase();
  if (ext === "pdf") return "application/pdf";
  if (ext === "png") return "image/png";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  return "application/octet-stream";
}

function resolveTrackingUrl(identCode: string | null) {
  if (!identCode) return null;
  return `https://service.post.ch/ekp-web/ui/entry/search/${encodeURIComponent(identCode)}`;
}

function sanitizeLabelKey(labelKey: string) {
  return labelKey.replace(/[^a-zA-Z0-9._-]/g, "").slice(0, 120);
}

function resolveLabelDirectory() {
  const fromEnv = String(process.env.SHOPIFY_RETURN_LABEL_DIR || "").trim();
  return fromEnv || DEFAULT_LABEL_DIR;
}

export function resolveShopifyReturnLabelPath(labelKey: string) {
  const key = sanitizeLabelKey(labelKey);
  if (!key) {
    throw new Error("Invalid label key");
  }
  const dir = resolveLabelDirectory();
  return path.join(dir, key);
}

export async function readShopifyReturnLabelFile(labelKey: string) {
  const cleanKey = sanitizeLabelKey(labelKey);
  if (!cleanKey) {
    throw new Error("Invalid label key");
  }
  const extension = path.extname(cleanKey).replace(/^\./, "") || "pdf";
  const mimeType = extensionToMimeType(extension);

  // Primary: fetch from Supabase via the stored s3 URL (durable, survives container rebuilds).
  try {
    const storageUrl = await resolveLabelStorageUrl(cleanKey);
    if (storageUrl) {
      const storage = createS3Storage();
      const { content } = await storage.getPdf(storageUrl);
      return { content, filePath: storageUrl, mimeType };
    }
  } catch (supabaseError) {
    console.warn("[RETURN_LABEL] Supabase fetch failed, falling back to local disk", {
      labelKey: cleanKey,
      error: supabaseError instanceof Error ? supabaseError.message : supabaseError,
    });
  }

  // Fallback: local filesystem (labels generated before the Supabase migration).
  const filePath = resolveShopifyReturnLabelPath(cleanKey);
  const content = await fs.readFile(filePath);
  return {
    content,
    filePath,
    mimeType,
  };
}

/**
 * Look up the s3 storage URL for a label key from the DB.
 * Returns null when the label was generated before the Supabase migration
 * (so the caller falls back to the local filesystem).
 */
async function resolveLabelStorageUrl(labelKey: string): Promise<string | null> {
  try {
    const { prisma } = await import("@/app/lib/prisma");
    const row = await (prisma as any).marketplaceReturn.findFirst({
      where: { labelKey },
      select: { labelStorageUrl: true },
    });
    return row?.labelStorageUrl ?? null;
  } catch {
    return null;
  }
}

type GenerateShopifyReturnLabelInput = {
  reference: string;
  publicBaseUrl: string;
  frankingLicenseOverride?: string;
};

export function resolveShopifyReturnFrankingLicense(inputOverride?: string) {
  const override = String(inputOverride || "").trim();
  if (override) return override;
  const returnLicense = String(process.env.SWISS_POST_RETURN_FRANKING_LICENSE || "").trim();
  if (returnLicense) return returnLicense;
  return String(process.env.SWISS_POST_FRANKING_LICENSE || "").trim();
}

export async function generateShopifyReturnLabel(input: GenerateShopifyReturnLabelInput) {
  const baseUrl = normalizeBaseUrl(input.publicBaseUrl);
  if (!baseUrl) {
    throw new Error("Missing public base URL for return label");
  }

  const frankingLicense = resolveShopifyReturnFrankingLicense(input.frankingLicenseOverride);
  const payload = buildSwissPostPayloadToHome({
    reference: input.reference,
    frankingLicenseOverride: frankingLicense,
  });
  const swissResult = await requestSwissPostLabel(payload);
  if (!swissResult.ok) {
    throw new Error(`Swiss Post label generation failed: HTTP ${swissResult.status}`);
  }

  const labelPayload = extractSwissPostLabelPayload(swissResult.data);
  if (!labelPayload?.base64) {
    throw new Error("Swiss Post response missing label content");
  }

  const key = `${crypto.randomUUID().replace(/-/g, "")}.${labelPayload.extension}`;
  const labelKey = sanitizeLabelKey(key);
  const labelBuffer = Buffer.from(labelPayload.base64, "base64");

  // Primary store: Supabase (private bucket, return-labels/ prefix). Durable across
  // container rebuilds and gives a single source of truth for the download URL.
  let labelStorageUrl: string | null = null;
  try {
    const storage = createS3Storage();
    const s3Key = `${LABEL_STORAGE_PREFIX}/${labelKey}`;
    const stored = await storage.uploadPdf(s3Key, labelBuffer);
    labelStorageUrl = stored.storageUrl;
  } catch (supabaseError) {
    console.error("[RETURN_LABEL] Supabase upload failed, falling back to local disk", {
      labelKey,
      error: supabaseError instanceof Error ? supabaseError.message : supabaseError,
    });
  }

  // Fallback store: local filesystem (so the flow still works if Supabase is unavailable).
  const filePath = resolveShopifyReturnLabelPath(labelKey);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, labelBuffer);

  const labelPublicUrl = `${baseUrl}/api/shopify/returns/label/${encodeURIComponent(labelKey)}`;
  const trackingNumber = labelPayload.identCode || null;
  return {
    labelKey,
    labelPublicUrl,
    labelStorageUrl,
    trackingNumber,
    trackingUrl: resolveTrackingUrl(trackingNumber),
    filePath,
    mimeType: extensionToMimeType(labelPayload.extension),
    swissResponse: swissResult.data,
  };
}
