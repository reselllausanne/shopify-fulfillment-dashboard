# BFCM 2026 foundation

Source: `Resell_Lausanne_BFCM_2026 3`, dated 11 November 2026.

This directory encodes policy only:

- Swiss fixed schedule, including the revised 12 and 15 November sends
- audience precedence and VIP/public deduplication
- SAV/manual exclusion fail-closed behavior
- exact EU size matching and same-variant commercial checks
- owner-approved editorial selections for campaigns 03–08
- campaign-isolated Klaviyo card properties
- one-time BF registration acknowledgement rules

`selections.json` intentionally contains no approved products. Empty or
unapproved selections render no cards; demo products are never substituted.

Not connected:

- Gmail labels or review
- Shopify products, local stock, prices, checkout, or access control
- Klaviyo profiles, campaigns, flows, templates, scheduling, or sends
- persistent hold journal or shown-model history

Do not activate an automated send until all critical sources pass
`automatedSendGate`.
