# BFCM size email — test report

Run: 11 November 2026, Europe/Zurich. Updated after live range landing.

- ✅ Email keeps the same copy and layout, with five range buttons.
- ✅ Production `?size=36-37.5` shows “36–37.5” and hides deals. Visible cards: 0.
- ✅ QA `?bfcm_preview_deals=1` shows 59 cards for 36, 36 2/3, 36.5, 37, 37.5.
- ✅ Production `?size=38` stays exact: label “38”, active sizes “38”, deals hidden.
- ✅ Email links do not include `bfcm_preview_deals`.
- ⚠️ `data-confirm-endpoint` is empty, so the coded POST `{ size, size_range, sizes, label }` does not leave the browser yet.

Klaviyo template: `U78AYV`.
Range test campaign: `01M76CE47CZ870K7VXSG5ZFYM3`, sent only to `reselllausanne@gmail.com`.
Each link now carries `email={{ person.email|urlencode }}` after `size`.

Mapping: `bfcm/size-email-links.csv`.
