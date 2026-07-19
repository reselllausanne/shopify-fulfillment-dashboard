import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { buildSwissPostPayloadToHome, extractSwissPostLabelPayload } from "@/lib/swissPostHomeLabel";
import { requestSwissPostLabel } from "@/lib/swissPost";

const DEFAULT_LABEL_DIR = path.join(process.cwd(), ".data", "shopify-return-labels");

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
  const filePath = resolveShopifyReturnLabelPath(labelKey);
  const content = await fs.readFile(filePath);
  const extension = path.extname(filePath).replace(/^\./, "") || "pdf";
  return {
    content,
    filePath,
    mimeType: extensionToMimeType(extension),
  };
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
  const filePath = resolveShopifyReturnLabelPath(labelKey);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, Buffer.from(labelPayload.base64, "base64"));

  const labelPublicUrl = `${baseUrl}/api/shopify/returns/label/${encodeURIComponent(labelKey)}`;
  const trackingNumber = labelPayload.identCode || null;
  return {
    labelKey,
    labelPublicUrl,
    trackingNumber,
    trackingUrl: resolveTrackingUrl(trackingNumber),
    filePath,
    mimeType: extensionToMimeType(labelPayload.extension),
    swissResponse: swissResult.data,
  };
}
