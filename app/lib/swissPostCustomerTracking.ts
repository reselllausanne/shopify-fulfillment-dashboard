export function shopifyOrderIdAliases(raw: string | number | null | undefined): string[] {
  const value = String(raw ?? "").trim();
  if (!value) return [];
  const numeric = value.replace(/^gid:\/\/shopify\/Order\//i, "").trim();
  const gid = numeric ? `gid://shopify/Order/${numeric}` : "";
  const out: string[] = [];
  for (const candidate of [value, numeric, gid]) {
    if (candidate && !out.includes(candidate)) out.push(candidate);
  }
  return out;
}

export function buildSwissPostTrackingUrl(trackingNumber: string): string {
  const code = trackingNumber.trim();
  return `https://service.post.ch/ekp-web/ui/entry/search/${encodeURIComponent(code)}`;
}

export function isSwissPostTrackingUrl(raw: string | null | undefined): boolean {
  const value = String(raw ?? "").trim();
  if (!value) return false;
  try {
    const host = new URL(value).hostname.toLowerCase();
    return host.includes("post.ch") || host.includes("swisspost");
  } catch {
    return false;
  }
}

export function looksLikeSwissPostIdent(raw: string | null | undefined): boolean {
  const value = String(raw ?? "").trim();
  if (!value) return false;
  if (/^99\.\d{2}\.\d{6,}$/.test(value)) return true;
  const compact = value.replace(/[\s.]/g, "");
  if (/^99\d{16}$/.test(compact)) return true;
  if (/^\d{18}$/.test(compact) && compact.startsWith("99")) return true;
  return false;
}

function looksLikeForeignCarrierTracking(raw: string): boolean {
  const value = raw.trim().toUpperCase();
  if (value.startsWith("1Z")) return true;
  if (/^GB\d+/i.test(value)) return true;
  if (value.startsWith("DHL")) return true;
  return false;
}

export function isSwissPostOutbound(opts: {
  trackingNumber?: string | null;
  trackingUrl?: string | null;
  trackingCompany?: string | null;
}): boolean {
  const trackingNumber = String(opts.trackingNumber ?? "").trim();
  if (trackingNumber && looksLikeForeignCarrierTracking(trackingNumber)) return false;
  if (isSwissPostTrackingUrl(opts.trackingUrl)) return true;
  if (looksLikeSwissPostIdent(trackingNumber)) return true;
  const company = String(opts.trackingCompany ?? "").toLowerCase();
  const companyLooksSwiss = company.includes("post") || company.includes("poste") || company.includes("swiss");
  const compact = trackingNumber.replace(/[\s.]/g, "");
  if (companyLooksSwiss && /^\d{12,}$/.test(compact)) return true;
  return false;
}

export function resolveSwissPostCustomerTracking(opts: {
  trackingNumber?: string | null;
  trackingUrl?: string | null;
  trackingCompany?: string | null;
}): { trackingNumber: string; trackingUrl: string } | null {
  const trackingNumber = String(opts.trackingNumber ?? "").trim();
  const trackingUrlRaw = String(opts.trackingUrl ?? "").trim();
  if (!trackingNumber && !trackingUrlRaw) return null;
  if (!isSwissPostOutbound(opts)) return null;

  const trackingUrl = isSwissPostTrackingUrl(trackingUrlRaw)
    ? trackingUrlRaw
    : trackingNumber
      ? buildSwissPostTrackingUrl(trackingNumber)
      : trackingUrlRaw;
  if (!trackingUrl) return null;
  return {
    trackingNumber: trackingNumber || trackingUrl,
    trackingUrl,
  };
}
