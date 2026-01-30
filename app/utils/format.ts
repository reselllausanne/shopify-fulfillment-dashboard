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

    const paramNames = ["AWB", "awb", "trackingNumber", "tracking_number", "waybill", "consignment", "shipmentNumber"];
    for (const param of paramNames) {
      const value = params.get(param);
      if (value && value.length >= 8) {
        const normalized = /^\d{13,}$/.test(value) ? value.slice(-12) : value;
        console.log(`[AWB] ✅ Extracted from param "${param}": ${normalized}`);
        return normalized;
      }
    }

    const pathMatch = trackingUrl.match(/\/([A-Z0-9]{10,})/);
    if (pathMatch && pathMatch[1].length >= 8) {
      const normalized = /^\d{13,}$/.test(pathMatch[1]) ? pathMatch[1].slice(-12) : pathMatch[1];
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

