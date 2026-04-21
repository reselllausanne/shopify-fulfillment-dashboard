-- Optional listing attributes when KickDB product is not linked (supplier-enriched path).
ALTER TABLE "public"."SupplierVariant" ADD COLUMN "supplierGender" TEXT;
ALTER TABLE "public"."SupplierVariant" ADD COLUMN "supplierColorway" TEXT;
