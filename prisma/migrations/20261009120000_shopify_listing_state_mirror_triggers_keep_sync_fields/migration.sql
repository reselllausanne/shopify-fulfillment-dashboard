-- Shopify listing-state triggers: the location-stock mirror owns stock/status only.
-- Previously both functions also reset lastSyncedAt, cleared lastError and overwrote
-- metadataJson on every mirror change, so price workers (which skip rows by
-- lastSyncedAt) treated never-repriced variants as fresh. Idempotent.

CREATE OR REPLACE FUNCTION public.enforce_shopify_listing_state_from_mirror()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_max_available integer;
BEGIN
  IF NEW."channel" <> 'SHOPIFY' OR NEW."externalVariantId" IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(MAX(COALESCE(s."available", 0)), 0)::integer
  INTO v_max_available
  FROM public."ShopifyVariantLocationStock" s
  WHERE s."shopifyVariantId" = NEW."externalVariantId";

  -- Mirror owns stock/status only. lastSyncedAt / lastError / metadataJson belong
  -- to the writer (price workers skip on lastSyncedAt).
  NEW."lastPushedStock" := v_max_available;
  NEW."status" := CASE WHEN v_max_available > 0 THEN 'ACTIVE' ELSE 'SOLD_OUT' END;
  NEW."soldOutAt" := CASE
    WHEN v_max_available > 0 THEN NULL
    ELSE COALESCE(NEW."soldOutAt", NOW())
  END;
  NEW."updatedAt" := NOW();

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.propagate_shopify_mirror_to_listing_state()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_variant_id text;
  v_max_available integer;
BEGIN
  v_variant_id := COALESCE(NEW."shopifyVariantId", OLD."shopifyVariantId");
  IF v_variant_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT COALESCE(MAX(COALESCE(s."available", 0)), 0)::integer
  INTO v_max_available
  FROM public."ShopifyVariantLocationStock" s
  WHERE s."shopifyVariantId" = v_variant_id;

  UPDATE public."ChannelListingState" cls
  SET
    "lastPushedStock" = v_max_available,
    "status" = CASE WHEN v_max_available > 0 THEN 'ACTIVE' ELSE 'SOLD_OUT' END,
    "soldOutAt" = CASE
      WHEN v_max_available > 0 THEN NULL
      ELSE COALESCE(cls."soldOutAt", NOW())
    END,
    "updatedAt" = NOW()
  WHERE cls."channel" = 'SHOPIFY'
    AND cls."externalVariantId" = v_variant_id
    AND (
      cls."lastPushedStock" IS DISTINCT FROM v_max_available
      OR cls."status" IS DISTINCT FROM CASE WHEN v_max_available > 0 THEN 'ACTIVE' ELSE 'SOLD_OUT' END
    );

  RETURN COALESCE(NEW, OLD);
END;
$function$;

DROP TRIGGER IF EXISTS trg_enforce_shopify_listing_state_from_mirror ON public."ChannelListingState";
CREATE TRIGGER trg_enforce_shopify_listing_state_from_mirror
  BEFORE INSERT OR UPDATE ON public."ChannelListingState"
  FOR EACH ROW EXECUTE FUNCTION public.enforce_shopify_listing_state_from_mirror();

DROP TRIGGER IF EXISTS trg_propagate_shopify_mirror_to_listing_state ON public."ShopifyVariantLocationStock";
CREATE TRIGGER trg_propagate_shopify_mirror_to_listing_state
  AFTER INSERT OR DELETE OR UPDATE ON public."ShopifyVariantLocationStock"
  FOR EACH ROW EXECUTE FUNCTION public.propagate_shopify_mirror_to_listing_state();
