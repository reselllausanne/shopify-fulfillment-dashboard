/**
 * Warehouse module — shared vocabulary. Mirrors the CHECK constraints of
 * prisma/migrations/20261128040000_warehouse_lot1/migration.sql.
 * Contract: docs/warehouse/CONTRACTS.md
 */

export const LOCATION_KINDS = [
  "SECTOR",
  "ROW",
  "RACK",
  "LEVEL",
  "RECEIVING",
  "CART",
  "PACKING",
  "RETURNS",
  "QUARANTINE",
] as const;
export type LocationKind = (typeof LOCATION_KINDS)[number];
/** Kinds that can physically hold units. */
export const UNIT_HOLDING_KINDS: readonly LocationKind[] = [
  "LEVEL",
  "RECEIVING",
  "CART",
  "PACKING",
  "RETURNS",
  "QUARANTINE",
];

export type LocationStatus = "ACTIVE" | "BLOCKED" | "RETIRED";

export type OwnerKind = "OWN" | "PARTNER" | "UNKNOWN";
export type UnitOrigin =
  | "STOCK_TAKE"
  | "CONSIGNMENT"
  | "OWN_STOCK"
  | "SUPPLIER"
  | "ORDER_TRANSIT"
  | "CUSTOMER_RETURN"
  | "RECOVERED";

/** Where the pair physically is. */
export type UnitPresence = "PRESENT" | "IN_TRANSIT" | "THIRD_PARTY" | "MISSING" | "OUT";
/** Has it passed control. */
export type UnitQcState = "PENDING" | "PASSED" | "QUARANTINE";
/** Is it authorized for sale. */
export type UnitSaleState = "STORAGE_ONLY" | "SALE_AUTHORIZED" | "BLOCKED";
export type UnitCondition = "NEW" | "USED" | "DAMAGED" | "UNKNOWN";
export type BoxCondition = "GOOD" | "DAMAGED" | "MISSING" | "UNKNOWN";
export type UnitOutReason = "SOLD" | "WITHDRAWN" | "RETURNED_TO_SUPPLIER" | "DISPOSED" | "OTHER";

export type BatchKind = "STOCK_TAKE" | "RECEIVING";
export type BatchFlow = "CONSIGNMENT" | "OWN_STOCK" | "SUPPLIER" | "ORDER_TRANSIT" | "CUSTOMER_RETURN";
export type BatchStatus = "OPEN" | "PAUSED" | "CLOSED" | "CANCELLED";

export type PutawayTaskStatus = "PENDING" | "RESERVED" | "DONE" | "CANCELLED";

export type MovementType =
  | "RECEIVE"
  | "STOCK_TAKE"
  | "PUTAWAY"
  | "RELOCATE"
  | "TRANSFER_OUT"
  | "TRANSFER_IN"
  | "MARK_MISSING"
  | "FOUND"
  | "QC"
  | "SALE_STATE"
  | "OWNER_CHANGE"
  | "ITEM_CORRECTION"
  | "CONDITION"
  | "LABEL_PRINT"
  | "LABEL_REPRINT"
  | "LABEL_VERIFIED"
  | "ALLOCATE"
  | "RELEASE"
  | "OUT"
  | "CORRECTION"
  | "RECOVERED";

export type ExceptionType =
  | "UNKNOWN_GTIN"
  | "AMBIGUOUS_GTIN"
  | "UNKNOWN_CODE"
  | "WRONG_CODE_TYPE"
  | "SURPLUS"
  | "MISSING"
  | "WRONG_VARIANT"
  | "OWNER_SUSPECT"
  | "DUPLICATE_SCAN"
  | "DUPLICATE_LABEL"
  | "LABEL_LOST"
  | "LEVEL_FULL"
  | "CAPACITY_MISMATCH"
  | "WRONG_LOCATION"
  | "UNIT_NOT_FOUND"
  | "PRINT_UNCERTAIN"
  | "RECOVERY_RECONCILE"
  | "COUNT_MISMATCH"
  | "OTHER";
export type ExceptionStatus = "OPEN" | "RESOLVED" | "DISMISSED";

export type LabelKind = "PAIR" | "LOCATION" | "PARCEL" | "SHIPPING" | "RETURN";
export type PrintJobKind = "PAIR" | "LOCATION" | "TEST";
export type PrinterAdapter = "QZ_TRAY" | "PDF_MANUAL";
export type PrintJobStatus =
  | "QUEUED"
  | "CLAIMED"
  | "SENT"
  | "CONFIRMED"
  | "FAILED"
  | "UNCERTAIN"
  | "CANCELLED";

export type PriceStatus = "PROPOSED" | "VALIDATED" | "REJECTED" | "SUPERSEDED";
export type PriceSource = "MANUAL" | "STOCKX_BUYNOW_FACTOR";

export type StaffRole = "admin" | "logistics";

/** Who performs a gesture. Staff auth is a shared role; the operator identifies the person. */
export type ActorContext = {
  role: StaffRole | "system";
  operatorId?: string | null;
  stationId?: string | null;
};

export const SYSTEM_ACTOR: ActorContext = { role: "system", operatorId: null, stationId: null };

export type UnitSummary = {
  id: string;
  labelCode: string;
  shortRef: string;
  issuingSiteCode: string;
  itemId: string;
  itemName: string;
  itemBrand: string | null;
  itemStyleCode: string | null;
  itemSizeLabel: string | null;
  itemGtin: string | null;
  itemImageUrl: string | null;
  itemStatus: string;
  ownerKind: OwnerKind;
  ownerPartnerId: string | null;
  ownerName: string | null;
  originType: UnitOrigin;
  originBatchId: string | null;
  presence: UnitPresence;
  currentSiteId: string | null;
  currentSiteCode: string | null;
  currentLocationId: string | null;
  currentLocationCode: string | null;
  currentLocationShortCode: string | null;
  currentLocationKind: LocationKind | null;
  qcState: UnitQcState;
  saleState: UnitSaleState;
  condition: UnitCondition;
  boxCondition: BoxCondition;
  /** Box format used to pick a compatible level (STANDARD, LARGE, …). */
  boxProfile: string;
  outReason: UnitOutReason | null;
  labelPrintCount: number;
  labelVerifiedAt: string | null;
  version: number;
  observedAt: string;
  receivedAt: string;
};

export type LocationSummary = {
  id: string;
  siteId: string;
  siteCode: string;
  code: string;
  shortCode: string;
  kind: LocationKind;
  holdsUnits: boolean;
  sector: string | null;
  rowNo: number | null;
  rackNo: number | null;
  levelNo: number | null;
  walkSequence: number;
  capacity: number | null;
  sizeProfile: string;
  status: LocationStatus;
  statusReason: string | null;
  occupiedCount: number;
  reservedCount: number;
  /** capacity - occupied - reserved, null when unbounded. */
  freeCount: number | null;
};

export type ItemSummary = {
  id: string;
  gtin: string | null;
  brand: string | null;
  name: string;
  styleCode: string | null;
  colorway: string | null;
  sizeSystem: string | null;
  sizeLabel: string | null;
  sizeEu: string | null;
  sizeUs: string | null;
  imageUrl: string | null;
  status: string;
  catalogSource: string;
};

/** Catalog candidate found for a GTIN before the warehouse item exists. */
export type CatalogCandidate = {
  source: "KICKDB" | "SUPPLIER_VARIANT";
  gtin: string;
  brand: string | null;
  name: string;
  styleCode: string | null;
  colorway: string | null;
  sizeSystem: string | null;
  sizeLabel: string | null;
  sizeEu: string | null;
  sizeUs: string | null;
  imageUrl: string | null;
  kickdbVariantId: string | null;
  supplierVariantId: string | null;
};
