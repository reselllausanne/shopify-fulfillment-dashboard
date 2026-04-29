export type InventoryChannel = "SHOPIFY" | "GALAXUS" | "DECATHLON";
export type InventoryEventKind = "SALE" | "RETURN" | "ADJUSTMENT" | "RESERVATION" | "RELEASE";

export type InventoryLineRef = {
  supplierVariantId?: string | null;
  providerKey?: string | null;
  gtin?: string | null;
  sku?: string | null;
};

export type ApplyInventoryOrderLineInput = InventoryLineRef & {
  channel: InventoryChannel;
  externalOrderId?: string | null;
  externalLineId: string;
  quantity: number;
  occurredAt?: Date;
  eventType?: InventoryEventKind;
  payloadJson?: unknown;
};

export type ApplyInventoryOrderLineResult =
  | {
      applied: true;
      channel: InventoryChannel;
      externalLineId: string;
      supplierVariantId: string;
      providerKey: string | null;
      quantityDelta: number;
      eventId: string;
      reason?: undefined;
    }
  | {
      applied: false;
      channel: InventoryChannel;
      externalLineId: string;
      supplierVariantId?: string;
      providerKey?: string | null;
      quantityDelta?: number;
      eventId?: string;
      reason: "unresolved_variant" | "already_processed" | "invalid_line";
    };
