// Numeric helpers
export const toNumber = (value: any): number => {
  if (typeof value === "number") return value;
  if (typeof value === "string") return parseFloat(value) || 0;
  if (value && typeof value === "object" && "toNumber" in value) return (value as any).toNumber();
  return 0;
};

// AWB extraction from tracking URL
export const extractAwbFromTrackingUrl = (trackingUrl: string | null): string | null => {
  if (!trackingUrl) {
    console.log(`[AWB] No tracking URL provided`);
    return null;
  }

  try {
    const url = new URL(trackingUrl);
    const params = url.searchParams;
    const normalizeAwb = (raw: string | null): string | null => {
      if (!raw) return null;
      const first = raw.split(/[,\s|;]+/)[0] || "";
      const cleaned = first.replace(/[^A-Z0-9]/gi, "").toUpperCase();
      if (!cleaned) return null;
      if (/^\d{13,}$/.test(cleaned)) return cleaned.slice(-12);
      if (/^1Z[0-9A-Z]{16}$/.test(cleaned)) return cleaned;
      if (/^[A-Z0-9]{8,}$/.test(cleaned)) return cleaned;
      return null;
    };

    const paramNames = [
      "AWB",
      "awb",
      "trackingNumber",
      "tracking_number",
      "tracknum",
      "trackNum",
      "track_number",
      "waybill",
      "consignment",
      "shipmentNumber",
    ];
    for (const param of paramNames) {
      const value = params.get(param);
      const normalized = normalizeAwb(value);
      if (normalized) {
        console.log(`[AWB] ✅ Extracted from param "${param}": ${normalized}`);
        return normalized;
      }
    }

    const pathSegments = url.pathname.split("/").filter(Boolean);
    for (const segment of pathSegments) {
      const normalized = normalizeAwb(segment);
      if (!normalized) continue;
      console.log(`[AWB] ✅ Extracted from path: ${normalized}`);
      return normalized;
    }

    console.log(`[AWB] ❌ Could not extract AWB from: ${trackingUrl}`);
    return null;
  } catch (error) {
    console.log(`[AWB] ❌ Error parsing URL: ${trackingUrl}`);
    return null;
  }
};

