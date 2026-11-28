#!/usr/bin/env python3
"""insta-reel: read ONE public Instagram post/reel (read-only, no login) and print what it contains.

Usage:
  insta_reel.py <url> [--text] [--engine camoufox|patchright] [--max-mb 6] [--log PATH]
  insta_reel.py --from-html page.html <url>      (offline parse of a saved page, no browser)

Extracts: account, caption, hashtags, @mentions, date, likes/comments counts, music, tagged accounts,
Instagram auto alt-text, visible page text, top visible comments, external links (product/shop links split
from the rest) and brand candidates. Layers, best first: embedded page JSON > og:meta > visible text.
It does NOT transcribe audio or analyse video frames: "understanding" = text Instagram exposes.

Read-only: no login, no cookie, no like/follow/comment, no download of media (images/video/fonts/css
blocked). Anti-bot/login wall => reported as is (login_wall=true, whatever og:meta gave), never retried
aggressively (<= 3 attempts on errors only, none on 403/429).

Browser: one headless Camoufox (or Patchright) owned by this process, closed at exit. Never the Mac's
Google Chrome. Optional residential proxy via env JARVIS_PROXY_URL (never logged). Per-page byte cap
(--max-mb / JARVIS_MAX_PAGE_MB). Visit log JSONL (no content): JARVIS_WEB_LOG, default
~/.local/share/jarvis-resell/web-visits.jsonl.

Exit codes: 0 ok | 1 error | 2 usage | 3 blocked (nothing useful extracted).
Deps: docs/jarvis/bin/requirements-browser.txt (+ `python -m camoufox fetch`). Unit tests: stdlib only.
"""
import argparse
import datetime
import json
import os
import re
import sys
import urllib.parse

import jarvis_web as jw

EXIT_OK, EXIT_ERR, EXIT_USAGE, EXIT_BLOCKED = 0, 1, 2, 3
IG_HOSTS = {"instagram.com", "www.instagram.com", "m.instagram.com", "instagr.am"}
PATH_RE = re.compile(r"^/(?:[A-Za-z0-9_.]+/)?(p|reel|reels|tv)/([A-Za-z0-9_-]{5,20})/?$")
DEFAULT_MAX_MB = 6.0  # Instagram's JS bundles are ~3-4 MB with images/css blocked

LINK_HUBS = {"linktr.ee", "beacons.ai", "bio.link", "linkin.bio", "lnk.bio", "taplink.cc", "stan.store", "carrd.co",
             "solo.to", "campsite.bio"}
SHOP_DOMAINS = {"nike.com", "adidas.com", "adidas.ch", "newbalance.com", "asics.com", "puma.com", "stockx.com", "goat.com",
                "flightclub.com", "amazon.com", "amazon.fr", "amazon.de", "ebay.com", "zalando.ch", "zalando.fr",
                "galaxus.ch", "digitec.ch", "footlocker.com", "footlocker.ch", "snipes.com", "sns.com",
                "farfetch.com", "ssense.com", "shop.app", "etsy.com", "vinted.com", "vinted.fr", "aliexpress.com",
                "decathlon.ch", "decathlon.fr", "dsw.com", "finishline.com", "jdsports.com", "jdsports.fr", "kith.com",
                "stadiumgoods.com", "klekt.com", "klekt.io", "bstn.com", "afew-store.com", "solebox.com", "end-clothing.com"}
SHOP_PATH_RE = re.compile(r"/(products?|produits?|dp|gp/product|item|itm|shop|store|collections?|catalog|buy|p)/", re.I)
SOCIAL_NOISE = {"instagram.com", "facebook.com", "meta.com", "help.instagram.com", "about.instagram.com",
                "cdninstagram.com", "fb.com", "fb.me", "threads.net", "threads.com", "meta.ai", "muse.ai", "whatsapp.com", "oculus.com"}
BRANDS = ["Nike", "Jordan", "Air Jordan", "Adidas", "Yeezy", "New Balance", "Asics", "Puma", "Reebok", "Converse", "Vans",
          "Salomon", "On Running", "Hoka", "Crocs", "Birkenstock", "Dr. Martens", "Timberland", "UGG", "The North Face",
          "Stussy", "Supreme", "Off-White", "Travis Scott", "Fear of God", "Essentials", "Carhartt", "Patagonia",
          "Arc'teryx", "Lululemon", "Apple", "Samsung", "Sony", "Nintendo", "PlayStation", "Pokemon", "Pokémon", "Lego",
          "StockX", "GOAT", "Zalando", "Galaxus", "Vinted", "eBay", "Amazon", "Shopify", "Pledge"]


# ---------- url ----------
def parse_ig_url(url):
    """-> (kind, shortcode, canonical_url) or raises ValueError. Drops query (igsh tracking etc.)."""
    u = urllib.parse.urlsplit(url.strip())
    if u.scheme not in ("http", "https") or (u.hostname or "").lower() not in IG_HOSTS:
        raise ValueError("not an instagram.com url")
    m = PATH_RE.match(u.path)
    if not m:
        raise ValueError("not a post/reel url (expected /p/<code>/ or /reel/<code>/)")
    kind = "reel" if m.group(1) in ("reel", "reels") else "tv" if m.group(1) == "tv" else "post"
    path = {"reel": "reel", "tv": "tv", "post": "p"}[kind]
    return kind, m.group(2), f"https://www.instagram.com/{path}/{m.group(2)}/"


# ---------- extraction ----------
def _media_from_embedded(html, shortcode):
    """Decode the `xig_polaris_media` object whose code == shortcode. None if absent."""
    dec = json.JSONDecoder()
    key = '"xig_polaris_media":'
    pos = 0
    while True:
        i = html.find(key, pos)
        if i < 0:
            return None
        start = i + len(key)
        pos = start
        try:
            obj, _ = dec.raw_decode(html[start:])
        except ValueError:
            continue
        if isinstance(obj, dict) and obj.get("code") == shortcode:
            return obj


def _iso(ts):
    try:
        return datetime.datetime.fromtimestamp(int(ts), datetime.timezone.utc).isoformat(timespec="seconds")
    except (TypeError, ValueError, OSError, OverflowError):
        return None


def _media_urls(m, max_items=3):
    """Public CDN media URLs exposed by the page JSON (transient: signed, never written to the repo)."""
    def one(node):
        vids = [{"url": v["url"], "width": v.get("width"), "height": v.get("height")} for v in (node.get("video_versions") or []) if v.get("url")]
        imgs = [{"url": c["url"], "width": c.get("width"), "height": c.get("height")}
                for c in ((node.get("image_versions2") or {}).get("candidates") or []) if c.get("url")]
        if vids:
            return {"type": "video", "versions": vids}
        return {"type": "image", "versions": imgs} if imgs else None
    nodes = m.get("carousel_media") or [m]
    return [x for x in (one(n) for n in nodes[:max_items]) if x]


def parse_embedded(html, shortcode):
    obj = _media_from_embedded(html, shortcode)
    if not obj:
        return {}
    m = obj.get("if_not_gated_logged_out") or obj
    out = {}
    user = m.get("user") or {}
    if user.get("username"):
        out["account"] = user["username"]
    cap = m.get("caption")
    if isinstance(cap, dict) and cap.get("text"):
        out["caption"] = cap["text"]
    out["posted_at"] = _iso(m.get("taken_at"))
    for src, dst in (("like_count", "likes"), ("comment_count", "comments_count"), ("accessibility_caption", "alt_text"),
                     ("product_type", "product_type")):
        if m.get(src) is not None:
            out[dst] = m[src]
    music = (((m.get("clips_metadata") or {}).get("music_info") or {}).get("music_asset_info")) or {}
    if music.get("title"):
        out["music"] = " - ".join(x for x in (music.get("display_artist"), music.get("title")) if x)
    osi = (m.get("clips_metadata") or {}).get("original_sound_info")
    if isinstance(osi, dict) and osi.get("original_audio_title"):
        out["original_sound"] = osi["original_audio_title"]
    tags = []
    for t in ((m.get("usertags") or {}).get("in") or []):
        un = (t.get("user") or {}).get("username")
        if un:
            tags.append(un)
    out["tagged_accounts"] = tags
    out["coauthors"] = [c.get("username") for c in (m.get("coauthor_producers") or []) if c.get("username")]
    loc = m.get("location")
    if isinstance(loc, dict) and loc.get("name"):
        out["location"] = loc["name"]
    comments = []
    for e in ((obj.get("comments_connection") or {}).get("edges") or [])[:10]:
        n = e.get("node") or {}
        txt = n.get("text")
        if txt:
            comments.append({"account": (n.get("user") or {}).get("username"), "text": txt,
                             "likes": n.get("comment_like_count")})
    out["top_comments"] = comments
    out["_media"] = _media_urls(m)
    return out


_OG_DESC_RE = re.compile(
    r'^(?P<likes>[\d.,KMkm]+) likes?, (?P<comments>[\d.,KMkm]+) comments? - (?P<user>[\w.]+) on (?P<date>[^:]+): [“"](?P<cap>.*?)[”"]\.?\s*$',
    re.S)


def parse_og(meta):
    out = {}
    desc = meta.get("og:description") or meta.get("description") or ""
    m = _OG_DESC_RE.match(desc.strip())
    if m:
        out.update(account=m["user"], caption=m["cap"].strip(), posted_on=m["date"].strip(),
                   likes_text=m["likes"], comments_text=m["comments"])
    title = meta.get("og:title") or ""
    t = re.match(r"^(?P<name>.+?) on Instagram: [“\"](?P<cap>.*)[”\"]\s*$", title, re.S)
    if t:
        out["author_name"] = t["name"].strip()
        out.setdefault("caption", t["cap"].strip())
    if meta.get("og:url"):
        mu = re.match(r"https?://(?:www\.)?instagram\.com/([A-Za-z0-9_.]+)/(?:p|reel|tv)/", meta["og:url"])
        if mu:
            out.setdefault("account", mu.group(1))
    return out


def is_login_wall(text, meta, has_caption):
    low = (text or "")[:1500].lower()
    walled = "log into instagram" in low or ("log in" in low[:200] and "sign up" in low[:200] and not has_caption)
    return bool(walled and not has_caption)


def find_brands(*texts):
    blob = " \n ".join(t for t in texts if t)
    found = []
    for b in BRANDS:
        if re.search(r"(?<![\w])" + re.escape(b) + r"(?![\w])", blob, re.I) and b.lower() not in [f.lower() for f in found]:
            found.append(b)
    return found


def classify_links(urls):
    products, hubs, others = [], [], []
    for u in urls:
        d = jw.domain_of(u)
        if not d or any(d == n or d.endswith("." + n) for n in SOCIAL_NOISE):
            continue
        if any(d == h or d.endswith("." + h) for h in LINK_HUBS):
            hubs.append(u)
        elif any(d == s or d.endswith("." + s) for s in SHOP_DOMAINS) or SHOP_PATH_RE.search(urllib.parse.urlsplit(u).path):
            products.append(u)
        else:
            others.append(u)
    return products, hubs, others


def build_result(url, html, text, status=None, nbytes=None, capped=False, engine=None):
    kind, code, canon = parse_ig_url(url)
    page = jw.parse_html(html or "")
    emb = parse_embedded(html or "", code)
    og = parse_og(page["meta"])
    layers = [n for n, d in (("embedded_json", emb), ("og_meta", og)) if d]
    caption = emb.get("caption") or og.get("caption") or ""
    account = emb.get("account") or og.get("account")
    login_wall = is_login_wall(text, page["meta"], bool(caption))

    anchor_urls = [jw.strip_tracking(jw.unwrap_redirect(urllib.parse.urljoin(canon, h)))
                   for h, _ in page["links"] if h.startswith(("http", "/"))]
    urls = []
    for u in jw.extract_urls(caption) + anchor_urls:
        if u not in urls:
            urls.append(u)
    products, hubs, others = classify_links(urls)
    mentions = jw.extract_mentions(caption)
    brand_accounts = []
    for a in list(emb.get("tagged_accounts", [])) + list(emb.get("coauthors", [])) + mentions:
        if a not in brand_accounts and a != account:
            brand_accounts.append(a)
    hashtags = jw.extract_hashtags(caption)
    return {
        "url": canon, "kind": kind, "shortcode": code, "account": account,
        "author_name": og.get("author_name"), "caption": caption, "hashtags": hashtags, "mentions": mentions,
        "posted_at": emb.get("posted_at") or og.get("posted_on"),
        "likes": emb.get("likes", og.get("likes_text")), "comments_count": emb.get("comments_count", og.get("comments_text")),
        "music": emb.get("music"), "original_sound": emb.get("original_sound"), "alt_text": emb.get("alt_text"),
        "location": emb.get("location"), "tagged_accounts": emb.get("tagged_accounts", []), "coauthors": emb.get("coauthors", []),
        "brand_candidates": {"accounts": brand_accounts, "named": find_brands(caption, " ".join(hashtags), emb.get("alt_text"))},
        "links": {"product": products, "link_hub": hubs, "other": others},
        "top_comments": emb.get("top_comments", []),
        "visible_text": (text or "")[:4000],
        "login_wall": login_wall, "extracted_via": layers, "http_status": status, "bytes": nbytes, "capped": capped,
        "engine": engine, "fetched_at": datetime.datetime.now().astimezone().isoformat(timespec="seconds"),
        "_media": emb.get("_media", []),
        "limits": "text only here: no audio transcript, no video frame analysis (see insta_account.py for best-effort frames + OCR)",
    }


def render_text(r):
    L = [f"{r['kind']} {r['url']}", f"compte: @{r['account']}" + (f" ({r['author_name']})" if r.get("author_name") else ""),
         f"date: {r.get('posted_at')}  likes: {r.get('likes')}  commentaires: {r.get('comments_count')}"]
    if r.get("login_wall"):
        L.append("!! login wall: contenu partiel")
    L += ["", "légende:", r["caption"] or "(vide)", ""]
    for label, v in (("hashtags", ", ".join("#" + h for h in r["hashtags"])), ("mentions", ", ".join("@" + m for m in r["mentions"])),
                     ("musique", r.get("music") or r.get("original_sound")), ("alt auto", r.get("alt_text")),
                     ("marques (comptes)", ", ".join(r["brand_candidates"]["accounts"])),
                     ("marques (nommées)", ", ".join(r["brand_candidates"]["named"])),
                     ("liens produit", " ".join(r["links"]["product"])), ("link hub", " ".join(r["links"]["link_hub"])),
                     ("autres liens", " ".join(r["links"]["other"]))):
        if v:
            L.append(f"{label}: {v}")
    if r["top_comments"]:
        L += ["", "commentaires visibles:"] + [f"  @{c['account']}: {c['text'][:160]}" for c in r["top_comments"][:5]]
    return "\n".join(L)


def main(argv=None):
    ap = argparse.ArgumentParser(description="Read one public Instagram post/reel (read-only).")
    ap.add_argument("url")
    ap.add_argument("--text", action="store_true", help="human-readable output instead of JSON")
    ap.add_argument("--engine", choices=["camoufox", "patchright"], default="camoufox")
    ap.add_argument("--max-mb", type=float, default=None, help=f"per-page byte cap (default {DEFAULT_MAX_MB})")
    ap.add_argument("--log", default=None, help="JSONL visit log path")
    ap.add_argument("--from-html", metavar="FILE", help="parse a saved page instead of opening a browser")
    a = ap.parse_args(argv)
    try:
        kind, code, canon = parse_ig_url(a.url)
    except ValueError as e:
        print(f"usage: {e}", file=sys.stderr)
        return EXIT_USAGE
    log = jw.log_path(a.log)
    html = text = ""
    status = nbytes = None
    capped = False
    if a.from_html:
        with open(a.from_html, encoding="utf-8", errors="replace") as f:
            html = f.read()
        text = re.sub(r"<[^>]+>", " ", html)[:4000]
    else:
        try:
            with jw.Browser(a.engine, jw.max_page_bytes(a.max_mb or os.environ.get("JARVIS_MAX_PAGE_MB") or DEFAULT_MAX_MB),
                            log=a.log, tool="insta_reel") as br:
                r = jw.browser_fetch_retry(br, canon, "insta_reel", log, wait_ms=4000)
        except jw.AntiBotError as e:
            print(f"blocked: {jw.mask(e)}", file=sys.stderr)
            return EXIT_BLOCKED
        except jw.FetchError as e:
            print(f"error: {jw.mask(e)}", file=sys.stderr)
            return EXIT_ERR
        html, text, status, nbytes, capped = r["html"], r["text"], r["status"], r["bytes"], r["capped"]
    res = build_result(canon, html, text, status, nbytes, capped, None if a.from_html else a.engine)
    res = {k: v for k, v in res.items() if not k.startswith("_")}
    print(render_text(res) if a.text else json.dumps(res, ensure_ascii=False, indent=2))
    if res["login_wall"] and not res["caption"]:
        return EXIT_BLOCKED
    return EXIT_OK


if __name__ == "__main__":
    sys.exit(main())
