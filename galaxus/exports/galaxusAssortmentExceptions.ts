/**
 * Galaxus assortment exception ledger (Tali / category-management trail).
 *
 * Source of truth for every deliberate hole in fashion-only / supplier-disabled /
 * price-cap policy. Add a row whenever we contourne a gate for a SKU trial.
 *
 * Policy-wide holes (e.g. all LEGO vs 300 CHF cap) live in
 * {@link GALAXUS_POLICY_EXCEPTIONS}. Per-SKU holes in
 * {@link GALAXUS_ASSORTMENT_EXCEPTIONS}.
 *
 * Mail dump: `npx tsx scripts/print-galaxus-assortment-exceptions.ts`
 */

export type GalaxusGateId =
  | "fashion_only"
  | "supplier_disabled"
  | "price_cap_300"
  | "category_block";

export type GalaxusAssortmentExceptionReason =
  | "sold_before"
  | "market_gap"
  | "overpriced_rivals"
  | "manual_trial"
  | "partner_request"
  | "policy";

export type GalaxusAssortmentException = {
  /** Provider key as written to Galaxus feeds (e.g. BWZ_5060…). */
  providerKey: string;
  gtin?: string;
  title: string;
  supplierKey: string;
  /** Which assortment gates this row punches through. */
  gates: GalaxusGateId[];
  /** Bypass galaxusDisabledSuppliers (default includes whole BWZ). */
  bypassSupplierDisabled?: boolean;
  /** Bypass fashion-only filter for this provider key. */
  bypassFashionOnly?: boolean;
  /** Bypass galaxusCategoryBlocklist.json for this provider key. */
  bypassCategoryBlock?: boolean;
  reason: GalaxusAssortmentExceptionReason;
  /** Free-text: buy source, MOQ, target sell, hypothesis. */
  note: string;
  /** ISO date added (YYYY-MM-DD). */
  addedAt: string;
  /** Optional review / kill date. */
  reviewAt?: string;
  active: boolean;
};

/** Policy-level exceptions (not a single ProviderKey). */
export type GalaxusPolicyException = {
  id: string;
  title: string;
  gates: GalaxusGateId[];
  reason: GalaxusAssortmentExceptionReason;
  note: string;
  addedAt: string;
  reviewAt?: string;
  active: boolean;
};

/** Active + historical per-SKU ledger. Prefer active:true for live feed holes. */
export const GALAXUS_ASSORTMENT_EXCEPTIONS: GalaxusAssortmentException[] = [
  {
    providerKey: "STX_041604418976",
    gtin: "041604418976",
    title: "Stanley Chocolate Flowstate Quencher 40oz",
    supplierKey: "stx",
    gates: ["fashion_only"],
    bypassFashionOnly: true,
    reason: "sold_before",
    note: "Non-fashion keep — sold on Galaxus before fashion-only filter.",
    addedAt: "2026-10-13",
    active: true,
  },
  {
    providerKey: "BWZ_5060420232721",
    gtin: "5060420232721",
    title: "Lansinoh Intim-Dusche / Post-Birth Wash Bottle",
    supplierKey: "bwz",
    gates: ["supplier_disabled", "fashion_only"],
    bypassSupplierDisabled: true,
    bypassFashionOnly: true,
    reason: "manual_trial",
    note: "Redcare rebuy trial; sold B2B Sep 2026 @ CHF 13 net; MOQ 5. Not a permanent BWZ reopen.",
    addedAt: "2026-10-23",
    reviewAt: "2026-11-15",
    active: true,
  },
  {
    providerKey: "BWZ_5060420233353",
    gtin: "5060420233353",
    title: "Lansinoh HPA Lanolin Brustwarzencreme 10 ml",
    supplierKey: "bwz",
    gates: ["supplier_disabled", "fashion_only", "category_block"],
    bypassSupplierDisabled: true,
    bypassFashionOnly: true,
    bypassCategoryBlock: true,
    reason: "overpriced_rivals",
    note: "Live Galaxus CHF 29.99 incl; our formula ~17.24; BWZ/Redcare buy ~8.80–8.95. Sister SKU to Intim-Dusche trial. Also in galaxusCategoryBlocklist (bwz_bath_changing_potty).",
    addedAt: "2026-10-23",
    reviewAt: "2026-11-15",
    active: true,
  },
  {
    providerKey: "STX_673419130585",
    gtin: "673419130585",
    title: "LEGO Creator Expert Taj Mahal Set 10189",
    supplierKey: "stx",
    gates: ["price_cap_300"],
    // LEGO kind already fashion-exempt + price-cap exempt; tracked for Tali trial list.
    bypassFashionOnly: false,
    reason: "manual_trial",
    note: "Force-imported from StockX (standard lane). Relies on LEGO kind exemptions. Watch margin vs Galaxus.",
    addedAt: "2026-10-23",
    reviewAt: "2026-11-15",
    active: true,
  },
  {
    providerKey: "STX_5702018066386",
    gtin: "5702018066386",
    title: "LEGO Art: Gustav Klimt The Kiss Set #31221",
    supplierKey: "stx",
    gates: ["price_cap_300"],
    bypassFashionOnly: false,
    reason: "manual_trial",
    note: "Buy lego.com CHF 329; manualLock qty1 sell ex 419 / SRP 452.95. Open Galaxus WH order 204958466 still needs ship. Relies on LEGO kind price-cap exemption.",
    addedAt: "2026-10-23",
    reviewAt: "2026-11-15",
    active: true,
  },
];

/**
 * Category / kind holes that are not a single ProviderKey (still tell Tali).
 */
export const GALAXUS_POLICY_EXCEPTIONS: GalaxusPolicyException[] = [
  {
    id: "lego_price_cap",
    title: "All LEGO sets (product kind = lego)",
    gates: ["price_cap_300"],
    reason: "policy",
    note: "Fashion absolute cap GALAXUS_MAX_RETAIL_CHF (default 300) does not apply to LEGO kind — Art/Icons MSRP routinely 300–500+ CHF. Shipped 2026-10-23 for Klimt #31221 relist.",
    addedAt: "2026-10-23",
    active: true,
  },
];

function activeSkuExceptions(): GalaxusAssortmentException[] {
  return GALAXUS_ASSORTMENT_EXCEPTIONS.filter((e) => e.active);
}

function activePolicyExceptions(): GalaxusPolicyException[] {
  return GALAXUS_POLICY_EXCEPTIONS.filter((e) => e.active);
}

export function galaxusFashionExemptProviderKeys(): ReadonlySet<string> {
  return new Set(
    activeSkuExceptions()
      .filter((e) => e.bypassFashionOnly || e.gates.includes("fashion_only"))
      .map((e) => e.providerKey.trim().toUpperCase())
  );
}

export function galaxusDisabledSupplierExemptProviderKeys(): ReadonlySet<string> {
  return new Set(
    activeSkuExceptions()
      .filter((e) => e.bypassSupplierDisabled || e.gates.includes("supplier_disabled"))
      .map((e) => e.providerKey.trim().toUpperCase())
  );
}

export function galaxusCategoryBlockExemptProviderKeys(): ReadonlySet<string> {
  return new Set(
    activeSkuExceptions()
      .filter((e) => e.bypassCategoryBlock || e.gates.includes("category_block"))
      .map((e) => e.providerKey.trim().toUpperCase())
  );
}

export function findGalaxusAssortmentException(
  providerKey: string | null | undefined
): GalaxusAssortmentException | null {
  const key = String(providerKey ?? "")
    .trim()
    .toUpperCase();
  if (!key) return null;
  return activeSkuExceptions().find((e) => e.providerKey.trim().toUpperCase() === key) ?? null;
}

const GATE_LABEL: Record<GalaxusGateId, string> = {
  fashion_only: "fashion-only (non-Mode blocked)",
  supplier_disabled: "supplier disabled (BWZ default off)",
  price_cap_300: "absolute price cap (GALAXUS_MAX_RETAIL_CHF, default 300)",
  category_block: "category cleanup blocklist (galaxusCategoryBlocklist.json)",
};

/** Plain-text body for Tali / category email. */
export function formatGalaxusAssortmentExceptionsMail(options?: {
  includeInactive?: boolean;
}): string {
  const includeInactive = Boolean(options?.includeInactive);
  const skus = includeInactive
    ? GALAXUS_ASSORTMENT_EXCEPTIONS
    : activeSkuExceptions();
  const policies = includeInactive
    ? GALAXUS_POLICY_EXCEPTIONS
    : activePolicyExceptions();

  const lines: string[] = [
    "Galaxus assortment exceptions (gate bypasses)",
    `Generated: ${new Date().toISOString().slice(0, 10)}`,
    "",
    "=== Policy-level ===",
  ];

  if (policies.length === 0) {
    lines.push("(none)");
  } else {
    for (const p of policies) {
      lines.push(
        `- [${p.active ? "ACTIVE" : "off"}] ${p.title}`,
        `  Gates: ${p.gates.map((g) => GATE_LABEL[g]).join("; ")}`,
        `  Reason: ${p.reason} · added ${p.addedAt}${p.reviewAt ? ` · review ${p.reviewAt}` : ""}`,
        `  Note: ${p.note}`,
        ""
      );
    }
  }

  lines.push("=== Per-SKU ===");
  if (skus.length === 0) {
    lines.push("(none)");
  } else {
    for (const e of skus) {
      lines.push(
        `- [${e.active ? "ACTIVE" : "off"}] ${e.title}`,
        `  Key: ${e.providerKey}${e.gtin ? ` · GTIN ${e.gtin}` : ""} · supplier ${e.supplierKey}`,
        `  Gates: ${e.gates.map((g) => GATE_LABEL[g]).join("; ")}`,
        `  Reason: ${e.reason} · added ${e.addedAt}${e.reviewAt ? ` · review ${e.reviewAt}` : ""}`,
        `  Note: ${e.note}`,
        ""
      );
    }
  }

  lines.push(
    "Source: galaxus/exports/galaxusAssortmentExceptions.ts",
    "Dump: npx tsx scripts/print-galaxus-assortment-exceptions.ts"
  );
  return lines.join("\n");
}
