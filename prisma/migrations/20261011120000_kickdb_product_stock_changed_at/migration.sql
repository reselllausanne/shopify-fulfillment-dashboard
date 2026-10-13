-- Skinny (priceOnly) SSE ticks keep rawFetchedAt, so /api/kickdb/fresh never queued them
-- for the Shopify consumer: sizes sold out on StockX stayed buyable on the website.
-- stockChangedAt marks ticks that changed which STX sizes are buyable. Additive, idempotent.

ALTER TABLE "public"."KickDBProduct" ADD COLUMN IF NOT EXISTS "stockChangedAt" TIMESTAMP(3);
