#!/usr/bin/env python3
"""Supplier viability POC runner (read-only)."""
from __future__ import annotations

import argparse
import csv
import gzip
import json
import os
import random
import re
import time
import urllib.error
import urllib.request
from collections import Counter
from datetime import datetime
from pathlib import Path
from typing import Any, Optional
from urllib.parse import urljoin, urlparse
from urllib.robotparser import RobotFileParser
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data"
REPORTS = ROOT / "reports"
TZ = ZoneInfo("Europe/Zurich")
UA = "SupplierViabilityPOC/1.0 (+read-only; respect robots.txt)"
TARGET = 300
EURCHF = 0.94
TARGET_MARGIN = 0.12
SUPPLIERS = ("farnell", "buerklin", "berrybase", "pollin")

FIELDS = [
    "supplier", "product_url", "supplier_sku", "name", "brand", "mpn", "gtin",
    "gtin_qty", "sales_unit", "packaging", "price", "currency", "price_basis",
    "vat_rate", "price_tiers", "moq", "stock", "availability", "lead_time_days",
    "weight_kg", "origin_country", "hs_code", "image_url", "scrape_timestamp",
    "gtin_valid", "gtin_reason", "parse_error", "sample_bucket",
]


def now_iso() -> str:
    return datetime.now(TZ).isoformat(timespec="seconds")


def normalize_gtin(raw: Optional[str]) -> Optional[str]:
    if raw is None:
        return None
    s = re.sub(r"[\s-]", "", str(raw).strip())
    return s or None


def gtin_checksum_ok(digits: str) -> bool:
    if not re.fullmatch(r"\d+", digits) or len(digits) not in (8, 12, 13, 14):
        return False
    body = [int(d) for d in digits[:-1]]
    check = int(digits[-1])
    total, w = 0, 3
    for d in reversed(body):
        total += d * w
        w = 1 if w == 3 else 3
    return ((10 - (total % 10)) % 10) == check


def classify_gtin(raw: Optional[str], mpn: Optional[str] = None, packaging: Optional[str] = None) -> dict:
    g = normalize_gtin(raw)
    out = {"gtin": g, "valid": False, "reason": "missing", "mpn_collision": False, "packaging_risk": False}
    if not g:
        return out
    if not re.fullmatch(r"\d+", g) or len(g) not in (8, 12, 13, 14):
        out["reason"] = "bad_length_or_non_digit"
        return out
    if not gtin_checksum_ok(g):
        out["reason"] = "bad_checksum"
        return out
    if mpn and re.sub(r"\D", "", str(mpn)) == g:
        out["mpn_collision"] = True
        out["reason"] = "mpn_as_gtin"
        return out
    pack = (packaging or "").lower()
    if any(t in pack for t in ("multipack", "carton", "tray", "vpe", "verpackungseinheit")):
        out["packaging_risk"] = True
        out["reason"] = "packaging_risk"
        out["valid"] = True
        return out
    out["valid"] = True
    out["reason"] = "ok"
    return out


class FetchError(Exception):
    def __init__(self, msg: str, blocked: bool = False, status: Optional[int] = None):
        super().__init__(msg)
        self.blocked = blocked
        self.status = status


class Session:
    def __init__(self, delay: float = 1.0):
        self.delay = delay
        self._last = 0.0
        self._robots: dict[str, RobotFileParser] = {}
        self.stats: Counter = Counter()

    def _wait(self) -> None:
        dt = time.monotonic() - self._last
        if dt < self.delay:
            time.sleep(self.delay - dt)

    def allowed(self, url: str) -> bool:
        origin = f"{urlparse(url).scheme}://{urlparse(url).netloc}"
        if origin not in self._robots:
            rp = RobotFileParser()
            try:
                body = self.get(urljoin(origin + "/", "robots.txt"), respect_robots=False)
                rp.parse(body.decode("utf-8", "ignore").splitlines())
            except Exception:
                rp.parse(["User-agent: *", "Allow: /"])
            self._robots[origin] = rp
        return bool(self._robots[origin].can_fetch(UA, url))

    def get(self, url: str, respect_robots: bool = True) -> bytes:
        if respect_robots and not self.allowed(url):
            self.stats["robots_skip"] += 1
            raise FetchError(f"robots disallow {url}")
        self._wait()
        # Prefer curl: Cursor sandbox proxy breaks urllib for many hosts.
        import subprocess, tempfile, os
        try:
            with tempfile.NamedTemporaryFile(delete=False) as tmp:
                tmp_path = tmp.name
            cmd = [
                "curl", "-sL", "--max-time", "45",
                "-A", UA,
                "-H", "Accept: text/html,application/json;q=0.9,*/*;q=0.8",
                "-H", "Accept-Language: de,en;q=0.8",
                "-o", tmp_path,
                "-w", "%{http_code}",
                url,
            ]
            env = {k: v for k, v in os.environ.items() if k.lower() not in {
                "http_proxy", "https_proxy", "all_proxy", "socks_proxy", "socks5_proxy",
                "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "SOCKS_PROXY", "SOCKS5_PROXY",
                "GIT_HTTP_PROXY", "GIT_HTTPS_PROXY",
            }}
            proc = subprocess.run(cmd, capture_output=True, text=True, env=env)
            self._last = time.monotonic()
            code = int(proc.stdout.strip() or "0")
            body = Path(tmp_path).read_bytes()
            try:
                os.unlink(tmp_path)
            except OSError:
                pass
            head = body[:4000].decode("utf-8", "ignore").lower()
            if code in (401, 403, 429, 503) or any(x in head for x in ("just a moment", "cf-browser-verification", "challenge-platform", "access denied")):
                self.stats["blocked"] += 1
                raise FetchError(f"blocked_or_http_{code}", blocked=True, status=code)
            if code >= 400 or code == 0:
                self.stats["error"] += 1
                raise FetchError(f"HTTP {code}")
            self.stats["ok"] += 1
            return body
        except FetchError:
            raise
        except Exception as e:
            self.stats["error"] += 1
            self._last = time.monotonic()
            raise FetchError(str(e))


def get_html(session: Session, url: str) -> str:
    return session.get(url).decode("utf-8", "ignore")


def empty_row(supplier: str, **kw: Any) -> dict:
    row = {k: "" for k in FIELDS}
    row["supplier"] = supplier
    row["scrape_timestamp"] = now_iso()
    for k, v in kw.items():
        if k in row and v is not None:
            row[k] = v
    return row


def apply_gtin(row: dict) -> dict:
    cls = classify_gtin(row.get("gtin"), row.get("mpn"), row.get("packaging"))
    row["gtin"] = cls["gtin"] or ""
    row["gtin_valid"] = "1" if cls["valid"] and not cls["mpn_collision"] else "0"
    row["gtin_reason"] = cls["reason"]
    row["gtin_qty"] = row.get("gtin_qty") or "1"
    row["sales_unit"] = row.get("sales_unit") or "piece"
    return row


def write_csv(path: Path, fields: list[str], rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
        w.writeheader()
        for r in rows:
            w.writerow({k: r.get(k, "") for k in fields})


def read_csv(path: Path) -> list[dict]:
    if not path.exists():
        return []
    with path.open(newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def parse_ld_product(html_text: str) -> dict:
    for m in re.finditer(r'<script[^>]+type=["\']application/ld\+json["\'][^>]*>(.*?)</script>', html_text, re.I | re.S):
        try:
            data = json.loads(m.group(1))
        except json.JSONDecodeError:
            continue
        nodes = data if isinstance(data, list) else [data]
        for node in nodes:
            if isinstance(node, dict) and node.get("@type") == "Product":
                return node
    return {}


def parse_berry(html_text: str, url: str, bucket: str) -> dict:
    row = empty_row("berrybase", product_url=url, sample_bucket=bucket, currency="EUR", price_basis="gross", vat_rate="0.19")
    try:
        p = parse_ld_product(html_text)
        row["name"] = p.get("name") or ""
        row["supplier_sku"] = str(p.get("sku") or "")
        row["mpn"] = str(p.get("mpn") or "")
        brand = p.get("brand")
        row["brand"] = brand.get("name") if isinstance(brand, dict) else (brand or "")
        offers = p.get("offers")
        offer = offers[0] if isinstance(offers, list) and offers else offers
        if isinstance(offer, dict):
            row["price"] = str(offer.get("price") or "")
            row["currency"] = offer.get("priceCurrency") or "EUR"
            avail = str(offer.get("availability") or "")
            row["availability"] = avail.split("/")[-1]
            row["stock"] = "in_stock" if "InStock" in avail else ("out_of_stock" if "OutOfStock" in avail or "SoldOut" in avail else "")
        gtin = p.get("gtin13") or p.get("gtin")
        if gtin:
            row["gtin"] = str(gtin)
        else:
            m = re.search(r'":"(\d{8,14})","productSku"', html_text) or re.search(r'"EAN"\s*:\s*"(\d{8,14})"', html_text, re.I)
            if m:
                row["gtin"] = m.group(1)
        if not row["name"]:
            m = re.search(r"<title>(.*?)</title>", html_text, re.I | re.S)
            if m:
                row["name"] = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", m.group(1))).split("-")[0].strip()
        if re.search(r"multipack|vpe|carton", html_text, re.I):
            row["packaging"] = "possible_multipack_signal"
        imgs = p.get("image")
        if isinstance(imgs, list) and imgs:
            row["image_url"] = imgs[0]
        elif isinstance(imgs, str):
            row["image_url"] = imgs
    except Exception as e:
        row["parse_error"] = str(e)[:200]
    return apply_gtin(row)


def berry_category_urls(html_text: str, base: str = "https://www.berrybase.de") -> list[str]:
    blocked = ("account", "checkout", "wishlist", "agb", "datenschutz", "impressum", "login", "suche", "cart", "newsletter", "widgets")
    out = []
    for href in re.findall(r'href="([^"]+)"', html_text):
        if href.startswith("/"):
            href = urljoin(base, href)
        if not href.startswith(base) or href.endswith("/") or "?" in href:
            continue
        path = href.replace(base, "").strip("/")
        if not path or "/" in path or any(b in path.lower() for b in blocked):
            continue
        out.append(href.split("#")[0])
    return list(dict.fromkeys(out))


def parse_pollin(html_text: str, url: str, bucket: str) -> dict:
    row = empty_row("pollin", product_url=url, sample_bucket=bucket, currency="EUR", price_basis="gross", vat_rate="0.19")
    try:
        m = re.search(r"<title>(.*?)</title>", html_text, re.I | re.S)
        if m:
            row["name"] = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", m.group(1))).split("|")[0].strip()
        p = parse_ld_product(html_text)
        if p:
            row["name"] = p.get("name") or row["name"]
            row["supplier_sku"] = str(p.get("sku") or row["supplier_sku"])
            row["mpn"] = str(p.get("mpn") or "")
            brand = p.get("brand")
            if isinstance(brand, dict):
                row["brand"] = brand.get("name") or ""
            offers = p.get("offers")
            offer = offers[0] if isinstance(offers, list) and offers else offers
            if isinstance(offer, dict):
                row["price"] = str(offer.get("price") or "")
                avail = str(offer.get("availability") or "")
                row["availability"] = avail.split("/")[-1]
                row["stock"] = "in_stock" if "InStock" in avail else ("out_of_stock" if "OutOfStock" in avail else "")
            gtin = p.get("gtin13") or p.get("gtin")
            if gtin:
                row["gtin"] = str(gtin)
        if not row["gtin"]:
            m = re.search(r'class="product-detail-ean"[^>]*>\s*(\d{8,14})', html_text, re.I)
            if m:
                row["gtin"] = m.group(1)
        if not row["supplier_sku"]:
            m = re.search(r"-(\d{5,})(?:\?|$)", url)
            if m:
                row["supplier_sku"] = m.group(1)
        if not row["price"]:
            m = re.search(r'itemprop="price"\s+content="([0-9.]+)"', html_text)
            if m:
                row["price"] = m.group(1)
        if re.search(r"multipack|vpe|Set\s*\d+", html_text, re.I):
            row["packaging"] = "possible_multipack_or_set"
        img = re.search(r'property="og:image"\s+content="([^"]+)"', html_text)
        if img:
            row["image_url"] = img.group(1)
    except Exception as e:
        row["parse_error"] = str(e)[:200]
    return apply_gtin(row)


def scrape_berrybase(session: Session, limit: int) -> tuple[list[dict], dict]:
    meta: dict[str, Any] = {"supplier": "berrybase", "blocked": False, "errors": [], "urls_found": 0, "written": 0}
    cats = [
        "https://www.berrybase.de/raspberry-pi/",
        "https://www.berrybase.de/arduino/",
        "https://www.berrybase.de/bauelemente/aktive-bauelemente/leds/",
        "https://www.berrybase.de/sensoren/",
        "https://www.berrybase.de/netzteile/",
        "https://www.berrybase.de/kabel-stecker/",
        "https://www.berrybase.de/werkzeuge/",
        "https://www.berrybase.de/gehaeuse/",
        "https://www.berrybase.de/displays/",
    ]
    urls: list[str] = []
    for cat in cats:
        try:
            urls.extend(berry_category_urls(get_html(session, cat)))
        except FetchError as e:
            meta["errors"].append(f"{cat}: {e}")
            if e.blocked:
                meta["blocked"] = True
                break
    urls = list(dict.fromkeys(urls))
    meta["urls_found"] = len(urls)
    random.Random(42).shuffle(urls)
    half = limit // 2
    picks = [(u, "commercial") for u in urls[:half]] + [(u, "random") for u in urls[half:limit]]
    rows = []
    for url, bucket in picks:
        try:
            rows.append(parse_berry(get_html(session, url), url, bucket))
        except FetchError as e:
            meta["errors"].append(f"{url}: {e}")
            if e.blocked:
                meta["blocked"] = True
                break
            rows.append(apply_gtin(empty_row("berrybase", product_url=url, sample_bucket=bucket, parse_error=str(e)[:200])))
    meta["written"] = len(rows)
    return rows, meta


def scrape_pollin(session: Session, limit: int) -> tuple[list[dict], dict]:
    meta: dict[str, Any] = {"supplier": "pollin", "blocked": False, "errors": [], "urls_found": 0, "written": 0}
    urls: list[str] = []
    try:
        idx = get_html(session, "https://www.pollin.de/sitemap.xml")
        for loc in re.findall(r"<loc>(.*?)</loc>", idx)[:3]:
            try:
                raw = session.get(loc)
                try:
                    xml = gzip.decompress(raw).decode("utf-8", "ignore")
                except Exception:
                    xml = raw.decode("utf-8", "ignore")
                urls.extend(re.findall(r"<loc>(https://www\.pollin\.de/p/[^<]+)</loc>", xml))
            except FetchError as e:
                meta["errors"].append(str(e))
                if e.blocked:
                    meta["blocked"] = True
                    break
    except FetchError as e:
        meta["errors"].append(str(e))
        meta["blocked"] = e.blocked
    meta["urls_found"] = len(urls)
    kw = ("raspberry", "arduino", "sensor", "esp32", "led", "netzteil", "usb", "kabel", "display")
    commercial = [u for u in urls if any(k in u.lower() for k in kw)]
    others = [u for u in urls if u not in set(commercial)]
    random.Random(7).shuffle(commercial)
    random.Random(8).shuffle(others)
    half = limit // 2
    picks = [(u, "commercial") for u in commercial[:half]]
    picks += [(u, "random") for u in others[: max(0, limit - len(picks))]]
    picks = picks[:limit]
    rows = []
    for url, bucket in picks:
        try:
            rows.append(parse_pollin(get_html(session, url), url, bucket))
        except FetchError as e:
            meta["errors"].append(f"{url}: {e}")
            if e.blocked:
                meta["blocked"] = True
                break
            rows.append(apply_gtin(empty_row("pollin", product_url=url, sample_bucket=bucket, parse_error=str(e)[:200])))
    meta["written"] = len(rows)
    return rows, meta


def scrape_farnell(session: Session, limit: int) -> tuple[list[dict], dict]:
    meta: dict[str, Any] = {
        "supplier": "farnell", "blocked": False, "errors": [], "written": 0,
        "note": "Official element14 Product Search API requires partner API key",
    }
    if not (os.environ.get("FARNELL_API_KEY") or os.environ.get("ELEMENT14_API_KEY")):
        meta["errors"].append("Missing FARNELL_API_KEY / ELEMENT14_API_KEY — no mass scrape")
    try:
        page = get_html(session, "https://ch.farnell.com/")
        if "access denied" in page[:3000].lower():
            meta["blocked"] = True
            meta["errors"].append("ch.farnell.com access denied for automated client")
    except FetchError as e:
        meta["blocked"] = True
        meta["errors"].append(str(e))
    return [], meta


def scrape_buerklin(session: Session, limit: int) -> tuple[list[dict], dict]:
    meta: dict[str, Any] = {"supplier": "buerklin", "blocked": False, "errors": [], "written": 0}
    try:
        page = get_html(session, "https://www.buerklin.com/")
        if "just a moment" in page[:4000].lower() or "challenge" in page[:4000].lower():
            meta["blocked"] = True
            meta["errors"].append("Cloudflare challenge — stopped (no CAPTCHA bypass)")
        else:
            meta["errors"].append("Homepage unexpectedly open; product crawl skipped")
    except FetchError as e:
        meta["blocked"] = True
        meta["errors"].append(str(e))
    return [], meta


def scrape_exlibris(session: Session, limit: int, *, catalog: str = "spiele") -> tuple[list[dict], dict]:
    from lib.scrape_exlibris_runner import ExlibrisScraper

    meta: dict[str, Any] = {
        "supplier": "exlibris",
        "catalog": catalog,
        "blocked": False,
        "errors": [],
        "written": 0,
    }

    def fetch(url: str) -> str:
        return get_html(session, url)

    try:
        scraper = ExlibrisScraper(
            fetch,
            catalog=catalog,
            delay_s=0,
            checkpoint_path=None,
            resume=False,
        )
        result = scraper.run(
            limit=limit,
            max_pages_per_category=max(3, limit // 24 + 1) if limit > 0 else 0,
        )
        rows = [apply_gtin(r) for r in result.rows[:limit]]
        meta.update(result.meta)
        meta["written"] = len(rows)
        if result.meta.get("blocked"):
            meta["blocked"] = True
        if result.meta.get("errors"):
            meta["errors"].extend(result.meta["errors"])
    except FetchError as e:
        meta["blocked"] = e.blocked
        meta["errors"].append(str(e))
        rows = []
    except Exception as e:
        meta["errors"].append(str(e))
        rows = []
    return rows, meta


def load_index(path: Path) -> dict[str, dict]:
    idx: dict[str, dict] = {}
    for row in read_csv(path):
        g = normalize_gtin(row.get("gtin"))
        if not g:
            continue
        prev = idx.get(g)
        if prev and prev.get("source") == "order_history" and row.get("source") != "order_history":
            continue
        idx[g] = row
    return idx


def match_all(index: dict[str, dict], samples: dict[str, list[dict]]) -> list[dict]:
    out = []
    for supplier, rows in samples.items():
        for p in rows:
            cls = classify_gtin(p.get("gtin"), p.get("mpn"), p.get("packaging"))
            rec = {
                "supplier": supplier,
                "supplier_sku": p.get("supplier_sku", ""),
                "product_url": p.get("product_url", ""),
                "name": p.get("name", ""),
                "brand": p.get("brand", ""),
                "mpn": p.get("mpn", ""),
                "gtin": cls["gtin"] or "",
                "gtin_valid": "1" if cls["valid"] and not cls["mpn_collision"] else "0",
                "gtin_reason": cls["reason"],
                "packaging": p.get("packaging", ""),
                "price": p.get("price", ""),
                "currency": p.get("currency", ""),
                "stock": p.get("stock", ""),
                "match_status": "",
                "galaxus_source": "",
                "galaxus_title": "",
                "galaxus_brand": "",
                "galaxus_sell_price_chf": "",
                "units_sold": "",
                "revenue_chf": "",
                "last_sale": "",
                "our_offer": "",
                "notes": "",
            }
            if not cls["valid"] or cls["mpn_collision"]:
                rec["match_status"] = "invalid_gtin"
                rec["notes"] = cls["reason"]
                out.append(rec)
                continue
            hit = index.get(cls["gtin"] or "")
            if not hit:
                rec["match_status"] = "absent"
                rec["notes"] = "GTIN not in project index (electronics Galaxus catalog not imported)"
                out.append(rec)
                continue
            rec.update({
                "galaxus_source": hit.get("source", ""),
                "galaxus_title": hit.get("title", ""),
                "galaxus_brand": hit.get("brand", ""),
                "galaxus_sell_price_chf": hit.get("sell_price_chf", ""),
                "units_sold": hit.get("units_sold", ""),
                "revenue_chf": hit.get("revenue_chf", ""),
                "last_sale": hit.get("last_sale", ""),
                "our_offer": hit.get("our_offer", ""),
            })
            sb = (p.get("brand") or "").lower()
            gb = (hit.get("brand") or "").lower()
            if sb and gb and sb not in gb and gb not in sb:
                rec["match_status"] = "ambiguous"
                rec["notes"] = "GTIN hit but brand mismatch"
            elif cls["packaging_risk"]:
                rec["match_status"] = "ambiguous"
                rec["notes"] = "packaging risk"
            else:
                rec["match_status"] = "exact"
                rec["notes"] = "exact GTIN in project index; retail sell price often missing"
            out.append(rec)
    return out


def logistics(supplier: str) -> dict:
    return {
        "farnell": {"ch": "import_predictable", "freight": None, "notes": "CH site; freight unconfirmed without account/API"},
        "buerklin": {"ch": "import_unknown", "freight": None, "notes": "Cloudflare blocked; logistics unknown"},
        "berrybase": {"ch": "import_unknown", "freight": None, "notes": "DE EUR; CH shipping unconfirmed"},
        "pollin": {"ch": "import_predictable", "freight": round(19.90 * EURCHF, 4), "notes": "CH freight 19.90 EUR public; customs unknown (not DDP)"},
    }[supplier]


def profit_one(supplier: str, price: Optional[float], currency: str, sell: Optional[float]) -> dict:
    log = logistics(supplier)
    out = {
        "freight_chf": "", "landed_cost_chf": "", "estimated_profit_chf": "", "margin_pct": "",
        "roi_on_purchase_pct": "", "above_threshold": False, "profit_status": "", "status_label": "",
        "ch_delivery": log["ch"], "notes": log["notes"],
    }
    if price is None or price <= 0:
        out["profit_status"] = "NO_PRICE"; out["status_label"] = "MANUAL_REVIEW"; return out
    if sell is None or sell <= 0:
        out["profit_status"] = "NO_GALAXUS_PRICE"; out["status_label"] = "MANUAL_REVIEW"; return out
    if currency.upper() == "CHF":
        price_chf = price
    elif currency.upper() == "EUR":
        price_chf = price * EURCHF
    else:
        out["profit_status"] = "FX_UNKNOWN"; out["status_label"] = "MANUAL_REVIEW"; return out
    freight = log["freight"]
    if freight is None or log["ch"] in ("import_unknown", "no_ch_delivery"):
        out["profit_status"] = "NO_CH_DELIVERY" if log["ch"] == "no_ch_delivery" else "SHIPPING_UNCONFIRMED"
        out["status_label"] = "NOT_VIABLE" if out["profit_status"] == "NO_CH_DELIVERY" else "SHIPPING_UNCONFIRMED"
        return out
    out["freight_chf"] = freight
    if log["ch"] == "import_predictable":
        out["profit_status"] = "CUSTOMS_UNCONFIRMED"; out["status_label"] = "SHIPPING_UNCONFIRMED"; return out
    landed = price_chf + freight
    sav = sell * 0.02
    profit = sell - landed - sav
    margin = profit / sell
    out["landed_cost_chf"] = round(landed, 4)
    out["estimated_profit_chf"] = round(profit, 4)
    out["margin_pct"] = round(margin, 4)
    out["roi_on_purchase_pct"] = round(profit / price_chf, 4)
    out["above_threshold"] = margin >= TARGET_MARGIN
    out["profit_status"] = "OK" if out["above_threshold"] else "BELOW_MARGIN"
    out["status_label"] = "VIABLE_NOW" if out["above_threshold"] else "INSUFFICIENT_MARGIN"
    return out


def metrics(rows: list[dict]) -> dict:
    n = len(rows)
    valid = sum(1 for r in rows if r.get("gtin_valid") == "1")
    gtins = [r.get("gtin") for r in rows if r.get("gtin")]
    return {
        "tested": n,
        "with_gtin": len(gtins),
        "valid_gtin": valid,
        "pct_valid_gtin": round(100 * valid / n, 1) if n else 0.0,
        "pct_mpn": round(100 * sum(1 for r in rows if r.get("mpn")) / n, 1) if n else 0.0,
        "pct_price": round(100 * sum(1 for r in rows if r.get("price")) / n, 1) if n else 0.0,
        "pct_stock": round(100 * sum(1 for r in rows if r.get("stock") or r.get("availability")) / n, 1) if n else 0.0,
        "duplicate_gtins": len(gtins) - len(set(gtins)),
        "parse_errors": sum(1 for r in rows if r.get("parse_error")),
    }


def score_supplier(m: dict, exact: int, valid_tested: int, viable: int, ch: str, auto_score: int) -> tuple[int, str]:
    gtin_s = min(25, int((m.get("pct_valid_gtin") or 0) / 100 * 25))
    rate = (100 * exact / valid_tested) if valid_tested else 0
    ov_s = min(25, int(rate / 100 * 25))
    margin_s = 20 if viable > 0 else (8 if exact > 0 and ch == "import_predictable" else 0)
    log_s = {"ddp_known": 15, "import_predictable": 10, "import_unknown": 3, "no_ch_delivery": 0}.get(ch, 0)
    total = gtin_s + ov_s + margin_s + log_s + auto_score
    if m.get("tested", 0) == 0:
        verdict = "NO-GO"
    elif viable > 0 and total >= 80:
        verdict = "GO — full integration"
    elif total >= 65:
        verdict = "GO LIMITED — selected categories"
    elif ch == "import_predictable" and m.get("valid_gtin", 0) > 50:
        verdict = "TEST ORDER REQUIRED"
    elif exact == 0:
        verdict = "NO-GO" if ch != "import_predictable" else "TEST ORDER REQUIRED"
    else:
        verdict = "TEST ORDER REQUIRED"
    return total, verdict


def write_report(path: Path, ctx: dict) -> None:
    lines = [
        "# Supplier viability report — Galaxus CH electronics POC",
        "",
        f"Generated: {now_iso()} (Europe/Zurich)",
        "",
        "## Scope & constraints",
        "",
        "- Read-only POC. No offers published. No production writes.",
        "- Project Galaxus data is overwhelmingly sneakers/apparel — not a Digitec electronics catalog.",
        "- Overlap uses exported SupplierVariant + GalaxusOrderLine GTINs.",
        "- Pricing defaults from `galaxus/exports/pricing.ts`: target net margin **12%**, EURCHF **0.94**.",
        "- Galaxus B2B path in this repo: no Mirakl commission on line net.",
        "- Unknown freight/customs ⇒ not profitable (never default shipping to 0).",
        "",
        "## Comparative table",
        "",
        "| Fournisseur | Produits testés | GTIN valides | Overlap Galaxus | Produits rentables | CA historique matché | Logistique CH | Automatisation | Verdict |",
        "|---|---:|---:|---:|---:|---:|---|---|---|",
    ]
    for s in SUPPLIERS:
        r = ctx["suppliers"][s]
        lines.append(
            f"| {s} | {r['tested']} | {r['valid_gtin']} | {r['exact_overlap']} ({r['overlap_rate']}%) | {r['profitable']} | CHF {r['revenue_matched']} | {r['logistics']} | {r['automation']} | {r['verdict']} |"
        )
    lines += ["", "## Scores (/100)", ""]
    for s, r in ctx["suppliers"].items():
        lines.append(f"- **{s}**: {r['score']}/100 — {r['verdict']}")
    lines += ["", "## Per-supplier notes", ""]
    for s, r in ctx["suppliers"].items():
        lines.append(f"### {s}")
        lines.append("")
        for note in r.get("notes", []):
            lines.append(f"- {note}")
        lines.append("")
    lines += ["## Q1–Q12", ""]
    for q, a in ctx["answers"].items():
        lines.append(f"**{q}** {a}")
        lines.append("")
    lines += ["## Ranking", ""]
    for i, (s, score) in enumerate(ctx["ranking"], 1):
        lines.append(f"{i}. {s} ({score}/100) — {ctx['suppliers'][s]['verdict']}")
    lines += ["", "## Next concrete action", "", ctx["next_action"], ""]
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines), encoding="utf-8")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--supplier", choices=[*SUPPLIERS, "all"], default="all")
    ap.add_argument("--limit", type=int, default=TARGET)
    ap.add_argument("--skip-scrape", action="store_true")
    args = ap.parse_args()
    DATA.mkdir(exist_ok=True)
    REPORTS.mkdir(exist_ok=True)

    scrapers = {
        "berrybase": scrape_berrybase,
        "pollin": scrape_pollin,
        "farnell": scrape_farnell,
        "buerklin": scrape_buerklin,
    }
    selected = list(scrapers) if args.supplier == "all" else [args.supplier]
    samples: dict[str, list[dict]] = {}
    metas: list[dict] = []
    session = Session(1.0)

    if not args.skip_scrape:
        for name in selected:
            print(f"=== scrape {name} ===", flush=True)
            rows, meta = scrapers[name](session, args.limit)
            write_csv(DATA / f"{name}_sample.csv", FIELDS, rows)
            samples[name] = rows
            metas.append(meta)
            print(meta, flush=True)
        (DATA / "scrape_meta.json").write_text(json.dumps(metas, indent=2, ensure_ascii=False))
    else:
        for name in SUPPLIERS:
            samples[name] = read_csv(DATA / f"{name}_sample.csv")

    for name in SUPPLIERS:
        path = DATA / f"{name}_sample.csv"
        if not path.exists():
            write_csv(path, FIELDS, [])
            samples.setdefault(name, [])
        else:
            samples.setdefault(name, read_csv(path))

    index = load_index(DATA / "galaxus_gtin_index.csv")
    overlap = match_all(index, samples)
    overlap_fields = [
        "supplier", "supplier_sku", "product_url", "name", "brand", "mpn", "gtin", "gtin_valid", "gtin_reason",
        "packaging", "price", "currency", "stock", "match_status", "galaxus_source", "galaxus_title",
        "galaxus_brand", "galaxus_sell_price_chf", "units_sold", "revenue_chf", "last_sale", "our_offer", "notes",
    ]
    write_csv(DATA / "galaxus_overlap.csv", overlap_fields, overlap)

    profit_rows = []
    for o in overlap:
        try:
            price = float(o["price"]) if o.get("price") else None
        except ValueError:
            price = None
        try:
            sell = float(o["galaxus_sell_price_chf"]) if o.get("galaxus_sell_price_chf") else None
        except ValueError:
            sell = None
        for scenario in ("individual", "batch_300", "batch_1000"):
            pr = profit_one(o["supplier"], price, o.get("currency") or "EUR", sell)
            label = pr["status_label"]
            if o["match_status"] == "invalid_gtin":
                label = "INVALID_GTIN"
            elif o["match_status"] == "absent":
                label = "NO_GALAXUS_MATCH"
            elif o["match_status"] == "ambiguous":
                label = "MANUAL_REVIEW"
            profit_rows.append({
                "supplier": o["supplier"], "gtin": o["gtin"], "name": o["name"], "match_status": o["match_status"],
                "supplier_price": o.get("price", ""), "currency": o.get("currency", ""),
                "galaxus_sell_price_chf": o.get("galaxus_sell_price_chf", ""),
                "units_sold": o.get("units_sold", ""), "revenue_chf": o.get("revenue_chf", ""),
                "scenario": scenario, "freight_chf": pr["freight_chf"], "landed_cost_chf": pr["landed_cost_chf"],
                "estimated_profit_chf": pr["estimated_profit_chf"], "margin_pct": pr["margin_pct"],
                "roi_on_purchase_pct": pr["roi_on_purchase_pct"], "above_threshold": pr["above_threshold"],
                "profit_status": pr["profit_status"], "status_label": label,
                "ch_delivery": pr["ch_delivery"], "notes": pr["notes"],
            })
    pfields = list(profit_rows[0].keys()) if profit_rows else ["supplier", "gtin", "status_label"]
    write_csv(DATA / "profitability_detail.csv", pfields, profit_rows)
    viable = [r for r in profit_rows if r["scenario"] == "individual" and r["status_label"] == "VIABLE_NOW"]
    write_csv(DATA / "viable_products.csv", pfields, viable)

    automation = {
        "farnell": {"score": 12, "text": "Official API (key required); order API via account"},
        "buerklin": {"score": 2, "text": "Blocked automation; unknown API"},
        "berrybase": {"score": 8, "text": "Shopware HTML/JSON-LD scrapeable; no public order API found"},
        "pollin": {"score": 9, "text": "Sitemap + JSON-LD; CH freight public; no public order API found"},
    }
    suppliers_ctx = {}
    for s in SUPPLIERS:
        rows = samples.get(s) or []
        m = metrics(rows)
        ov_rows = [o for o in overlap if o["supplier"] == s]
        exact = sum(1 for o in ov_rows if o["match_status"] == "exact")
        valid_tested = sum(1 for o in ov_rows if o["gtin_valid"] == "1")
        revenue = 0.0
        for o in ov_rows:
            if o["match_status"] == "exact":
                try:
                    revenue += float(o.get("revenue_chf") or 0)
                except ValueError:
                    pass
        profitable = sum(1 for r in profit_rows if r["supplier"] == s and r["scenario"] == "individual" and r["status_label"] == "VIABLE_NOW")
        log = logistics(s)
        score, verdict = score_supplier(m, exact, valid_tested, profitable, log["ch"], automation[s]["score"])
        scrape_meta = next((x for x in metas if x.get("supplier") == s), {})
        notes = []
        if scrape_meta.get("blocked"):
            notes.append(f"Scrape blocked: {scrape_meta.get('errors', [])[:2]}")
        if m["tested"] < TARGET:
            notes.append(f"Sample size {m['tested']} < {TARGET}")
        notes.append(log["notes"])
        notes.append(automation[s]["text"])
        notes.append(f"GTIN valid {m['valid_gtin']}/{m['tested']} ({m['pct_valid_gtin']}%)")
        notes.append(f"Exact Galaxus overlaps: {exact}; viable_now: {profitable}")
        suppliers_ctx[s] = {
            **m, "exact_overlap": exact,
            "overlap_rate": round(100 * exact / valid_tested, 1) if valid_tested else 0.0,
            "profitable": profitable, "revenue_matched": round(revenue, 2),
            "logistics": log["ch"], "automation": automation[s]["text"],
            "score": score, "verdict": verdict, "notes": notes, "viable_now": profitable,
        }

    ranking = sorted(((s, suppliers_ctx[s]["score"]) for s in suppliers_ctx), key=lambda x: -x[1])
    best_gtin = max(suppliers_ctx.items(), key=lambda kv: kv[1]["pct_valid_gtin"])[0]
    best_overlap = max(suppliers_ctx.items(), key=lambda kv: kv[1]["exact_overlap"])[0]
    best_rev = max(suppliers_ctx.items(), key=lambda kv: kv[1]["revenue_matched"])[0]
    best_margin = max(suppliers_ctx.items(), key=lambda kv: kv[1]["profitable"])[0]
    total_viable = sum(v["viable_now"] for v in suppliers_ctx.values())
    answers = {
        "Q1 Most exploitable GTINs?": f"{best_gtin} (highest valid-GTIN rate among sampled).",
        "Q2 Biggest Galaxus overlap?": (
            "None — 0 exact matches for all 4. Project Galaxus GTIN index is footwear/apparel, not Digitec electronics."
            if all(suppliers_ctx[s]["exact_overlap"] == 0 for s in SUPPLIERS)
            else f"{best_overlap} ({suppliers_ctx[best_overlap]['exact_overlap']} exact)."
        ),
        "Q3 Most historically sold matches?": (
            "None — CHF 0 matched historical revenue (no GTIN hits in GalaxusOrderLine)."
            if all(suppliers_ctx[s]["revenue_matched"] == 0 for s in SUPPLIERS)
            else f"{best_rev} (CHF {suppliers_ctx[best_rev]['revenue_matched']} matched revenue)."
        ),
        "Q4 Most products with sufficient margin?": (
            "None — 0 VIABLE_NOW (need sell prices + confirmed CH landed costs)."
            if total_viable == 0
            else f"{best_margin} with {suppliers_ctx[best_margin]['profitable']} VIABLE_NOW."
        ),
        "Q5 Median margin per supplier?": "Not computable — Galaxus sell prices and/or customs missing ⇒ SHIPPING_UNCONFIRMED / NO_GALAXUS_PRICE.",
        "Q6 Best CH logistics?": "Pollin (public CH freight 19.90 EUR). Still not DDP. Farnell CH storefront but freight unconfirmed. BerryBase/Bürklin unconfirmed/blocked.",
        "Q7 Pollin import predictability?": "Freight predictable (flat CH). Import VAT/duties via Swiss TARES — not DDP; clearance fees unknown ⇒ CUSTOMS_UNCONFIRMED.",
        "Q8 Integrate first?": "Pollin (highest score) only after electronics sell catalog + DDP/customs quantified; else none VIABLE_NOW. Alternate: Farnell via official API if partner key obtained.",
        "Q9 Prioritize which categories?": "Maker/SBC accessories (Raspberry Pi ecosystem, sensors, PSU, cables) once electronics catalog association exists.",
        "Q10 How many VIABLE_NOW publishable?": f"{total_viable}",
        "Q11 Historical CA covered by matches?": f"CHF {round(sum(v['revenue_matched'] for v in suppliers_ctx.values()), 2)} across exact GTIN hits in project sales history.",
        "Q12 Next concrete action?": "1) Import Digitec/Galaxus electronics GTIN sell catalog. 2) Register Farnell element14 API key. 3) Place 1 Pollin CH test order for real landed cost. 4) Re-run POC with 300/supplier outside sandbox.",
    }
    ctx = {"suppliers": suppliers_ctx, "answers": answers, "ranking": ranking, "next_action": answers["Q12 Next concrete action?"]}
    write_report(REPORTS / "supplier_viability_report.md", ctx)

    print("\n=== DECISION SUMMARY ===")
    for i, (s, score) in enumerate(ranking, 1):
        r = suppliers_ctx[s]
        print(f"{i}. {s}: {score}/100 — {r['verdict']} | tested={r['tested']} valid_gtin={r['valid_gtin']} overlap={r['exact_overlap']} viable_now={r['viable_now']}")
    print(f"VIABLE_NOW total: {total_viable}")
    print(f"Report: {REPORTS / 'supplier_viability_report.md'}")
    print(f"HTTP stats: {dict(session.stats)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
