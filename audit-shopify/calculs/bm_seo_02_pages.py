#!/usr/bin/env python3
"""bm_seo_02 : audit technique léger (GET publics, lecture seule, délai >= 2 s) d'un échantillon de pages.
Sortie : tableaux/bm_seo_pages_sample.csv + donnees_brutes/seo/pages/*.html (non versionné).
Usage : audit-shopify/.venv/bin/python audit-shopify/calculs/bm_seo_02_pages.py
"""
import csv, json, os, random, re, time, urllib.request, urllib.error
import xml.etree.ElementTree as ET

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
RAW = os.path.join(ROOT, "donnees_brutes", "seo")
PG = os.path.join(RAW, "pages")
os.makedirs(PG, exist_ok=True)
BASE = "https://www.resell-lausanne.ch"
UA = "Mozilla/5.0 (compatible; ResellAudit/1.0; read-only)"
NS = {"s": "http://www.sitemaps.org/schemas/sitemap/0.9"}
random.seed(20261102)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k):
        return None


def fetch(url, follow=True, tries=5):
    opener = urllib.request.build_opener() if follow else urllib.request.build_opener(NoRedirect)
    for k in range(tries):
        t0 = time.time()
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "fr-CH,fr;q=0.9"})
            with opener.open(req, timeout=40) as r:
                body = r.read()
                return r.status, r.geturl(), dict(r.headers), body, time.time() - t0
        except urllib.error.HTTPError as e:
            if e.code == 429 and k < tries - 1:
                time.sleep(8 * (k + 1))
                continue
            return e.code, url, dict(e.headers or {}), (e.read() if hasattr(e, "read") else b""), time.time() - t0
        except Exception as e:
            return 0, url, {"error": str(e)}, b"", time.time() - t0
    return 429, url, {}, b"", 0


def sample_urls():
    prods, colls = [], []
    for fn in sorted(os.listdir(RAW)):
        if not fn.startswith("child_"):
            continue
        t = ET.parse(os.path.join(RAW, fn)).getroot()
        for e in t.findall("s:url", NS):
            loc = e.find("s:loc", NS).text
            lm = e.find("s:lastmod", NS)
            row = (loc, lm.text if lm is not None else "")
            if "/products/" in loc and loc.startswith(BASE + "/products/"):
                prods.append(row)
            elif "/collections/" in loc and loc.startswith(BASE + "/collections/"):
                colls.append(row)
    return random.sample(prods, 14), random.sample(colls, 8)


def analyse(url, label):
    st, final, h, body, dt = fetch(url)
    html = body.decode("utf-8", "ignore")
    safe = re.sub(r"[^a-zA-Z0-9]+", "_", url.replace(BASE, ""))[:80] or "home"
    open(os.path.join(PG, safe + ".html"), "w").write(html)
    title = re.search(r"<title>\s*(.*?)\s*</title>", html, re.S)
    desc = re.search(r'<meta name="description" content="(.*?)"', html, re.S)
    canon = re.search(r'<link rel="canonical" href="(.*?)"', html)
    robots = re.search(r'<meta name="robots" content="(.*?)"', html)
    hreflangs = re.findall(r'<link rel="alternate" hreflang="(.*?)" href="(.*?)"', html)
    h1 = re.findall(r"<h1[^>]*>(.*?)</h1>", html, re.S)
    ld = re.findall(r'<script type="application/ld\+json"[^>]*>(.*?)</script>', html, re.S)
    types, prod = [], {}
    for blob in ld:
        try:
            j = json.loads(blob)
        except Exception:
            continue
        for node in (j if isinstance(j, list) else [j]):
            if not isinstance(node, dict):
                continue
            tt = node.get("@type")
            types.append(tt if isinstance(tt, str) else str(tt))
            if tt == "Product":
                offers = node.get("offers")
                offers = offers if isinstance(offers, list) else [offers] if offers else []
                prod = {
                    "has_gtin": any(k in node for k in ("gtin", "gtin13", "gtin12", "gtin14", "gtin8")),
                    "has_mpn": "mpn" in node, "brand": (node.get("brand") or {}).get("name") if isinstance(node.get("brand"), dict) else node.get("brand"),
                    "n_offers": len(offers),
                    "availability": sorted({str(o.get("availability", "")).split("/")[-1] for o in offers if isinstance(o, dict)}),
                    "has_rating": "aggregateRating" in node,
                    "has_shippingDetails": any("shippingDetails" in o for o in offers if isinstance(o, dict)),
                    "has_return": any("hasMerchantReturnPolicy" in o for o in offers if isinstance(o, dict)),
                    "price": offers[0].get("price") if offers and isinstance(offers[0], dict) else None,
                    "currency": offers[0].get("priceCurrency") if offers and isinstance(offers[0], dict) else None,
                }
    imgs = re.findall(r"<img ", html)
    return {
        "label": label, "url": url, "status": st, "final_url": final if final != url else "", "ttfb_total_s": round(dt, 2),
        "html_kb": round(len(body) / 1024), "content_language": h.get("content-language", h.get("Content-Language", "")),
        "title": (title.group(1) if title else "")[:120], "title_len": len(title.group(1)) if title else 0,
        "desc_len": len(desc.group(1)) if desc else 0, "canonical": canon.group(1) if canon else "",
        "canonical_is_self": (canon.group(1).rstrip("/") == url.split("?")[0].rstrip("/")) if canon else "",
        "robots_meta": robots.group(1) if robots else "", "n_hreflang": len(hreflangs),
        "hreflang": ";".join(f"{a}={b.replace(BASE,'')}" for a, b in hreflangs)[:300], "n_h1": len(h1),
        "jsonld_types": ",".join(types), "product_ld": json.dumps(prod, ensure_ascii=False) if prod else "",
        "n_img_tags": len(imgs), "x_robots_tag": h.get("x-robots-tag", ""),
    }


def main():
    prods, colls = sample_urls()
    targets = [("home_fr", BASE + "/"), ("home_de", BASE + "/de"), ("home_en", BASE + "/en"), ("home_it", BASE + "/it")]
    targets += [("policy_retour", BASE + "/pages/politique-de-retour"), ("page_concept", BASE + "/pages/notre-concept"),
                ("legacy_/Sneakers/Nike", BASE + "/Sneakers/Nike"), ("search", BASE + "/search?q=jordan+4"),
                ("coll_param_sort", BASE + "/collections/fear-of-god-essentials?sort_by=price-ascending"),
                ("coll_filter", BASE + "/collections/fear-of-god-essentials?filter.v.availability=1"),
                ("coll_page2", BASE + "/collections/fear-of-god-essentials?page=2"),
                ("coll_de", BASE + "/de/collections/fear-of-god-essentials"), ("coll_en", BASE + "/en/collections/fear-of-god-essentials"),
                ("404_test", BASE + "/products/zz-url-inexistante-audit-2026"),
                ("collections_all", BASE + "/collections/all"), ("collections_index", BASE + "/collections")]
    targets += [(f"coll_sample", u) for u, _ in colls]
    targets += [(f"prod_sample(lastmod {lm[:10]})", u) for u, lm in prods]
    rows = []
    for lab, u in targets:
        rows.append(analyse(u, lab))
        print(lab, rows[-1]["status"], rows[-1]["ttfb_total_s"], flush=True)
        time.sleep(2.5)
    # redirections domaines / protocoles (sans suivre)
    for u in ["http://www.resell-lausanne.ch/", "https://resell-lausanne.ch/", "https://resell-lausanne.com/", "https://www.resell-lausanne.com/"]:
        st, final, h, body, dt = fetch(u, follow=False)
        rows.append({"label": "redirect_test", "url": u, "status": st, "final_url": h.get("Location", h.get("location", "")), "ttfb_total_s": round(dt, 2)})
        time.sleep(2.5)
    keys = []
    for r in rows:
        for k in r:
            if k not in keys:
                keys.append(k)
    with open(os.path.join(ROOT, "tableaux", "bm_seo_pages_sample.csv"), "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=keys)
        w.writeheader()
        w.writerows(rows)


if __name__ == "__main__":
    main()
