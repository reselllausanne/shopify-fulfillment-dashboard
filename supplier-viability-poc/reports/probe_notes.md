# Probe notes (2026-08-23 evening)

## Decisions from user
- Pollin VAT/customs: ignore for now
- Farnell: no API key path — want HTML scrape; blocked 403 even in browser from this env
- Bürklin: want scrape via proxies; curl=Cloudflare, real browser session works
- BerryBase: sample test — done

## BerryBase (40 products, curl OK)
- GTIN valid ~48% (19/40)
- Price 100%, stock/avail 100%, MPN 100%, parse errors 0
- Worth continuing scrape automation (Shopware HTML/JSON-LD)
- CSV: `data/berrybase_sample.csv`

## Bürklin (8 products via browser session fetch)
- curl: Cloudflare 403
- Browser (Cookie/JS): JSON-LD + EAN OK
- GTIN valid 8/8; price on RPi SKUs (net EUR); Würth boards often price missing in LD
- Automation path: Playwright/browser OR residential proxies (`SCRAPER_REI_PROXY_*` / `.data/reichelt-proxies.txt` not present locally)
- CSV: `data/buerklin_sample.csv`

## Farnell
- ch.farnell.com / uk.farnell.com: Access Denied 403 (curl + Cursor browser)
- Needs residential proxy / different IP / manual browser outside this env
- No local proxy file found

## Ex Libris Spiele (2026-08-25) — VIABLE
- Root: `/de/hobby-spiele-brettspiele/` ≈ **94 321** SKUs
- Data in `__NEXT_DATA__` (tiles + PDP ProductStore): EAN, CHF gross, avail text/icon, brand/Producer
- URL pattern: `…/id/{EAN}/` — EAN = product id
- Stock: **unquantified** (`Sofort versandbereit` / lead-time text / `vergriffen`) — never a qty
- CH shop, free delivery remarks on many PDPs
- robots: `Disallow: /fr/` — scrape **DE** paths
- Sample 50 / 10 cats: `data/exlibris_sample.csv` + `.tsv`
- Margin like REI: `sell = (buy_chf + shipping) × (1 + 30%)` — env `SCRAPER_EXL_MARGIN_PERCENT` (fallback `SCRAPER_REI_MARGIN_PERCENT`)
- **Physical only**: skip E-Book/epub/download (`IsDownloadProduct`, `/e-books-*` paths). One EAN per URL — never expand PDP `Relationships` siblings.
- Code: `lib/parse_exlibris.py`, `lib/exlibris_pricing.py`, `scripts/scrape_exlibris.py`

## FantasyWelt.de (2026-09-01) — ACCESS HARD / DATA GOOD
- Stack: **JTL-Shop** (NOVA / `JTLSHOP` cookie), ~70k hobby/games SKUs
- curl: Cloudflare managed challenge **403**
- Browser session + `fetch(..., credentials:include)`: OK after CF
- Fields: price gross EUR, `itemprop=gtin13` / sku / brand / availability (InStock|PreOrder), Lieferzeit 1–2 Werktage
- Sample **18**: GTIN valid **17/18** (only RPG Encyclopedia missing EAN), price 18/18
- CSV: `data/fantasywelt_sample.csv`
- Parser: `lib/parse_fantasywelt.py` + fixture test
- Automation: same path as Bürklin (Playwright / residential proxies); no Store-API

## Next for bulk
1. Drop LemonProxy list into `.data/reichelt-proxies.txt` or set `SCRAPER_REI_PROXY_URLS`
2. Wire POC Session curl `--proxy` round-robin
3. Re-run Farnell+Bürklin samples
4. Ex Libris: paginate all `ci/*` cats or ePoq `query=bs>*` if gateway opens
5. FantasyWelt: Playwright/session scrape if Galaxus games overlap worth it
