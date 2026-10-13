/**
 * Reichelt (REI) Galaxus allowlist (Oct 2026): Galaxus asked for a fashion-only feed, so the
 * REI catalog is delisted except proven sellers — items with ≥2 Galaxus orders (minus the
 * Ansmann AA battery: wrong GTIN) and Raspberry Pi accessories that sold at least once.
 * Kill switch: GALAXUS_REI_ALLOWLIST=0 (full REI catalog again).
 */
const REI_GALAXUS_ALLOWED_GTINS = [
  // ≥2 orders
  "0840006674900", // Corsair Vengeance DDR5 2x16GB 6000
  "4013674189748", // Ansmann WL5000R work light
  "4014619018789", // Good Connections Cat.6 patch cable 3 m
  "4018412699091", // Müller Licht GLEN camping light
  "4019524100222", // ProCar cigarette lighter plug
  "4026423000737", // FeinTech LT920 LED floor lamp
  "4040849547935", // Goobay 3-12 V universal power supply
  "4043619671618", // Delock D-Sub 37 Y-splitter
  "4043619801800", // Delock RJ45 Cat.8.1 flat cable 2 m
  "4058075432635", // Osram Line R7s
  "4066857003010", // Kabelmeister solar window feed-through
  "4066966321630", // Wago through connector
  "4250312503485", // CSX DDR3-1600 4GB
  "4250551405441", // Smrter USB-C / Lightning / Micro USB cable
  "4250967312210", // McShine E14 pendant lamp
  "4250967341203", // Einlicht Halo LED clamp lamp
  "4255606502403", // Blulaxa LED strip 1 m battery
  "4255719605428", // Luxula LED G9 7 W
  "6971636401735", // Creality K1C
  "6975514333088", // Hoymiles HiFlow1600 Pro micro-inverter
  "3800170201699", // V-Tac VT-61006 recessed LED
  // Raspberry Pi accessories (≥1 order)
  "4710679550749", // Akasa Maze case Pi 4
  "4710679550008", // Akasa aluminium case Pi 4B + thermal kit
  "4710679550138", // Akasa Gem Pro Pi-4 case
  "4260439550620", // HiFiBerry DAC+ ADC Pro shield
  "4260439550712", // HiFiBerry case4 DAC+
  "4260439551030", // HiFiBerry DAC2 ADC Pro shield
  "5056561804224", // Raspberry Pi SC1645 128GB microSDXC
  "5056561805306", // Raspberry Pi Compute Module 5 2GB Lite
  "7350001161778", // Pi 5 aluminium case for NVMe
  "7350001162034", // Kksb HAT case Pi 5
  "7350001162089", // Kksb case Pi 5 + M.2 NVMe HAT
  "7350001162201", // Kksb 10" rack case Pi 3/4/5
  "7350001162249", // Kksb case Pi 5 dual HATs
  "0732388665006", // Soldered T-Cobbler
] as const;

const ALLOWED_PROVIDER_KEYS = new Set(REI_GALAXUS_ALLOWED_GTINS.map((gtin) => `REI_${gtin}`));

export function isGalaxusReiAllowlistEnabled(): boolean {
  const raw = String(process.env.GALAXUS_REI_ALLOWLIST ?? "1").trim().toLowerCase();
  return !["0", "false", "no", "off"].includes(raw);
}

export function isReiGalaxusAllowlisted(providerKey: string | null | undefined): boolean {
  return ALLOWED_PROVIDER_KEYS.has(String(providerKey ?? "").trim().toUpperCase());
}

export function reiGalaxusAllowlistSize(): number {
  return ALLOWED_PROVIDER_KEYS.size;
}
