#!/usr/bin/env python3
"""galaxus-buy: search Galaxus.ch, add to cart, STOP AT CHECKOUT (never pays by default).

Usage:
  galaxus_buy.py search "tapis de course zipro" [--limit 8] [--json]
  galaxus_buy.py buy --url <product url> [--dry-run] [--confirm-pay]
  galaxus_buy.py buy "zipro catwalk" --pick 1 [--dry-run]
  galaxus_buy.py cart-list [--json]
  galaxus_buy.py cart-remove --url URL [--dry-run]
  galaxus_buy.py cart-clear --keep URL [--keep URL ...] [--dry-run]

Cart commands are explicit only (search/buy never remove anything). They print the cart before and after,
verify the result, and never open checkout or pay. cart-clear needs >=1 --keep and refuses if no --keep
URL is in the cart (typo guard). Items are matched on the numeric product id at the end of the URL.

Default `buy`: add to cart, compute delivered total, print summary + checkout link, STOP before payment.
--dry-run : read-only HTTP at most. No cart mutation, no browser, no payment. Logged as status=dry_run.
--confirm-pay : pay ONLY if total < auto_buy_max_chf AND today's paid + total <= daily_max_chf, both read
  from ~/.config/jarvis-resell/achat.json (read-only for this tool, never committed). Missing/invalid
  file, missing key, unknown total => refuse (fail closed). Payment method = the logged-in browser
  profile (GALAXUS_PROFILE_DIR). No card data handled here.

Exit codes: 0 ok | 1 error | 2 usage | 3 anti-bot (captcha/403, no retry) | 4 payment refused by policy.

Env: JARVIS_ACHAT_CONFIG (limits file), GALAXUS_BUY_LOG (JSONL log path), GALAXUS_PROFILE_DIR (browser
profile for cart/checkout), GALAXUS_MIN_DELAY (seconds between requests, default 3).
Log default: ~/.local/share/jarvis-resell/achats.jsonl (outside repo).
"""
import argparse, datetime, html as htmllib, json, os, re, sys, time, urllib.error, urllib.parse, urllib.request

BASE = "https://www.galaxus.ch"
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
EXIT_OK, EXIT_ERR, EXIT_USAGE, EXIT_ANTIBOT, EXIT_PAY_REFUSED = 0, 1, 2, 3, 4
MAX_RETRIES = 2  # network errors / 5xx only, never on 403/captcha
DEFAULT_CONFIG = "~/.config/jarvis-resell/achat.json"
DEFAULT_LOG = "~/.local/share/jarvis-resell/achats.jsonl"


class AntiBotError(Exception):
    pass


class FetchError(Exception):
    pass


# ---------- config / limits ----------
def load_limits(path=None):
    """Return {'auto_buy_max_chf': float, 'daily_max_chf': float} or None if missing/invalid."""
    p = os.path.expanduser(path or os.environ.get("JARVIS_ACHAT_CONFIG") or DEFAULT_CONFIG)
    try:
        with open(p) as f:
            d = json.load(f)
        out = {k: float(d[k]) for k in ("auto_buy_max_chf", "daily_max_chf")}
        if any(v < 0 for v in out.values()):
            return None
        return out
    except (OSError, ValueError, KeyError, TypeError):
        return None


def decide_pay(total, limits, spent_today, confirm):
    """(allowed, reason). Fail closed. Strict: total < auto_buy_max_chf; spent+total <= daily_max_chf."""
    if not confirm:
        return False, "stopped_before_payment (no --confirm-pay)"
    if limits is None:
        return False, "achat.json missing/invalid: refusing to pay"
    if total is None:
        return False, "total unknown: refusing to pay"
    if not total < limits["auto_buy_max_chf"]:
        return False, f"total {total:.2f} >= auto_buy_max_chf {limits['auto_buy_max_chf']:.2f}"
    if spent_today + total > limits["daily_max_chf"]:
        return False, f"daily cap: {spent_today:.2f}+{total:.2f} > daily_max_chf {limits['daily_max_chf']:.2f}"
    return True, "within limits"


# ---------- JSONL log ----------
def log_path(override=None):
    return os.path.expanduser(override or os.environ.get("GALAXUS_BUY_LOG") or DEFAULT_LOG)


def log_attempt(path, **rec):
    rec = {"ts": datetime.datetime.now().astimezone().isoformat(timespec="seconds"), "site": "galaxus.ch", **rec}
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with open(path, "a") as f:
        f.write(json.dumps(rec, ensure_ascii=False) + "\n")
    return rec


def spent_today(path, today=None):
    today = today or datetime.date.today().isoformat()
    tot = 0.0
    try:
        with open(path) as f:
            for line in f:
                try:
                    r = json.loads(line)
                except ValueError:
                    continue
                if r.get("status") == "paid" and str(r.get("ts", ""))[:10] == today:
                    tot += float(r.get("total_chf") or r.get("price_chf") or 0)
    except OSError:
        pass
    return tot


# ---------- parsing ----------
def to_float(v):
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return float(v)
    m = re.search(r"\d[\d'’ .,]*", str(v))
    if not m:
        return None
    s = re.sub(r"[ '’]", "", m.group(0)).rstrip(".,")
    if "," in s and "." in s:
        s = s.replace(",", "")
    elif "," in s:
        s = s.replace(",", ".")
    try:
        return float(s)
    except ValueError:
        return None


def detect_antibot(status, body):
    low = (body or "")[:20000].lower()
    if status in (403, 429) or "access denied" in low or "captcha" in low or "datadome" in low or "px-captcha" in low:
        raise AntiBotError(f"anti-bot block (HTTP {status}): captcha/403 detected, stopping (no retry)")


def _jsonld_blocks(html):
    for m in re.finditer(r'<script[^>]*type="application/ld\+json"[^>]*>(.*?)</script>', html, re.S | re.I):
        try:
            yield json.loads(htmllib.unescape(m.group(1)))
        except ValueError:
            continue


def _walk(o):
    if isinstance(o, dict):
        yield o
        for v in o.values():
            yield from _walk(v)
    elif isinstance(o, list):
        for v in o:
            yield from _walk(v)


def _offer(prod):
    off = prod.get("offers")
    if isinstance(off, list):
        off = off[0] if off else {}
    return off if isinstance(off, dict) else {}


def _product_dict(p):
    off = _offer(p)
    rating = p.get("aggregateRating") or {}
    url = p.get("url") or off.get("url") or ""
    return {
        "name": p.get("name"),
        "price_chf": to_float(off.get("price") if off else p.get("price")),
        "rating": to_float(rating.get("ratingValue")),
        "reviews": int(to_float(rating.get("reviewCount") or rating.get("ratingCount")) or 0),
        "url": urllib.parse.urljoin(BASE, url) if url else None,
        "delivery": None,
    }


def parse_products(html):
    """Extract products from JSON-LD (Product / ItemList). Fragile: Galaxus markup can change."""
    out, seen = [], set()
    for block in _jsonld_blocks(html):
        for o in _walk(block):
            t = o.get("@type")
            if t == "ItemList":
                continue
            if t == "Product" or (isinstance(t, list) and "Product" in t):
                d = _product_dict(o)
            elif t == "ListItem" and isinstance(o.get("item"), dict) and o["item"].get("name"):
                d = _product_dict(o["item"])
            else:
                continue
            key = d["url"] or d["name"]
            if d["name"] and key not in seen:
                seen.add(key)
                out.append(d)
    return out


def product_id(url):
    """Numeric Galaxus product id: trailing digits of the slug (/fr/s12/product/<slug>-35585504[?x])."""
    m = re.search(r"-(\d{5,})(?:$|[/?#])", url or "")
    return m.group(1) if m else None


def parse_search_graphql(payload):
    """Galaxus search is client-rendered; the page calls POST /graphql/o/<hash>/useSearchDataQuery and renders
    data.shopSearch.products.edges[].node (verified live 2026-11-28). Returns the same dicts as parse_products."""
    try:
        edges = payload["data"]["shopSearch"]["products"]["edges"] or []
    except (KeyError, TypeError):
        return []
    out = []
    for e in edges:
        n = (e or {}).get("node") or {}
        name, rel = n.get("name"), n.get("relativeUrl")
        if not name or not rel:
            continue
        brand = ((n.get("brand") or {}).get("name") or "").strip()
        if brand and (n.get("brand") or {}).get("showNameInProductName", True) and not name.lower().startswith(brand.lower()):
            name = f"{brand} {name}"
        price = n.get("price") or {}
        rating = n.get("ratingSummary") or {}
        out.append({
            "name": name,
            "properties": (((n.get("nameExtensions") or {}).get("properties") or "").replace("\xa0", " ").strip() or None),
            "price_chf": to_float(price.get("amountInclusive")),
            "rating": to_float(rating.get("averageRating")) or None,
            "reviews": int(to_float(rating.get("ratingCount")) or 0),
            "url": urllib.parse.urljoin(BASE, rel),
            "delivery": None,
            "availability": (n.get("availability") or {}).get("availabilityClassification"),
            "can_add_to_cart": n.get("canAddToCart"),
        })
    return out


def parse_listing(html):
    """DOM fallback for the rendered search page (used only if the GraphQL response was not captured).
    Each card has several anchors /fr/s<N>/product/<slug>-<id>; the first carries aria-label='<brand> <name> (<props>)',
    the card text between it and the next card holds 'CHF <price>'. Verified on live markup 2026-11-28."""
    first = {}
    for m in re.finditer(r'<a\b[^>]*href="(/[a-z]{2}/s\d+/product/([a-z0-9-]+?)-(\d{5,}))[^"]*"[^>]*>', html):
        first.setdefault(m.group(3), (m.start(), m.group(1), m.group(2), m.group(0)))
    items = sorted(first.values())
    out = []
    for i, (start, path, slug, tag) in enumerate(items):
        end = items[i + 1][0] if i + 1 < len(items) else start + 6000
        t = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", htmllib.unescape(html[start:end])))
        pm = re.search(r"CHF\s*([\d'’.,]+)", t)
        am = re.search(r'aria-label="([^"]+)"', tag)
        name = htmllib.unescape(am.group(1)).replace("\xa0", " ").strip() if am else None
        if not name and pm:
            nm = re.match(r"\S*\s*(.+?)\s+(\d{1,6})(?:\s|$)", t[pm.end():])
            name = nm.group(1).strip() if nm else None
        out.append({"name": name or slug.replace("-", " "), "price_chf": to_float(pm.group(1)) if pm else None,
                    "rating": None, "reviews": 0, "url": urllib.parse.urljoin(BASE, path), "delivery": None})
    return out


def parse_delivery(html):
    text = re.sub(r"<[^>]+>", " ", htmllib.unescape(html))
    text = re.sub(r"\s+", " ", text)
    ship = None
    m = re.search(r"(livraison|versand|shipping|spedizione)[^.]{0,60}?(?:CHF|Fr\.)\s*([\d.,']+)", text, re.I)
    if m:
        ship = to_float(m.group(2))
    elif re.search(r"(livraison|versand|shipping|spedizione)\s+(gratuite|gratis|kostenlos|free|gratuita)", text, re.I):
        ship = 0.0
    d0 = re.search(r"(Livré entre [^|<]{3,40}?(?:\d{2}/\d{2})\s*(?:et|und|e)\s*\w{2,4},?\s*\d{2}/\d{2})", text, re.I)
    if d0:
        return ship, d0.group(1).strip()
    d = re.search(r"((?:livraison|lieferung|delivery|consegna)[^.]{0,80}?\d+\s*(?:-|à|bis|to|a)?\s*\d*\s*(?:jours?|tage?|days?|giorni)[^.]{0,30})", text, re.I)
    return ship, (d.group(1).strip() if d else None)


def compute_total(price, shipping):
    if price is None or shipping is None:
        return None
    return round(price + shipping, 2)


def _text(fragment):
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", htmllib.unescape(fragment))).replace("\xa0", " ").strip()


def parse_cart(html):
    """Parse the /fr/cart page (server-rendered, verified live 2026-11-28). Only the active list
    <ul aria-label="Produits dans le panier"> counts ('Mettre de côté' items and recommendations are ignored).
    Returns {'items': [{'id','name','url','qty','price_chf','delivery'}], 'shipping_chf', 'total_chf'}."""
    m = re.search(r'<ul[^>]*aria-label="Produits dans le panier"[^>]*>(.*?)</ul>', html, re.S)
    region = m.group(1) if m else ""
    items = []
    for li in re.findall(r'<li\b[^>]*class="[^"]*cart-item[^"]*"[^>]*>(.*?)</li>', region, re.S):
        href = re.search(r'href="(/[a-z]{2}/s\d+/product/[^"?]+)', li)
        if not href:
            continue
        url = urllib.parse.urljoin(BASE, href.group(1))
        nm = re.search(r"<strong>(.*?)</strong>\s*<span[^>]*>(.*?)</span>", li, re.S)
        name = f"{_text(nm.group(1))} {_text(nm.group(2))}" if nm else (_text(re.search(r'alt="([^"]*)"', li).group(1)) if re.search(r'alt="([^"]*)"', li) else None)
        txt = _text(li)
        pq = re.search(r"\s(\d{1,3})\s+CHF\s*([\d'’.,]+)", txt)
        dl = re.search(r"(Livré (?:le|entre) [^|]{3,40}?\d+/\d+(?:\s*(?:et|und|e)\s*\w{2,4},?\s*\d+/\d+)?)", txt)
        items.append({"id": product_id(url), "name": name, "url": url, "qty": int(pq.group(1)) if pq else None,
                      "price_chf": to_float(pq.group(2)) if pq else None, "delivery": dl.group(1).strip() if dl else None})
    text = _text(html[html.find("</ul>", html.find('aria-label="Produits dans le panier"')):]) if m else ""
    tot = re.search(r"\bTotal\s+CHF\s*([\d'’.,]+)", text)
    sh = re.search(r"Envoi[^T]*?CHF\s*([\d'’.,]+)\s*(?:Compl|Total)", text)
    free = re.search(r"Envoi\s+gratuit\b", text) or re.search(r"Envoi\s*(?:\([^)]*\))?\s*gratuit", text)
    return {"list_found": bool(m), "items": items, "shipping_chf": to_float(sh.group(1)) if sh else (0.0 if free else None),
            "total_chf": to_float(tot.group(1)) if tot else None}


# ---------- HTTP (throttled, bounded) ----------
_last_req = [0.0]


def http_get(url, min_delay=None, opener=urllib.request.urlopen, sleep=time.sleep):
    delay = float(os.environ.get("GALAXUS_MIN_DELAY", "3")) if min_delay is None else min_delay
    for attempt in range(MAX_RETRIES + 1):
        wait = delay - (time.time() - _last_req[0])
        if wait > 0:
            sleep(wait)
        _last_req[0] = time.time()
        req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "fr-CH,fr;q=0.9"})
        try:
            with opener(req, timeout=20) as r:
                body = r.read().decode("utf-8", "replace")
                detect_antibot(r.status, body)
                return body
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", "replace") if hasattr(e, "read") else ""
            detect_antibot(e.code, body)
            if e.code < 500 or attempt == MAX_RETRIES:
                raise FetchError(f"HTTP {e.code} for {url}")
        except (urllib.error.URLError, TimeoutError) as e:
            if attempt == MAX_RETRIES:
                raise FetchError(f"network error for {url}: {e}")
        sleep(2 ** (attempt + 1))
    raise FetchError(f"failed: {url}")


def fetch_rendered(url, min_delay=None):
    """Real-browser fetch (Camoufox via jarvis_browser.py). urllib gets HTTP 403 from Galaxus; Camoufox on a
    residential IP gets 200 (verified 2026-11-25). Patchright is blocked (ERR_HTTP2_PROTOCOL_ERROR): don't use it.
    Env: JARVIS_BROWSER_DIR (default ~/Projects/jarvis-browser)."""
    import subprocess, tempfile
    d = os.path.expanduser(os.environ.get("JARVIS_BROWSER_DIR", "~/Projects/jarvis-browser"))
    if not os.path.exists(f"{d}/jarvis_browser.py"):
        b = BrowserBackend()
        try:
            return b.render(url)
        finally:
            b.close()
    out = tempfile.mktemp(suffix=".html")
    delay = float(os.environ.get("GALAXUS_MIN_DELAY", "3")) if min_delay is None else min_delay
    wait = delay - (time.time() - _last_req[0])
    if wait > 0:
        time.sleep(wait)
    _last_req[0] = time.time()
    r = subprocess.run([f"{d}/.venv/bin/python", f"{d}/jarvis_browser.py", "read", url, "--engine", "camoufox",
                        "--html", out, "--wait-selector", 'a[href*="/product/"]'],
                       capture_output=True, text=True, timeout=180)
    try:
        meta = json.loads((r.stdout.strip().splitlines() or ["{}"])[-1])
    except ValueError:
        raise FetchError(f"browser output unreadable: {r.stderr[-200:]}")
    if meta.get("error"):
        raise FetchError(f"browser error: {meta['error'][:200]}")
    html = open(out).read() if os.path.exists(out) else ""
    detect_antibot(meta.get("status") or 200, (meta.get("title") or "") + " " + meta.get("text", "")[:1500] if meta.get("blocked") else html[:1500])
    return html


def search_url(query):
    return f"{BASE}/fr/search?q={urllib.parse.quote(query)}"


# ---------- cart/checkout backend (browser, logged-in profile) ----------
class BrowserBackend:
    """Camoufox persistent profile (GALAXUS_PROFILE_DIR, default ~/Projects/jarvis-browser/profiles/galaxus).
    Camoufox because Galaxus blocks Patchright/urllib (verified 2026-11-25). Lazy import: unit tests don't need it.
    Set JARVIS_BROWSER_DIR to the jarvis-browser checkout (its venv has camoufox)."""

    def __init__(self):
        d = os.path.expanduser(os.environ.get("JARVIS_BROWSER_DIR", "~/Projects/jarvis-browser"))
        prof = os.path.expanduser(os.environ.get("GALAXUS_PROFILE_DIR", f"{d}/profiles/galaxus"))
        os.makedirs(prof, exist_ok=True)
        try:
            sys.path.insert(0, glob_site(d))
            from camoufox.sync_api import Camoufox
        except Exception as e:
            raise FetchError(f"camoufox unavailable (run with {d}/.venv/bin/python): {e}")
        self._cm = Camoufox(headless=os.environ.get("GALAXUS_HEADED") != "1", persistent_context=True, user_data_dir=prof, locale="fr-CH")
        self._ctx = self._cm.__enter__()
        self.page = self._ctx.pages[0] if self._ctx.pages else self._ctx.new_page()

    def _guard(self):
        low = self.page.content()[:3000].lower()
        if "access denied" in low or "captcha" in low:
            detect_antibot(403, low)

    def add_to_cart(self, url):
        self.page.goto(url, wait_until="domcontentloaded")
        self.page.wait_for_timeout(2500)
        self._guard()
        slug = re.search(r"/product/([a-z0-9-]+?)-\d{5,}", url)
        words = [w for w in (slug.group(1).split("-") if slug else []) if len(w) > 2][:2]

        def cart_html():
            self.page.goto(f"{BASE}/fr/cart", wait_until="domcontentloaded")
            self.page.wait_for_timeout(3000)
            self._guard()
            return self.page.content()

        def has_target(h):
            low = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", htmllib.unescape(h))).lower()
            return bool(words) and all(w in low for w in words)

        html = cart_html()
        if not has_target(html):  # idempotent: never add a second copy
            self.page.goto(url, wait_until="domcontentloaded")
            self.page.wait_for_timeout(2500)
            btn = self.page.get_by_role("button", name=re.compile(r"ajouter au panier|in den warenkorb|add to cart", re.I)).first
            try:
                btn.click(timeout=8000)
            except Exception:  # sticky header can overlay the button
                btn.evaluate("e => e.click()")
            self.page.wait_for_timeout(2500)
            html = cart_html()
            if not has_target(html):
                raise FetchError("product not found in cart after add")
        ship, delivery = parse_delivery(html)
        text = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", htmllib.unescape(html)))
        m = re.search(r"(?:Total|Gesamtbetrag)[^0-9]{0,40}([\d'’.,]+)", text)
        return {"shipping_chf": ship, "delivery": delivery, "cart_total_chf": to_float(m.group(1)) if m else None,
                "items": text.split("Passer en caisse")[0].count("Supprimer"),  # active cart only (not 'saved for later')
                "cart_url": f"{BASE}/fr/cart", "checkout_url": f"{BASE}/fr/checkout"}

    def _throttle(self):
        delay = float(os.environ.get("GALAXUS_MIN_DELAY", "3"))
        wait = delay - (time.time() - _last_req[0])
        if wait > 0:
            time.sleep(wait)
        _last_req[0] = time.time()

    def _goto(self, url, wait_ms=0):
        """Throttled navigation. 403/429 or an access-denied page => AntiBotError (never retried)."""
        self._throttle()
        resp = self.page.goto(url, wait_until="domcontentloaded")
        status = resp.status if resp is not None else 200
        if status in (403, 429):
            detect_antibot(status, "")
        if wait_ms:
            self.page.wait_for_timeout(wait_ms)
        self._guard()
        return status

    def render(self, url):
        self._goto(url, 4000)
        return self.page.content()

    def search(self, query, limit=8):
        """Galaxus renders search client-side: listen for the useSearchDataQuery GraphQL response the page itself
        fires (logged-in profile = same prices as the account sees); fall back to parsing the rendered DOM.
        Bounded retries (MAX_RETRIES) on timeouts/5xx only; captcha/403 raises AntiBotError at once."""
        last = None
        for attempt in range(MAX_RETRIES + 1):
            payloads = []

            def on_resp(r):
                if "useSearchDataQuery" in r.url:
                    if r.status in (403, 429):
                        payloads.append(AntiBotError(f"anti-bot block (HTTP {r.status}) on search query"))
                        return
                    try:
                        payloads.append(r.json())
                    except Exception as e:  # body not ready / not JSON: retry
                        payloads.append(FetchError(f"search response unreadable: {e}"))

            self.page.on("response", on_resp)
            try:
                self._goto(search_url(query))
                for _ in range(30):  # up to ~15s for the client-side query
                    if payloads:
                        break
                    self.page.wait_for_timeout(500)
            finally:
                self.page.remove_listener("response", on_resp)
            for p in payloads:
                if isinstance(p, AntiBotError):
                    raise p
            good = [p for p in payloads if isinstance(p, dict)]
            if good:
                res = parse_search_graphql(good[-1])
                if res or (good[-1].get("data") or {}).get("shopSearch"):
                    return res[:limit]
            self.page.wait_for_timeout(4000)
            res = parse_listing(self.page.content())
            if res:
                return res[:limit]
            last = payloads[-1] if payloads else "no search response captured"
            if attempt < MAX_RETRIES:
                time.sleep(2 ** (attempt + 1))
        raise FetchError(f"search failed after {MAX_RETRIES + 1} attempts: {last}")

    def cart_items(self):
        """Read-only: open /fr/cart and parse it. Returns parse_cart() dict."""
        self._goto(f"{BASE}/fr/cart", 4000)
        return parse_cart(self.page.content())

    def remove_item(self, pid):
        """Click 'Supprimer' on the cart line whose product id is pid. Only touches the cart page; no checkout."""
        self._goto(f"{BASE}/fr/cart", 4000)
        for li in self.page.locator("li.cart-item").all():
            if f"-{pid}" in (li.locator('a[href*="/product/"]').first.get_attribute("href") or ""):
                li.get_by_role("button", name=re.compile(r"^(supprimer|entfernen|remove|delete)$", re.I)).first.click(timeout=8000)
                self.page.wait_for_timeout(3000)
                return True
        return False

    def pay(self):
        """Click 'Acheter' on /fr/checkout (address + PayPal already saved on the logged-in account; verified
        2026-11-25 up to the button). Returns {'status': 'confirmed'|'needs_paypal'|'unknown', 'order': str|None,
        'url': str}. NEVER types card/PayPal credentials: if redirected to paypal.com we stop and report."""
        self.page.goto(f"{BASE}/fr/checkout", wait_until="domcontentloaded")
        self.page.wait_for_timeout(3000)
        self._guard()
        self.page.get_by_role("button", name=re.compile(r"^(acheter|kaufen|buy|payer)$", re.I)).last.click()
        self.page.wait_for_timeout(8000)
        url = self.page.url
        text = re.sub(r"\s+", " ", self.page.inner_text("body"))
        if "paypal." in url:
            res = self._paypal_approve(expected_total=getattr(self, "expected_total", None))
            if res is not None:
                url = self.page.url
                text = re.sub(r"\s+", " ", self.page.inner_text("body"))
            elif os.environ.get("GALAXUS_HEADED") == "1":
                # Human-in-the-loop: window is visible, Théo logs in / approves on PayPal himself (up to 6 min).
                for _ in range(240):
                    self.page.wait_for_timeout(1500)
                    if "paypal." not in self.page.url:
                        break
                url = self.page.url
                if "paypal." in url:
                    return {"status": "needs_paypal", "order": None, "url": url}
                self.page.wait_for_timeout(4000)
                text = re.sub(r"\s+", " ", self.page.inner_text("body"))
            else:
                return {"status": "needs_paypal", "order": None, "url": url}
        m = re.search(r"(?:commande|bestellung|order)[^0-9]{0,30}(\d{6,})", text, re.I)
        if re.search(r"merci pour votre commande|vielen dank|thank you|commande (?:a été )?(?:passée|enregistrée)", text, re.I) or "/order" in url:
            return {"status": "confirmed", "order": m.group(1) if m else None, "url": url}
        return {"status": "unknown", "order": None, "url": url}

    def _paypal_approve(self, expected_total=None):
        """Only with an ALREADY logged-in PayPal session (log in once by hand: jarvis-browser/login_paypal.py).
        Never types credentials. Refuses if a password field is shown or the amount on the page doesn't match.
        Returns True after clicking the approval button and landing back off paypal.com, else None."""
        pg = self.page
        pg.wait_for_timeout(4000)
        if pg.locator('input[type="password"]').count() or "connexion" in pg.url or "signin" in pg.url:
            return None
        body = re.sub(r"\s+", " ", pg.inner_text("body"))
        if expected_total is not None:
            amt = f"{expected_total:.2f}".rstrip("0").rstrip(".")
            if not re.search(re.escape(amt).replace("\\.", "[.,]"), body):
                return None
        btn = pg.get_by_role("button", name=re.compile(r"payer maintenant|continuer|accepter et payer|pay now|complete purchase|jetzt bezahlen", re.I))
        if not btn.count():
            return None
        btn.first.click()
        for _ in range(20):
            pg.wait_for_timeout(1500)
            if "paypal." not in pg.url:
                return True
        return None

    def close(self):
        self._cm.__exit__(None, None, None)


def glob_site(d):
    import glob
    g = glob.glob(f"{d}/.venv/lib/python*/site-packages")
    return g[0] if g else d


# ---------- commands ----------
def fmt_product(i, p):
    r = f"{p['rating']:.1f}/5 ({p['reviews']})" if p.get("rating") else "no rating"
    pr = f"CHF {p['price_chf']:.2f}" if p.get("price_chf") is not None else "price ?"
    props = f" [{p['properties']}]" if p.get("properties") else ""
    return f"{i}. {p['name']}{props} | {pr} | {r} | delivery: {p.get('delivery') or '?'} | {p['url']}"


def run_search(backend_factory, query, limit):
    backend = backend_factory()
    try:
        return backend.search(query, limit)
    finally:
        backend.close()


def cmd_search(a, backend_factory):
    prods = run_search(backend_factory, a.query, a.limit)
    if a.json:
        print(json.dumps(prods, ensure_ascii=False, indent=2))
    elif not prods:
        print("no results")
    for i, p in enumerate(prods, 1) if not a.json else []:
        print(fmt_product(i, p))
    return EXIT_OK


def cmd_buy(a, fetch, backend_factory, now_log):
    lp = log_path(a.log)
    prod = {"name": None, "price_chf": None, "url": a.url}
    if not a.url:
        if not a.query:
            print("need --url or a query", file=sys.stderr)
            return EXIT_USAGE
        res = run_search(backend_factory, a.query, max(a.pick, 8))
        if not res or a.pick < 1 or a.pick > len(res):
            print("no such search result", file=sys.stderr)
            return EXIT_ERR
        prod = res[a.pick - 1]
    page = fetch(prod["url"])
    items = parse_products(page)
    if items:
        prod = {**prod, **{k: v for k, v in items[0].items() if v is not None}, "url": prod["url"]}
    ship, delivery = parse_delivery(page)
    base = dict(product=prod.get("name"), price_chf=prod.get("price_chf"), link=prod["url"], dry_run=a.dry_run)

    if a.dry_run:
        total = compute_total(prod.get("price_chf"), ship)
        print_summary(prod, ship, total, delivery, None, None, "DRY-RUN (no cart, no payment)")
        now_log(lp, **base, total_chf=total, status="dry_run", reason="--dry-run")
        return EXIT_OK

    backend = backend_factory()
    try:
        cart = backend.add_to_cart(prod["url"])
        backend.expected_total = cart.get("cart_total_chf")
        if cart.get("shipping_chf") is not None:
            ship = cart["shipping_chf"]
        delivery = cart.get("delivery") or delivery
        total = compute_total(prod.get("price_chf"), ship)
        # SAFETY: the account cart may already hold other items; paying would buy them too.
        # Use the real cart total and refuse to pay unless the cart holds exactly this one item.
        if cart.get("cart_total_chf") is not None:
            total = cart["cart_total_chf"]
        if cart.get("items", 1) != 1:
            print(f"CART HAS {cart.get('items')} ITEMS (not only the target): total {total}. Remove the others first.", file=sys.stderr)
            now_log(lp, **base, total_chf=total, status="refused", reason=f"cart holds {cart.get('items')} items", checkout_url=cart["checkout_url"])
            return EXIT_PAY_REFUSED
        print_summary(prod, ship, total, delivery, cart["cart_url"], cart["checkout_url"], "STOPPED BEFORE PAYMENT")
        ok, why = decide_pay(total, load_limits(), spent_today(lp), a.confirm_pay)
        if not ok:
            code = EXIT_PAY_REFUSED if a.confirm_pay else EXIT_OK
            now_log(lp, **base, total_chf=total, status="stopped" if not a.confirm_pay else "refused", reason=why, checkout_url=cart["checkout_url"])
            if a.confirm_pay:
                print(f"PAYMENT REFUSED: {why}", file=sys.stderr)
            return code
        res = backend.pay() or {"status": "unknown"}
        if res["status"] == "confirmed":
            now_log(lp, **base, total_chf=total, status="paid", reason=why, order=res.get("order"), checkout_url=cart["checkout_url"])
            print(f"PAID {total:.2f} CHF | order {res.get('order') or '?'}")
            return EXIT_OK
        # not confirmed: do NOT log as paid (would eat the daily cap wrongly) and do NOT retry (double-buy risk)
        now_log(lp, **base, total_chf=total, status="pending_" + res["status"], reason="payment not confirmed: check Galaxus orders before retrying", url=res.get("url"))
        print(f"PAYMENT NOT CONFIRMED ({res['status']}) at {res.get('url')}. Check galaxus.ch orders; do not retry blindly.", file=sys.stderr)
        return EXIT_PAY_REFUSED
    finally:
        backend.close()


def fmt_cart(title, cart):
    lines = [f"-- {title}: {len(cart['items'])} item(s) --"]
    for i in cart["items"]:
        pr = f"{i['price_chf']:.2f}" if i.get("price_chf") is not None else "?"
        lines.append(f"  [{i['id']}] {i['name']} | qty {i.get('qty') or '?'} | CHF {pr} | {i['url']}")
    sh = cart.get("shipping_chf")
    tot = cart.get("total_chf")
    lines.append(f"  shipping: {f'{sh:.2f}' if sh is not None else '?'} | total: {f'{tot:.2f}' if tot is not None else '?'} CHF")
    return "\n".join(lines)


def cmd_cart_list(a, backend_factory):
    backend = backend_factory()
    try:
        cart = backend.cart_items()
    finally:
        backend.close()
    print(json.dumps(cart, ensure_ascii=False, indent=2) if a.json else fmt_cart("cart", cart))
    if not cart.get("list_found"):
        print("WARNING: no cart list on the page (empty cart, logged-out profile, or markup changed)", file=sys.stderr)
    return EXIT_OK


def _cart_apply(a, backend_factory, now_log, kind, select):
    """Shared remove/clear flow: list before, pick items via select(items) -> (to_remove, error), remove (unless
    --dry-run), list after, verify. Touches only the cart page (never adds, never pays)."""
    lp = log_path(getattr(a, "log", None))
    backend = backend_factory()
    try:
        before = backend.cart_items()
        print(fmt_cart("cart BEFORE", before))
        to_remove, err = select(before["items"])
        if err:
            print(err, file=sys.stderr)
            now_log(lp, product=None, price_chf=None, link=None, status="cart_refused", reason=err, dry_run=a.dry_run)
            return EXIT_ERR
        if not to_remove:
            print("nothing to remove")
            return EXIT_OK
        for it in to_remove:
            print(f"{'WOULD REMOVE' if a.dry_run else 'REMOVING'}: [{it['id']}] {it['name']} (CHF {it.get('price_chf')}) {it['url']}")
        if a.dry_run:
            for it in to_remove:
                now_log(lp, product=it["name"], price_chf=it.get("price_chf"), link=it["url"], status="dry_run_cart_remove", reason=kind, dry_run=True)
            print("DRY-RUN: cart unchanged")
            return EXIT_OK
        for it in to_remove:
            if not backend.remove_item(it["id"]):
                print(f"ERROR: line not found on cart page: {it['id']}", file=sys.stderr)
                return EXIT_ERR
            now_log(lp, product=it["name"], price_chf=it.get("price_chf"), link=it["url"], status="cart_removed", reason=kind, dry_run=False)
        after = backend.cart_items()
        print(fmt_cart("cart AFTER", after))
        removed = {i["id"] for i in to_remove}
        expect = {i["id"] for i in before["items"]} - removed
        got = {i["id"] for i in after["items"]}
        if got & removed or got != expect:
            print(f"VERIFY FAILED: expected ids {sorted(expect)}, got {sorted(got)}", file=sys.stderr)
            return EXIT_ERR
        print(f"VERIFIED: removed {sorted(removed)}, kept {sorted(got)}")
        return EXIT_OK
    finally:
        backend.close()


def cmd_cart_remove(a, backend_factory, now_log):
    pid = product_id(a.url)
    if not pid:
        print("--url must be a galaxus product URL ending in the numeric product id", file=sys.stderr)
        return EXIT_USAGE

    def select(items):
        hit = [i for i in items if i["id"] == pid]
        return (hit, None) if hit else ([], f"product {pid} is not in the cart: nothing removed")
    return _cart_apply(a, backend_factory, now_log, "cart-remove", select)


def cmd_cart_clear(a, backend_factory, now_log):
    keep = [product_id(u) for u in a.keep]
    if not keep or None in keep:
        print("each --keep must be a galaxus product URL ending in the numeric product id", file=sys.stderr)
        return EXIT_USAGE

    def select(items):
        if not {i["id"] for i in items} & set(keep):
            return [], f"none of the --keep products {keep} is in the cart: refusing to clear (typo guard)"
        return [i for i in items if i["id"] not in keep], None
    return _cart_apply(a, backend_factory, now_log, "cart-clear", select)


def print_summary(p, ship, total, delivery, cart_url, checkout_url, state):
    print(f"== {state} ==")
    print(f"product : {p.get('name')}")
    print(f"price   : {p['price_chf']:.2f} CHF" if p.get("price_chf") is not None else "price   : ?")
    print(f"shipping: {ship:.2f} CHF" if ship is not None else "shipping: ? (unknown)")
    print(f"total   : {total:.2f} CHF" if total is not None else "total   : ? (unknown, pay would be refused)")
    print(f"delivery: {delivery or '?'}")
    print(f"link    : {p.get('url')}")
    if cart_url:
        print(f"cart    : {cart_url}\ncheckout: {checkout_url}")


def build_parser():
    ap = argparse.ArgumentParser(prog="galaxus-buy", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("search", help="search galaxus.ch, list price/rating/reviews/delivery")
    s.add_argument("query")
    s.add_argument("--limit", type=int, default=8)
    s.add_argument("--json", action="store_true")
    b = sub.add_parser("buy", help="add to cart, compute total, stop at checkout (default)")
    b.add_argument("query", nargs="?")
    b.add_argument("--url")
    b.add_argument("--pick", type=int, default=1, help="1-based search result to buy")
    b.add_argument("--dry-run", action="store_true", help="no cart, no browser, no payment")
    b.add_argument("--confirm-pay", action="store_true", help="pay if under limits from achat.json")
    b.add_argument("--log", help="JSONL log path")
    sub.add_parser("cart-list", help="read-only: list active cart lines").add_argument("--json", action="store_true")
    r = sub.add_parser("cart-remove", help="remove ONE product from the cart (explicit, never from search/buy)")
    r.add_argument("--url", required=True)
    r.add_argument("--dry-run", action="store_true", help="show what would be removed, change nothing")
    r.add_argument("--log", help="JSONL log path")
    c = sub.add_parser("cart-clear", help="remove every cart line except the --keep products")
    c.add_argument("--keep", action="append", required=True, help="product URL to keep (repeatable, >=1)")
    c.add_argument("--dry-run", action="store_true", help="show what would be removed, change nothing")
    c.add_argument("--log", help="JSONL log path")
    return ap


def main(argv=None, fetch=fetch_rendered, backend_factory=BrowserBackend, now_log=log_attempt):
    a = build_parser().parse_args(argv)
    try:
        if a.cmd == "search":
            return cmd_search(a, backend_factory)
        if a.cmd == "cart-list":
            return cmd_cart_list(a, backend_factory)
        if a.cmd == "cart-remove":
            return cmd_cart_remove(a, backend_factory, now_log)
        if a.cmd == "cart-clear":
            return cmd_cart_clear(a, backend_factory, now_log)
        return cmd_buy(a, fetch, backend_factory, now_log)
    except AntiBotError as e:
        print(f"ANTI-BOT: {e}", file=sys.stderr)
        if a.cmd in ("buy", "cart-remove", "cart-clear"):
            now_log(log_path(getattr(a, "log", None)), product=None, price_chf=None, link=getattr(a, "url", None), status="blocked", reason=str(e))
        return EXIT_ANTIBOT
    except FetchError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return EXIT_ERR


if __name__ == "__main__":
    sys.exit(main())
