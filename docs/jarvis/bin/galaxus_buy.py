#!/usr/bin/env python3
"""galaxus-buy: search Galaxus.ch, add to cart, STOP AT CHECKOUT (never pays by default).

Usage:
  galaxus_buy.py search "tapis de course zipro" [--limit 8] [--json]
  galaxus_buy.py buy --url <product url> [--dry-run] [--confirm-pay]
  galaxus_buy.py buy "zipro catwalk" --pick 1 [--dry-run]

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


def parse_listing(html):
    """Galaxus listing cards (no JSON-LD there). Each product has several anchors /fr/s3/product/<slug>-<id>;
    card text is between the first anchor of a product and the first anchor of the next:
    '... Tapis de course CHF 139.- <name> <review count>' (verified on live page 2026-11-25)."""
    first = {}
    for m in re.finditer(r'href="(/fr/s3/product/([a-z0-9-]+?)-(\d{5,}))[^"]*"', html):
        first.setdefault(m.group(3), (m.start(), m.group(1), m.group(2)))
    items = sorted(first.values())
    out = []
    for i, (start, path, slug) in enumerate(items):
        end = items[i + 1][0] if i + 1 < len(items) else start + 6000
        t = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", html[start:end]))
        pr = re.search(r"CHF\s*([\d'’.,]+)\S*\s+(.+?)\s+(\d{1,6})\s*(?:<|$|\S*\s*[A-Za-z])", t)
        pm = re.search(r"CHF\s*([\d'’.,]+)", t)
        name = None
        if pm:
            tail = t[pm.end():]
            nm = re.match(r"\S*\s*(.+?)\s+(\d{1,6})(?:\s|$)", tail)
            name = nm.group(1).strip() if nm else None
        out.append({"name": name or slug.replace("-", " "), "price_chf": to_float(pm.group(1)) if pm else None,
                    "rating": None, "reviews": int(nm.group(2)) if pm and nm else 0,
                    "url": urllib.parse.urljoin(BASE, path), "delivery": None})
    return out


def category_link(html, query):
    """Generic queries land on a category page; return its producttype listing URL if any."""
    words = [w for w in re.split(r"\W+", query.lower()) if len(w) > 2]
    for href in dict.fromkeys(re.findall(r'href="((?:https://www\.galaxus\.ch)?/fr/s\d+/producttype/[a-z0-9-]+)', html)):
        if all(w in href for w in words[:2]):
            return urllib.parse.urljoin(BASE, href)
    return None


def search_products(fetch, query):
    page = fetch(search_url(query))
    res = parse_products(page) or parse_listing(page)
    if not res:
        cat = category_link(page, query)
        if cat:
            res = parse_listing(fetch(cat))
    return res


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
        self.page.get_by_role("button", name=re.compile(r"ajouter au panier|in den warenkorb|add to cart", re.I)).first.click()
        self.page.wait_for_timeout(2500)
        self.page.goto(f"{BASE}/fr/cart", wait_until="domcontentloaded")
        self.page.wait_for_timeout(2500)
        self._guard()
        html = self.page.content()
        ship, delivery = parse_delivery(html)
        text = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", htmllib.unescape(html)))
        m = re.search(r"(?:Total|Gesamtbetrag)[^0-9]{0,40}([\d'’.,]+)", text)
        return {"shipping_chf": ship, "delivery": delivery, "cart_total_chf": to_float(m.group(1)) if m else None,
                "items": text.count("Supprimer"),
                "cart_url": f"{BASE}/fr/cart", "checkout_url": f"{BASE}/fr/checkout"}

    def pay(self):
        """Last step with the payment method already saved in the logged-in profile. Never types card data.
        UNVERIFIED on the live site (needs a logged-in profile + payment method)."""
        self.page.goto(f"{BASE}/fr/checkout", wait_until="domcontentloaded")
        self.page.wait_for_timeout(2500)
        self._guard()
        self.page.get_by_role("button", name=re.compile(r"payer|acheter|commander|bezahlen|kaufen|order", re.I)).last.click()
        self.page.wait_for_timeout(3000)
        self._guard()

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
    return f"{i}. {p['name']} | {pr} | {r} | delivery: {p.get('delivery') or '?'} | {p['url']}"


def cmd_search(a, fetch):
    prods = search_products(fetch, a.query)[: a.limit]
    if a.json:
        print(json.dumps(prods, ensure_ascii=False, indent=2))
    elif not prods:
        print("no results parsed (markup may have changed)")
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
        res = search_products(fetch, a.query)
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
        backend.pay()
        now_log(lp, **base, total_chf=total, status="paid", reason=why, checkout_url=cart["checkout_url"])
        print(f"PAID {total:.2f} CHF")
        return EXIT_OK
    finally:
        backend.close()


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
    return ap


def main(argv=None, fetch=fetch_rendered, backend_factory=BrowserBackend, now_log=log_attempt):
    a = build_parser().parse_args(argv)
    try:
        return cmd_search(a, fetch) if a.cmd == "search" else cmd_buy(a, fetch, backend_factory, now_log)
    except AntiBotError as e:
        print(f"ANTI-BOT: {e}", file=sys.stderr)
        if a.cmd == "buy":
            now_log(log_path(getattr(a, "log", None)), product=None, price_chf=None, link=getattr(a, "url", None), status="blocked", reason=str(e))
        return EXIT_ANTIBOT
    except FetchError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return EXIT_ERR


if __name__ == "__main__":
    sys.exit(main())
