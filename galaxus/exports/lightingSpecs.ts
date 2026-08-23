/**
 * Parse lighting attributes from Reichelt / Müller Licht style titles
 * into Galaxus ProductData Specification rows.
 */

export type LightingSpecRow = {
  ProviderKey: string;
  SpecificationKey: string;
  SpecificationValue: string;
};

export type ParsedLightingAttrs = {
  watts: string | null;
  kelvin: string | null;
  lengthMm: string | null;
  lengthCm: string | null;
  lumens: string | null;
  socket: string | null;
  tubeType: string | null;
};

/** French titles often look like "3 6500 K" / "2 2700 K" — take the Kelvin cluster. */
function parseKelvin(title: string): string | null {
  const spaced = title.match(/(?:^|[^\d])(\d)\s+(\d{3,4})\s*K\b/i);
  if (spaced) {
    const a = Number(spaced[1]);
    const b = Number(spaced[2]);
    // "6 500 K" = 6500; "3 6500 K" = pack-prefix junk + 6500
    if (b >= 1800 && b <= 10000) return String(b);
    const merged = Number(`${a}${b}`);
    if (merged >= 1800 && merged <= 10000) return String(merged);
  }
  const plain = title.match(/\b(\d{3,5})\s*K\b/i);
  if (plain) {
    const k = Number(plain[1]);
    if (k >= 1800 && k <= 10000) return String(k);
  }
  return null;
}

function parseLengthMm(title: string): string | null {
  const m = title.match(/\b(\d{3,5})\s*mm\b/i);
  if (!m) return null;
  let mm = Number(m[1]);
  // Reichelt FR sometimes emits 12000 for 1200 mm tubes
  if (mm >= 6000 && mm <= 20000 && mm % 10 === 0) {
    const fixed = mm / 10;
    if (fixed >= 300 && fixed <= 2000) mm = fixed;
  }
  if (mm < 50 || mm > 5000) return null;
  return String(Math.round(mm));
}

function parseSocket(title: string): string | null {
  const m = title.match(/\b(G13|G5|GU10|GU5\.?3|GU4|E27|E14|E40|MR16|GX53)\b/i);
  if (!m) return null;
  const raw = m[1].toUpperCase().replace("GU53", "GU5.3");
  return raw === "GU5.3" || raw === "GU53" ? "GU5.3" : raw;
}

function parseTubeType(title: string): string | null {
  const m = title.match(/\b(T5|T8|T4)\b/i);
  return m ? m[1].toUpperCase() : null;
}

export function parseLightingAttrsFromTitle(title: string | null | undefined): ParsedLightingAttrs {
  const t = String(title ?? "").replace(/\s+/g, " ").trim();
  const wattsMatch = t.match(/\b(\d+(?:[.,]\d+)?)\s*W\b/i);
  const lmMatch = t.match(/\b(\d[\d\s]*)\s*lm\b/i);
  const lengthMm = parseLengthMm(t);
  let lumens: string | null = null;
  if (lmMatch) {
    const n = Number(lmMatch[1].replace(/\s+/g, ""));
    if (Number.isFinite(n) && n > 0 && n < 200000) lumens = String(Math.round(n));
  }
  return {
    watts: wattsMatch ? wattsMatch[1].replace(",", ".") : null,
    kelvin: parseKelvin(t),
    lengthMm,
    lengthCm: lengthMm ? String(Math.round(Number(lengthMm) / 10)) : null,
    lumens,
    socket: parseSocket(t),
    tubeType: parseTubeType(t),
  };
}

export function buildLightingSpecRows(input: {
  providerKey: string;
  title?: string | null;
}): LightingSpecRow[] {
  const providerKey = String(input.providerKey ?? "").trim();
  if (!providerKey) return [];
  const attrs = parseLightingAttrsFromTitle(input.title);
  const rows: LightingSpecRow[] = [];
  const push = (key: string, value: string | null) => {
    if (!value) return;
    rows.push({ ProviderKey: providerKey, SpecificationKey: key, SpecificationValue: value });
  };
  push("Power consumption", attrs.watts ? `${attrs.watts} W` : null);
  push("Colour temperature", attrs.kelvin ? `${attrs.kelvin} K` : null);
  push("Length (cm)", attrs.lengthCm);
  push("Luminous flux", attrs.lumens ? `${attrs.lumens} lm` : null);
  push("Lamp socket", attrs.socket);
  push("Bulb type", attrs.tubeType);
  return rows;
}

export function buildLightingDescriptionBits(title: string | null | undefined): string {
  const a = parseLightingAttrsFromTitle(title);
  const bits: string[] = [];
  if (a.tubeType) bits.push(a.tubeType);
  if (a.socket) bits.push(`socket ${a.socket}`);
  if (a.watts) bits.push(`${a.watts} W`);
  if (a.lumens) bits.push(`${a.lumens} lm`);
  if (a.kelvin) bits.push(`${a.kelvin} K`);
  if (a.lengthMm) bits.push(`${a.lengthMm} mm`);
  return bits.join(", ");
}
