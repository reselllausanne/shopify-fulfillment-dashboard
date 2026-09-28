/**
 * QZ Tray security helpers (server).
 * Private signing key NEVER leaves the server.
 */

export function getQzPublicCertificate(): string | null {
  const raw =
    process.env.QZ_PUBLIC_CERT ||
    process.env.QZ_CERTIFICATE ||
    process.env.NEXT_PUBLIC_QZ_PUBLIC_CERT ||
    "";
  const trimmed = String(raw).trim();
  return trimmed.length > 0 ? trimmed.replace(/\\n/g, "\n") : null;
}

export function getQzPrivateKey(): string | null {
  const raw = process.env.QZ_PRIVATE_KEY || process.env.QZ_SIGNING_KEY || "";
  const trimmed = String(raw).trim();
  return trimmed.length > 0 ? trimmed.replace(/\\n/g, "\n") : null;
}

export function qzSecurityConfigured(): boolean {
  return Boolean(getQzPublicCertificate() && getQzPrivateKey());
}
