"""Shared read-only web helpers for insta_reel.py and subject_research.py (stdlib + optional browser).

- HTTP fetch (urllib): size cap, <= MAX_ATTEMPTS tries on network errors/5xx only, never on 403/429/captcha.
- Browser fetch: ONE headless browser owned by the script (Camoufox default, Patchright optional), never the
  Mac's Google Chrome. Images/media/fonts blocked, per-page byte cap, closed at end of run.
- JSONL visit log outside the repo. No page body, cookie, key or proxy credential is ever written.
- Secrets only from env: JARVIS_PROXY_URL (optional), SERPAPI_API_KEY (subject_research), YOUTUBE_API_KEY (youtube_*).

Env: JARVIS_WEB_LOG (log path, default ~/.local/share/jarvis-resell/web-visits.jsonl), JARVIS_PROXY_URL,
JARVIS_MAX_PAGE_MB (default 3), JARVIS_MIN_DELAY (seconds between requests, default 2).
"""
import datetime
import html as htmllib
import ipaddress
import json
import os
import re
import socket
import time
import urllib.error
import urllib.parse
import urllib.request
from html.parser import HTMLParser

UA = "Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0"
MAX_ATTEMPTS = 3
DEFAULT_LOG = "~/.local/share/jarvis-resell/web-visits.jsonl"
DEFAULT_MAX_MB = 3.0
BLOCKED_RESOURCES = {"image", "media", "font", "stylesheet"}
MEDIA_URL_RE = re.compile(r"(//(scontent|video)[^/]*\.(cdninstagram\.com|fbcdn\.net)/)|(\.(mp4|webm|m4s|mp3|m4a|mov)(\?|$))", re.I)

SECRET_ENV_NAMES = ("SERPAPI_API_KEY", "YOUTUBE_API_KEY", "JARVIS_PROXY_URL")


class AntiBotError(Exception):
    pass


class FetchError(Exception):
    pass


class UnsafeUrlError(FetchError):
    pass


# ---------- secrets ----------
def secret_values():
    out = []
    for name in SECRET_ENV_NAMES:
        v = os.environ.get(name)
        if v and len(v) >= 6:
            out.append(v)
    return out


def mask(text, extra=()):
    """Replace every known secret value (env + extra) and api_key=... query values in text."""
    s = str(text)
    for v in list(secret_values()) + [e for e in extra if e]:
        s = s.replace(v, "***")
    s = re.sub(r"((?:api_key|[?&]key)=)[^&\s\"']+", r"\1***", s, flags=re.I)
    s = re.sub(r"(//[^/\s:@]+:)[^@\s/]+@", r"\1***@", s)
    return s


# ---------- config ----------
def max_page_bytes(mb=None):
    try:
        v = float(mb if mb is not None else os.environ.get("JARVIS_MAX_PAGE_MB", DEFAULT_MAX_MB))
    except ValueError:
        v = DEFAULT_MAX_MB
    return int(max(0.1, v) * 1024 * 1024)


def min_delay():
    try:
        return max(0.0, float(os.environ.get("JARVIS_MIN_DELAY", "2")))
    except ValueError:
        return 2.0


def proxy_config():
    """Playwright proxy dict from JARVIS_PROXY_URL (http(s)/socks5://user:pass@host:port) or None."""
    raw = os.environ.get("JARVIS_PROXY_URL")
    if not raw:
        return None
    u = urllib.parse.urlsplit(raw)
    if not u.hostname:
        return None
    cfg = {"server": f"{u.scheme}://{u.hostname}" + (f":{u.port}" if u.port else "")}
    if u.username:
        cfg["username"] = urllib.parse.unquote(u.username)
    if u.password:
        cfg["password"] = urllib.parse.unquote(u.password)
    return cfg


# ---------- JSONL log ----------
def log_path(override=None):
    return os.path.expanduser(override or os.environ.get("JARVIS_WEB_LOG") or DEFAULT_LOG)


def safe_log_url(url):
    """URL without query/fragment (tracking ids, tokens) for the visit log."""
    try:
        u = urllib.parse.urlsplit(url)
        return urllib.parse.urlunsplit((u.scheme, u.netloc, u.path, "", ""))
    except ValueError:
        return ""


def log_visit(path, tool, url, **rec):
    row = {"ts": datetime.datetime.now().astimezone().isoformat(timespec="seconds"), "tool": tool,
           "url": safe_log_url(url), **rec}
    if "error" in row and row["error"]:
        row["error"] = mask(row["error"])[:300]
    try:
        os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
        with open(path, "a") as f:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")
    except OSError:
        pass
    return row


# ---------- URL safety ----------
def check_public_url(url):
    """Refuse non-http(s) and private/loopback/link-local targets (search results are untrusted input)."""
    u = urllib.parse.urlsplit(url)
    if u.scheme not in ("http", "https") or not u.hostname:
        raise UnsafeUrlError(f"unsupported url: {safe_log_url(url)}")
    try:
        infos = socket.getaddrinfo(u.hostname, None)
    except socket.gaierror as e:
        raise FetchError(f"dns: {e}")
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast:
            raise UnsafeUrlError(f"non-public address for {u.hostname}")


class _SafeRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        check_public_url(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


# ---------- HTTP fetch ----------
def detect_antibot(status, body):
    if status in (401, 403, 429):
        return True
    low = (body or "")[:6000].lower()
    return any(m in low for m in ("captcha", "unusual traffic", "verify you are human", "access denied",
                                  "just a moment", "cf-chl", "px-captcha"))


def http_get(url, max_bytes=None, timeout=20, opener=None, sleep=time.sleep, delay=None, headers=None, any_type=False):
    """-> (status, html, nbytes). Raises AntiBotError (no retry) / FetchError after MAX_ATTEMPTS."""
    check_public_url(url)
    cap = max_bytes or max_page_bytes()
    op = opener or urllib.request.build_opener(_SafeRedirect).open
    last = None
    for attempt in range(1, MAX_ATTEMPTS + 1):
        sleep(min_delay() if delay is None else delay)
        hdrs = {"User-Agent": UA, "Accept": "text/html,*/*;q=0.8", "Accept-Language": "fr-CH,fr;q=0.9,en;q=0.5"}
        hdrs.update(headers or {})
        req = urllib.request.Request(url, headers=hdrs)
        try:
            with op(req, timeout=timeout) as r:
                raw = r.read(cap + 1)
                if len(raw) > cap:
                    raw = raw[:cap]
                ctype = (r.headers.get("Content-Type") or "").lower()
                if ctype and not any_type and "html" not in ctype and "xml" not in ctype and "text" not in ctype:
                    raise FetchError(f"not html: {ctype[:40]}")
                body = raw.decode(r.headers.get_content_charset() or "utf-8", "replace")
                if detect_antibot(r.status, body):
                    raise AntiBotError(f"anti-bot page (status {r.status})")
                return r.status, body, len(raw)
        except urllib.error.HTTPError as e:
            if e.code in (401, 403, 429):
                raise AntiBotError(f"HTTP {e.code}")
            if e.code < 500:
                raise FetchError(f"HTTP {e.code}")
            last = f"HTTP {e.code}"
        except (urllib.error.URLError, TimeoutError, ConnectionError, socket.timeout) as e:
            last = mask(getattr(e, "reason", e))
        if attempt < MAX_ATTEMPTS:
            sleep(2 * attempt)
    raise FetchError(f"failed after {MAX_ATTEMPTS} attempts: {last}")


# ---------- browser ----------
class Browser:
    """One headless browser for the whole run. Lazy import so unit tests need no browser."""

    def __init__(self, engine="camoufox", max_bytes=None, log=None, tool="web"):
        self.engine, self.max_bytes, self.tool = engine, max_bytes or max_page_bytes(), tool
        self.log = log_path(log)
        self._cm = self._browser = self._pw = None
        self._last = 0.0

    def start(self):
        proxy = proxy_config()
        try:
            if self.engine == "camoufox":
                from camoufox.sync_api import Camoufox
                kw = dict(headless=True, locale="en-US", i_know_what_im_doing=True)
                if proxy:
                    kw.update(proxy=proxy, geoip=True)
                self._cm = Camoufox(**kw)
                self._browser = self._cm.__enter__()
            elif self.engine == "patchright":
                from patchright.sync_api import sync_playwright
                self._pw = sync_playwright().start()
                kw = dict(headless=True)  # bundled Chromium, never channel="chrome" (Mac Chrome is not ours)
                if proxy:
                    kw["proxy"] = proxy
                self._browser = self._pw.chromium.launch(**kw)
            else:
                raise FetchError(f"unknown engine {self.engine}")
        except ImportError as e:
            raise FetchError(f"{self.engine} not installed (pip install -r docs/jarvis/bin/requirements-browser.txt): {e}")
        return self

    def close(self):
        for fn in (lambda: self._browser and self._browser.close(),
                   lambda: self._cm and self._cm.__exit__(None, None, None),
                   lambda: self._pw and self._pw.stop()):
            try:
                fn()
            except Exception:
                pass
        self._browser = self._cm = self._pw = None

    def __enter__(self):
        return self.start()

    def __exit__(self, *a):
        self.close()

    def fetch(self, url, wait_ms=3500, want_text=True):
        """-> dict(status, final_url, html, text, bytes, capped). One attempt; callers loop (<= MAX_ATTEMPTS)."""
        check_public_url(url)
        gap = min_delay() - (time.time() - self._last)
        if gap > 0:
            time.sleep(gap)
        ctx = self._browser.new_context(locale="en-US") if self.engine == "patchright" else None
        page = (ctx or self._browser).new_page()
        state = {"bytes": 0, "capped": False}

        def on_route(route):
            req = route.request
            if state["capped"] or req.resource_type in BLOCKED_RESOURCES or MEDIA_URL_RE.search(req.url):
                return route.abort()
            return route.continue_()

        def on_response(resp):
            try:
                state["bytes"] += int(resp.headers.get("content-length") or 0)
            except (ValueError, TypeError):
                pass
            if state["bytes"] > self.max_bytes:
                state["capped"] = True

        try:
            page.route("**/*", on_route)
            page.on("response", on_response)
            resp = page.goto(url, wait_until="domcontentloaded", timeout=45000)
            page.wait_for_timeout(wait_ms)
            html = page.content()
            text = page.inner_text("body") if want_text else ""
            state["bytes"] += len(html.encode("utf-8", "ignore"))  # document is often chunked: no content-length
            return {"status": resp.status if resp else 0, "final_url": page.url, "html": html, "text": text,
                    "bytes": state["bytes"], "capped": state["capped"] or state["bytes"] > self.max_bytes}
        finally:
            self._last = time.time()
            try:
                page.close()
                if ctx:
                    ctx.close()
            except Exception:
                pass


def browser_fetch_retry(br, url, tool, log, sleep=time.sleep, **kw):
    """Up to MAX_ATTEMPTS tries on errors; no retry on anti-bot/403. Always logs one JSONL row per attempt."""
    last = None
    for attempt in range(1, MAX_ATTEMPTS + 1):
        t0 = time.time()
        try:
            r = br.fetch(url, **kw)
            blocked = detect_antibot(r["status"], r["html"]) and r["status"] in (401, 403, 429)
            log_visit(log, tool, url, engine=br.engine, status=r["status"], bytes=r["bytes"],
                      capped=r["capped"], attempt=attempt, ms=int((time.time() - t0) * 1000),
                      proxy=bool(proxy_config()), outcome="antibot" if blocked else "ok")
            if blocked:
                raise AntiBotError(f"HTTP {r['status']}")
            return r
        except UnsafeUrlError:
            raise
        except AntiBotError:
            raise
        except Exception as e:  # noqa: BLE001 - browser libs raise many types
            last = mask(e)
            log_visit(log, tool, url, engine=br.engine, attempt=attempt, outcome="error", error=last,
                      ms=int((time.time() - t0) * 1000), proxy=bool(proxy_config()))
            if attempt < MAX_ATTEMPTS:
                sleep(2 * attempt)
    raise FetchError(f"failed after {MAX_ATTEMPTS} attempts: {last}")


# ---------- parsing ----------
class _Meta(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.meta, self.title, self.links, self.jsonld = {}, "", [], []
        self._in_title = self._in_ld = False
        self._buf = []

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "meta":
            k = a.get("property") or a.get("name")
            if k and a.get("content") is not None:
                self.meta.setdefault(k.lower(), a["content"])
        elif tag == "title":
            self._in_title = True
        elif tag == "a" and a.get("href"):
            self.links.append((a["href"], (a.get("aria-label") or a.get("title") or "").strip()))
        elif tag == "script" and (a.get("type") or "").lower() == "application/ld+json":
            self._in_ld, self._buf = True, []

    def handle_endtag(self, tag):
        if tag == "title":
            self._in_title = False
        elif tag == "script" and self._in_ld:
            self._in_ld = False
            self.jsonld.append("".join(self._buf))

    def handle_data(self, data):
        if self._in_title and len(self.title) < 300:
            self.title += data
        elif self._in_ld:
            self._buf.append(data)


def parse_html(html):
    p = _Meta()
    try:
        p.feed(html)
    except Exception:  # noqa: BLE001 - malformed html must not crash a run
        pass
    ld = []
    for blob in p.jsonld:
        try:
            ld.append(json.loads(blob))
        except ValueError:
            continue
    return {"meta": p.meta, "title": p.title.strip(), "links": p.links, "jsonld": ld}


def walk_jsonld(o):
    if isinstance(o, dict):
        yield o
        for v in o.values():
            yield from walk_jsonld(v)
    elif isinstance(o, list):
        for v in o:
            yield from walk_jsonld(v)


def jsonld_products(blocks):
    """Product dicts from JSON-LD: name, brand, sku, mpn, gtin, price, currency."""
    out = []
    for blob in blocks:
        for n in walk_jsonld(blob):
            t = n.get("@type")
            ts = t if isinstance(t, list) else [t]
            if "Product" not in ts:
                continue
            offers = n.get("offers")
            offer = offers[0] if isinstance(offers, list) and offers else offers if isinstance(offers, dict) else {}
            brand = n.get("brand")
            brand = brand.get("name") if isinstance(brand, dict) else brand
            gtin = next((str(n[k]) for k in ("gtin13", "gtin", "gtin12", "gtin14", "gtin8") if n.get(k)), None)
            price = offer.get("price") if isinstance(offer, dict) else None
            if price is None and isinstance(offer, dict):
                price = offer.get("lowPrice")
            out.append({"name": n.get("name"), "brand": brand if isinstance(brand, str) else None,
                        "sku": str(n["sku"]) if n.get("sku") else None, "mpn": str(n["mpn"]) if n.get("mpn") else None,
                        "gtin": gtin, "price": str(price) if price is not None else None,
                        "currency": offer.get("priceCurrency") if isinstance(offer, dict) else None})
    return [p for p in out if p.get("name")]


HASHTAG_RE = re.compile(r"(?<![\w&])#([^\W\d_][\w]{0,99}|\d+[^\W\d_][\w]{0,99})", re.UNICODE)
MENTION_RE = re.compile(r"(?<![\w.])@([A-Za-z0-9_](?:[A-Za-z0-9_.]{0,28}[A-Za-z0-9_])?)")
URL_RE = re.compile(r"https?://[^\s<>\"')\]]+", re.I)
BARE_DOMAIN_RE = re.compile(r"(?<![@\w/.])((?:[a-z0-9-]+\.)+(?:com|ch|fr|de|it|co|io|shop|store|net|org|eu|uk|us))(/[^\s<>\"')\]]*)?(?![\w@])", re.I)


def extract_hashtags(text):
    seen, out = set(), []
    for m in HASHTAG_RE.finditer(text or ""):
        tag = m.group(1)
        if tag.lower() not in seen:
            seen.add(tag.lower())
            out.append(tag)
    return out


def extract_mentions(text):
    seen, out = set(), []
    for m in MENTION_RE.finditer(text or ""):
        u = m.group(1).rstrip(".")
        if u.lower() not in seen:
            seen.add(u.lower())
            out.append(u)
    return out


def unwrap_redirect(url):
    """Instagram/Google wrap external links (l.instagram.com/?u=..., google.com/url?q=...). Return target."""
    try:
        u = urllib.parse.urlsplit(url)
        if u.hostname in ("l.instagram.com", "l.facebook.com", "lm.facebook.com"):
            t = urllib.parse.parse_qs(u.query).get("u")
            if t:
                return t[0]
        if u.hostname and u.hostname.endswith("google.com") and u.path == "/url":
            q = urllib.parse.parse_qs(u.query)
            t = q.get("q") or q.get("url")
            if t:
                return t[0]
    except ValueError:
        pass
    return url


def strip_tracking(url):
    try:
        u = urllib.parse.urlsplit(url)
        q = [(k, v) for k, v in urllib.parse.parse_qsl(u.query, keep_blank_values=True)
             if not (k.lower().startswith("utm_") or k.lower() in ("fbclid", "igshid", "igsh", "gclid", "ref", "mc_cid", "mc_eid"))]
        return urllib.parse.urlunsplit((u.scheme, u.netloc, u.path, urllib.parse.urlencode(q), ""))
    except ValueError:
        return url


def extract_urls(text):
    out, seen = [], set()
    for m in URL_RE.finditer(text or ""):
        u = strip_tracking(unwrap_redirect(m.group(0).rstrip(".,;:!?")))
        if u not in seen:
            seen.add(u)
            out.append(u)
    for m in BARE_DOMAIN_RE.finditer(URL_RE.sub(" ", text or "")):
        u = "https://" + m.group(1).lower() + (m.group(2) or "")
        u = u.rstrip(".,;:!?")
        if u not in seen:
            seen.add(u)
            out.append(u)
    return out


def domain_of(url):
    try:
        h = (urllib.parse.urlsplit(url).hostname or "").lower()
    except ValueError:
        return ""
    return h[4:] if h.startswith("www.") else h


# ---------- slug ----------
_SPECIAL = {"œ": "oe", "Œ": "oe", "æ": "ae", "Æ": "ae", "ß": "ss", "ø": "o", "Ø": "o", "đ": "d", "ł": "l", "Ł": "l"}


def slugify(text, max_len=60):
    import hashlib
    import unicodedata
    s = "".join(_SPECIAL.get(c, c) for c in str(text))
    s = unicodedata.normalize("NFKD", s)
    s = "".join(c for c in s if not unicodedata.combining(c)).lower()
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    if len(s) > max_len:
        s = s[:max_len].rsplit("-", 1)[0] if "-" in s[:max_len] else s[:max_len]
        s = s.strip("-")
    if not s:
        s = "sujet-" + hashlib.sha1(str(text).strip().lower().encode("utf-8")).hexdigest()[:8]
    return s
