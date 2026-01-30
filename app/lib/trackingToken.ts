import crypto from "node:crypto";

const SECRET = process.env.TRACKING_PAGE_SECRET || "default-secret";
const TTL_SECONDS = Number(process.env.TRACKING_PAGE_TTL_SECONDS || 60 * 60); // 1 hour

export function createTrackingToken(orderMatchId: string) {
  const issuedAt = Math.floor(Date.now() / 1000);
  const payload = `${orderMatchId}:${issuedAt}`;
  const signature = crypto
    .createHmac("sha256", SECRET)
    .update(payload)
    .digest("hex");
  return Buffer.from(`${payload}:${signature}`).toString("base64url");
}

export function verifyTrackingToken(token: string) {
  try {
    const decoded = Buffer.from(token, "base64url").toString("utf-8");
    const [orderMatchId, issuedAtStr, signature] = decoded.split(":");
    if (!orderMatchId || !issuedAtStr || !signature) return null;
    const now = Math.floor(Date.now() / 1000);
    const issuedAt = Number(issuedAtStr);
    if (Number.isNaN(issuedAt) || now - issuedAt > TTL_SECONDS) return null;
    const payload = `${orderMatchId}:${issuedAt}`;
    const expected = crypto.createHmac("sha256", SECRET).update(payload).digest("hex");
    if (signature !== expected) return null;
    return { orderMatchId };
  } catch {
    return null;
  }
}

