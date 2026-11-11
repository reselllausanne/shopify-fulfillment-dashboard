# BFCM size email — test report

Run: 11 November 2026, Europe/Zurich.

- ✅ Desktop and 390 px previews render all 34 exact live-sale catalog sizes.
  Every chip has one `size` value followed by BFCM UTM parameters.
- ✅ EU 38 opens production landing, displays saved EU 38, and hides deals.
- ✅ EU 42.5 remains exact and displays saved EU 42.5.
- ✅ `42%202%2F3` decodes and displays as EU 42 2/3, never 42.67.
- ✅ UTM parameters remain present with readable `size`.
- ⚠️ A no-size visit after selecting EU 42 2/3 reused the stored selection and
  redirected to `?size=42+2%2F3`. Fresh-browser fallback chips were not proven.
- ✅ Repeating EU 38 displays the same successful saved-selection state.
- ⚠️ Pre-launch deal hiding passed. No forced-unlock mechanism was supplied, so
  post-launch deal rendering and product-click stock recheck remain untested.
- ✅ Email copy promises no confirmation email and contains no form or script.
- ⚠️ Real Klaviyo test sent to the only known locked internal recipient,
  `reselllausanne@gmail.com`. Two additional internal addresses were not known.

Klaviyo:

- Template: `[BFCM 2026] 02 — Choix pointure landing privée`
- Template ID: `U78AYV`
- Test campaign ID: `01M768WTR8NK8FDX741VSQRJSR`
- Test audience: locked list `W2mNct`, one verified recipient

Artifacts:

- Source and generated links: `bfcm/sizeEmail.ts`
- Mapping: `bfcm/size-email-links.csv`
- Automated checks: `bfcm/sizeEmail.test.ts`
- Safe test sender: `scripts/send-bfcm-size-email-test.ts`
