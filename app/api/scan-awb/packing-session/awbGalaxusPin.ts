export type AwbGalaxusPin = {
  galaxusOrderRef: string;
  galaxusOrderLineId?: string;
  unitIndex?: number;
  stockxOrderNumber?: string | null;
};

export type GalaxusPinLine = {
  id: string;
  order: { galaxusOrderId: string };
};

/** Restrict warehouse line candidates to the Galaxus order (and line) tied to this StockX buy. */
export function filterGalaxusLinesForAwbPin<T extends GalaxusPinLine>(
  lines: T[],
  pin: AwbGalaxusPin | null
): T[] {
  if (!pin?.galaxusOrderRef) return lines;
  let out = lines.filter((l) => l.order.galaxusOrderId === pin.galaxusOrderRef);
  if (pin.galaxusOrderLineId) {
    out = out.filter((l) => l.id === pin.galaxusOrderLineId);
  }
  return out;
}

export function awbAlreadyInPackingSession(params: {
  awbCandidates: string[];
  sessionScanCodes: string[];
  normalize: (raw: string) => string[];
}): boolean {
  const target = new Set(params.awbCandidates.map((c) => c.toUpperCase()).filter(Boolean));
  if (target.size === 0) return false;
  for (const raw of params.sessionScanCodes) {
    const prev = params.normalize(String(raw ?? "").trim());
    if (prev.some((c) => target.has(c.toUpperCase()))) return true;
  }
  return false;
}
