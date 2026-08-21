-- Add covering indexes for foreign keys flagged by Supabase advisor.
-- Safe: index-only DDL, no table data mutation.

CREATE INDEX IF NOT EXISTS "BankReconciliationLink_bankTransactionId_idx"
  ON public."BankReconciliationLink" ("bankTransactionId");

CREATE INDEX IF NOT EXISTS "BankTransaction_statementImportId_idx"
  ON public."BankTransaction" ("statementImportId");

CREATE INDEX IF NOT EXISTS "ExpectedCashEvent_actualizedByBankTransactionId_idx"
  ON public."ExpectedCashEvent" ("actualizedByBankTransactionId");

CREATE INDEX IF NOT EXISTS "ExpectedCashEvent_manualFinanceEventId_idx"
  ON public."ExpectedCashEvent" ("manualFinanceEventId");

CREATE INDEX IF NOT EXISTS "GalaxusEdiFile_orderId_idx"
  ON public."GalaxusEdiFile" ("orderId");

CREATE INDEX IF NOT EXISTS "ManualFinanceEvent_bankAccountId_idx"
  ON public."ManualFinanceEvent" ("bankAccountId");

CREATE INDEX IF NOT EXISTS "ManualFinanceEvent_expenseCategoryId_idx"
  ON public."ManualFinanceEvent" ("expenseCategoryId");

CREATE INDEX IF NOT EXISTS "OperatingEvent_manualFinanceEventId_idx"
  ON public."OperatingEvent" ("manualFinanceEventId");

CREATE INDEX IF NOT EXISTS "OrderLineSyncState_eventId_idx"
  ON public."OrderLineSyncState" ("eventId");

CREATE INDEX IF NOT EXISTS "PartnerOrderLine_partnerVariantId_idx"
  ON public."PartnerOrderLine" ("partnerVariantId");

CREATE INDEX IF NOT EXISTS "RecurringExpense_accountId_idx"
  ON public."RecurringExpense" ("accountId");

CREATE INDEX IF NOT EXISTS "RecurringExpense_categoryId_idx"
  ON public."RecurringExpense" ("categoryId");

CREATE INDEX IF NOT EXISTS "health_integration_sync_runs_account_id_idx"
  ON public.health_integration_sync_runs (account_id);

CREATE INDEX IF NOT EXISTS "products_last_run_id_idx"
  ON scraper.products (last_run_id);

CREATE INDEX IF NOT EXISTS "scrape_runs_shop_id_idx"
  ON scraper.scrape_runs (shop_id);

CREATE INDEX IF NOT EXISTS "variants_last_run_id_idx"
  ON scraper.variants (last_run_id);

CREATE INDEX IF NOT EXISTS "variants_shop_id_product_id_idx"
  ON scraper.variants (shop_id, product_id);
