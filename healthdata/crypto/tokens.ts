import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

import { HealthConfigError, resolveHealthConfig } from "@/healthdata/config";

const ALGO = "aes-256-gcm";
const IV_LEN = 12;
const TAG_LEN = 16;

function resolveKeyBytes(): Buffer {
  const raw = resolveHealthConfig().tokenEncryptionKey;
  if (!raw) {
    throw new HealthConfigError(["HEALTH_TOKEN_ENCRYPTION_KEY"]);
  }
  // Accept 64-hex (32 bytes) or any passphrase (sha256-derived).
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    return Buffer.from(raw, "hex");
  }
  return createHash("sha256").update(raw, "utf8").digest();
}

/**
 * Encrypt a secret at rest. Output format: base64(iv || tag || ciphertext).
 * Never log the plaintext or ciphertext of OAuth tokens in application logs.
 */
export function encryptSecret(plaintext: string): string {
  const key = resolveKeyBytes();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString("base64");
}

export function decryptSecret(payload: string): string {
  const key = resolveKeyBytes();
  const buf = Buffer.from(payload, "base64");
  if (buf.length < IV_LEN + TAG_LEN + 1) {
    throw new Error("Invalid encrypted payload");
  }
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ciphertext = buf.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

export function hasTokenEncryptionKey(): boolean {
  return Boolean(resolveHealthConfig().tokenEncryptionKey);
}

/** Safe descriptor for logs / UI — never includes token material. */
export function describeEncryptedBlob(value: string | null | undefined): string {
  if (!value) return "absent";
  return `encrypted (${value.length} chars)`;
}
