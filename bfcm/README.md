# BFCM 2026 foundation

Source: `Resell_Lausanne_BFCM_2026 3`, dated 11 November 2026.

This directory encodes policy only:

- Swiss fixed schedule, including the revised 12 and 15 November sends
- audience precedence and VIP/public deduplication
- SAV/manual exclusion fail-closed behavior
- exact EU size matching and same-variant commercial checks
- automatic live-sale selections for campaigns 03–08
- campaign-isolated Klaviyo card properties
- one-time BF registration acknowledgement rules

`loadAutomaticBfcmCatalog` reads active Shopify products marked
`custom.soldes_48h=true`, then keeps only exact variants with:

- positive physical-location mirror stock (never dropship stock)
- `availableForSale=true`
- `custom.delivery_48h=true`
- a valid price and compare-at showing at least 50% off
- an exact EU size and public image

`selectAutomaticOffers` matches the confirmed profile size, rotates models
already delivered to that profile, then ranks remaining stock. When every
matching model was already shown, it reuses the best variants that are still
live instead of leaving later emails without product cards. Unseen models
always rank first. `selections.json` contains optional pin/exclude overrides
only. No manual allow-list is required. Demo products are never substituted.

Not connected:

- Gmail labels or review
- checkout or VIP access control
- Klaviyo profiles, campaigns, flows, templates, scheduling, or sends
- persistent hold journal or shown-model history

Do not activate an automated send until all critical sources pass
`automatedSendGate`.
