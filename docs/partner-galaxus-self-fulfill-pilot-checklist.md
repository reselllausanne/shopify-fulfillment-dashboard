# Partner Galaxus Self-Fulfill Pilot Checklist (NER)

## Feature gate
- `PARTNER_SELF_FULFILL_ENABLED=1`
- `PARTNER_SELF_FULFILL_ALLOWLIST=NER`

## Validation matrix
- Warehouse: single-order composite shipment, SSCC label, delivery note, Swiss Post label + DELR.
- Warehouse: multi-order (same address) composite shipment, DELR upload, verify no mixed-provider payload.
- Warehouse: wrong GTIN scan (line not selected), manual selection fallback.
- Direct delivery: one-click Swiss Post + DELR on partner-scoped direct order.
- Negative: partner tries out-of-scope line/shipment/document/order -> expect `403`/`404`.
- Idempotency: rerun DELR on sent shipment -> expect skipped/conflict response.

## Automated checks run in this implementation
- `npm run -s build` passes (Next.js + TypeScript).
- Partner routes compiled and registered:
  - `/api/partners/galaxus/shipments/*`
  - `/api/partners/galaxus/orders/[orderId]/direct-swiss-post-label`
  - `/api/partners/galaxus/documents/[documentId]`
- New partner pages compiled:
  - `/partners/galaxus-shipments`
  - `/partners/galaxus-direct-delivery`
