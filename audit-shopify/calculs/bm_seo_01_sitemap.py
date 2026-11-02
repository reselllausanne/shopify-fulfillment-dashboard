#!/usr/bin/env python3
"""bm_seo_01 : lecture seule du sitemap public resell-lausanne.ch.
Télécharge sitemap.xml + enfants (GET public), compte les URLs par type/langue,
extrait les alternates hreflang et lastmod. Sorties : donnees_brutes/seo/*.xml,
tableaux/bm_seo_sitemap_urls.csv, tableaux/bm_seo_sitemap_summary.csv
Usage : audit-shopify/.venv/bin/python audit-shopify/calculs/bm_seo_01_sitemap.py
"""
import csv, os, re, sys, time, urllib.request, urllib.error, collections
import xml.etree.ElementTree as ET

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
RAW = os.path.join(ROOT, "donnees_brutes", "seo")
TAB = os.path.join(ROOT, "tableaux")
os.makedirs(RAW, exist_ok=True)
BASE = "https://www.resell-lausanne.ch"
UA = "Mozilla/5.0 (compatible; ResellAudit/1.0; read-only)"
NS = {"s": "http://www.sitemaps.org/schemas/sitemap/0.9", "x": "http://www.w3.org/1999/xhtml",
      "i": "http://www.google.com/schemas/sitemap-image/1.1"}


def get(url, tries=6):
    """GET poli : retry/backoff sur 429."""
    for k in range(tries):
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        try:
            with urllib.request.urlopen(req, timeout=40) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code == 429 and k < tries - 1:
                time.sleep(5 * (k + 1))
                continue
            raise


def main():
    ipath = os.path.join(RAW, "sitemap_index.xml")
    if os.path.exists(ipath):
        idx = open(ipath, "rb").read()
    else:
        idx = get(BASE + "/sitemap.xml")
        open(ipath, "wb").write(idx)
    root = ET.fromstring(idx)
    children = [e.find("s:loc", NS).text.replace("&amp;", "&") for e in root.findall("s:sitemap", NS)]
    print("children:", len(children))
    rows = []
    for n, u in enumerate(children):
        fn = re.sub(r"[^a-zA-Z0-9_]+", "_", u.split("/")[-1])[:60]
        path = os.path.join(RAW, f"child_{n:03d}_{fn}.xml")
        # échantillonnage poli : langues non défaut -> produits seulement 1/3 fichiers (début, milieu, fin)
        m = re.search(r"resell-lausanne\.ch/(de|en)/sitemap_products_(\d+)\.xml", u)
        if m and int(m.group(2)) not in (1, 50, 99):
            continue
        if os.path.exists(path):
            data = open(path, "rb").read()
        else:
            if os.environ.get("OFFLINE"):
                continue
            try:
                data = get(u)
            except Exception as e:
                print("ERR", u, e, flush=True)
                continue
            open(path, "wb").write(data)
            time.sleep(0.8)
        t = ET.fromstring(data)
        for e in t.findall("s:url", NS):
            loc = e.find("s:loc", NS).text
            lm = e.find("s:lastmod", NS)
            alts = [(a.get("hreflang"), a.get("href")) for a in e.findall("x:link", NS)]
            imgs = len(e.findall("i:image", NS))
            rows.append({"child": u.split("/")[-1].split("?")[0], "loc": loc,
                         "lastmod": lm.text if lm is not None else "", "n_alt": len(alts),
                         "alts": "|".join(f"{a}={b}" for a, b in alts), "n_img": imgs})
    with open(os.path.join(TAB, "bm_seo_sitemap_urls.csv"), "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)

    def kind(loc):
        p = loc.replace(BASE, "")
        lang = "fr(default)"
        m = re.match(r"^/(de|en|fr|it|es|nl)(-[a-z]{2})?/", p)
        if m:
            lang = m.group(1) + (m.group(2) or "")
            p = p[len(m.group(0)) - 1:]
        k = "other"
        for key in ("products", "collections", "pages", "blogs"):
            if p.startswith("/" + key + "/") or p == "/" + key:
                k = key
        if p in ("", "/"):
            k = "home"
        return lang, k

    cnt = collections.Counter()
    child_cnt = collections.Counter()
    for r in rows:
        cnt[kind(r["loc"])] += 1
        child_cnt[re.sub(r"_\d+", "_N", r["child"])] += 1
    with open(os.path.join(TAB, "bm_seo_sitemap_summary.csv"), "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["langue_prefixe", "type", "nb_urls"])
        for (lang, k), v in sorted(cnt.items()):
            w.writerow([lang, k, v])
    print("total URLs", len(rows))
    for k, v in sorted(cnt.items()):
        print(k, v)
    print(child_cnt)
    alt_rows = sum(1 for r in rows if r["n_alt"] > 0)
    print("urls with xhtml alternates:", alt_rows)
    lm = sorted(r["lastmod"][:10] for r in rows if r["lastmod"])
    print("lastmod min/max", lm[0] if lm else None, lm[-1] if lm else None)


if __name__ == "__main__":
    main()
