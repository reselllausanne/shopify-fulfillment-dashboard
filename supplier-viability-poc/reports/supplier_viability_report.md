# Supplier viability report — Galaxus CH electronics POC

Generated: 2026-08-23T19:33:43+02:00 (Europe/Zurich)

## Scope & constraints

- Read-only POC. No offers published. No production writes.
- Project Galaxus data is overwhelmingly sneakers/apparel — not a Digitec electronics catalog.
- Overlap uses exported SupplierVariant + GalaxusOrderLine GTINs.
- Pricing defaults from `galaxus/exports/pricing.ts`: target net margin **12%**, EURCHF **0.94**.
- Galaxus B2B path in this repo: no Mirakl commission on line net.
- Unknown freight/customs ⇒ not profitable (never default shipping to 0).

## Comparative table

| Fournisseur | Produits testés | GTIN valides | Overlap Galaxus | Produits rentables | CA historique matché | Logistique CH | Automatisation | Verdict |
|---|---:|---:|---:|---:|---:|---|---|---|
| farnell | 0 | 0 | 0 (0.0%) | 0 | CHF 0.0 | import_predictable | Official API (key required); order API via account | NO-GO |
| buerklin | 0 | 0 | 0 (0.0%) | 0 | CHF 0.0 | import_unknown | Blocked automation; unknown API | NO-GO |
| berrybase | 10 | 6 | 0 (0.0%) | 0 | CHF 0.0 | import_unknown | Shopware HTML/JSON-LD scrapeable; no public order API found | NO-GO |
| pollin | 8 | 8 | 0 (0.0%) | 0 | CHF 0.0 | import_predictable | Sitemap + JSON-LD; CH freight public; no public order API found | TEST ORDER REQUIRED |

## Scores (/100)

- **farnell**: 22/100 — NO-GO
- **buerklin**: 5/100 — NO-GO
- **berrybase**: 26/100 — NO-GO
- **pollin**: 44/100 — TEST ORDER REQUIRED

## Per-supplier notes

### farnell

- element14 Product Search API requires partner API key; no key in env.
- CH site; freight unconfirmed without account/API
- Official API (key required); order API via account
- GTIN valid 0/0 (0.0%)
- Exact Galaxus overlaps: 0; viable_now: 0

### buerklin

- Cloudflare challenge (403) — stopped, no CAPTCHA bypass.
- Cloudflare blocked; logistics unknown
- Blocked automation; unknown API
- GTIN valid 0/0 (0.0%)
- Exact Galaxus overlaps: 0; viable_now: 0

### berrybase

- Partial sample 10/300: Cursor host allowlist capped bulk fetch; pipeline supports 300.
- DE EUR; CH shipping unconfirmed
- Shopware HTML/JSON-LD scrapeable; no public order API found
- GTIN valid 6/10 (60.0%)
- Exact Galaxus overlaps: 0; viable_now: 0

### pollin

- Partial sample 8/300: same bulk-fetch constraint.
- CH freight 19.90 EUR public; customs unknown (not DDP)
- Sitemap + JSON-LD; CH freight public; no public order API found
- GTIN valid 8/8 (100.0%)
- Exact Galaxus overlaps: 0; viable_now: 0

## Q1–Q12

**Q1 Most exploitable GTINs?** pollin (highest valid-GTIN rate among sampled).

**Q2 Biggest Galaxus overlap?** None — 0 exact matches for all 4. Project Galaxus GTIN index is footwear/apparel, not Digitec electronics.

**Q3 Most historically sold matches?** None — CHF 0 matched historical revenue (no GTIN hits in GalaxusOrderLine).

**Q4 Most products with sufficient margin?** None — 0 VIABLE_NOW (need sell prices + confirmed CH landed costs).

**Q5 Median margin per supplier?** Not computable — Galaxus sell prices and/or customs missing ⇒ SHIPPING_UNCONFIRMED / NO_GALAXUS_PRICE.

**Q6 Best CH logistics?** Pollin (public CH freight 19.90 EUR). Still not DDP. Farnell CH storefront but freight unconfirmed. BerryBase/Bürklin unconfirmed/blocked.

**Q7 Pollin import predictability?** Freight predictable (flat CH). Import VAT/duties via Swiss TARES — not DDP; clearance fees unknown ⇒ CUSTOMS_UNCONFIRMED.

**Q8 Integrate first?** Pollin (highest score) only after electronics sell catalog + DDP/customs quantified; else none VIABLE_NOW. Alternate: Farnell via official API if partner key obtained.

**Q9 Prioritize which categories?** Maker/SBC accessories (Raspberry Pi ecosystem, sensors, PSU, cables) once electronics catalog association exists.

**Q10 How many VIABLE_NOW publishable?** 0

**Q11 Historical CA covered by matches?** CHF 0.0 across exact GTIN hits in project sales history.

**Q12 Next concrete action?** 1) Import Digitec/Galaxus electronics GTIN sell catalog. 2) Register Farnell element14 API key. 3) Place 1 Pollin CH test order for real landed cost. 4) Re-run POC with 300/supplier outside sandbox.

## Ranking

1. pollin (44/100) — TEST ORDER REQUIRED
2. berrybase (26/100) — NO-GO
3. farnell (22/100) — NO-GO
4. buerklin (5/100) — NO-GO

## Next concrete action

1) Import Digitec/Galaxus electronics GTIN sell catalog. 2) Register Farnell element14 API key. 3) Place 1 Pollin CH test order for real landed cost. 4) Re-run POC with 300/supplier outside sandbox.
