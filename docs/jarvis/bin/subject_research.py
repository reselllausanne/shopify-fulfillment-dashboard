#!/usr/bin/env python3
"""subject-research: collect context on a subject (SerpApi web + shopping), open a few sources read-only,
and write/update ONE Markdown fiche per subject: docs/jarvis/inbox/sujets/<slug>.md

Usage:
  subject_research.py "Nike Dunk Low Panda" [--max-queries 4] [--max-pages 3] [--dry-run] [--text]
  subject_research.py "sujet" --seed-url https://... [--seed-url ...]   (open given pages; works without SerpApi key)

Re-running the same subject (same slug) completes the existing fiche: new dated journal entry, facts and
sources de-duplicated, facts promoted Incertain -> Confirmé when corroborated. Nothing is overwritten.

Confirmé = fact backed by >= 2 independent domains (same normalized claim / same identifier such as GTIN, MPN,
product name) OR by a primary Google source (knowledge graph, answer box). Everything else = Incertain.
Every fact line carries its sources and the date it was seen. No LLM: extraction is rule-based and rule-checkable.

Read-only: SerpApi GET + page GET. No purchase, login, form, post or publication. Pages: urllib first, then the
script's own headless browser (Camoufox) only if blocked (--fetch auto|http|browser). Never the Mac's Chrome.
Private/loopback addresses are refused. Caps: --max-queries (default 4, hard max 5), --max-pages (default 3,
hard max 8), JARVIS_MAX_PAGE_MB per page (default 3), <= 3 attempts per request, none on 401/403/429.

Secrets: SERPAPI_API_KEY from env only (never argv, log, fiche or stdout; masked in every error). Optional
JARVIS_PROXY_URL for the browser. Visit/query log JSONL (no content): JARVIS_WEB_LOG.

Exit codes: 0 ok | 1 error (partial fiche may be written) | 2 usage / missing key | 3 SerpApi auth/quota refused.
"""
import argparse
import datetime
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

import jarvis_web as jw

EXIT_OK, EXIT_ERR, EXIT_USAGE, EXIT_AUTH = 0, 1, 2, 3
SERP_ENDPOINT = "https://serpapi.com/search.json"
HARD_MAX_QUERIES, HARD_MAX_PAGES = 5, 8
PRIMARY_KINDS = {"kg", "answer", "meta"}  # "meta" = platform metadata (video_knowledge_base.py)
SKIP_DOMAINS = {"youtube.com", "youtu.be", "instagram.com", "facebook.com", "tiktok.com", "pinterest.com", "pinterest.fr",
                "x.com", "twitter.com", "reddit.com", "linkedin.com", "google.com", "google.ch", "google.fr", "t.co",
                "stockx.com", "goat.com"}  # StockX/GOAT: never opened from here (anti-bot + out of scope)
DEFAULT_OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "inbox", "sujets")
SECOND_LEVEL = {"co", "com", "org", "net", "gov", "ac"}


# ---------- subject / queries ----------
def clean_subject(s):
    s = re.sub(r"\s+", " ", (s or "")).strip()
    return s[:200]


def query_plan(subject, max_queries):
    plan = [("google", subject), ("google_shopping", subject), ("google", f"{subject} prix"),
            ("google", f"{subject} avis"), ("google", f"{subject} news")]
    return plan[:max(0, min(max_queries, HARD_MAX_QUERIES))]


def registrable(domain):
    parts = [p for p in (domain or "").lower().split(".") if p]
    if len(parts) <= 2:
        return ".".join(parts)
    if parts[-2] in SECOND_LEVEL and len(parts[-1]) == 2:
        return ".".join(parts[-3:])
    return ".".join(parts[-2:])


def norm_url(url):
    """Canonical form for de-duplication: no fragment/tracking, lowercase host w/o www, no trailing slash."""
    try:
        u = urllib.parse.urlsplit(jw.strip_tracking(url.strip()))
    except ValueError:
        return url
    host = (u.hostname or "").lower()
    host = host[4:] if host.startswith("www.") else host
    path = u.path.rstrip("/") or ""
    return urllib.parse.urlunsplit((u.scheme.lower() or "https", host, path, u.query, ""))


def safe_md_url(url):
    return url.replace(" ", "%20").replace(")", "%29").replace("(", "%28")


def one_line(s, n=400):
    s = re.sub(r"\s+", " ", str(s or "")).strip().replace("<!--", "").replace("-->", "")
    return s[: n - 1] + "…" if len(s) > n else s


# ---------- SerpApi ----------
class SerpAuthError(Exception):
    pass


def serp_call(engine, q, key, gl="ch", hl="fr", opener=None, sleep=time.sleep, timeout=30):
    """GET one SerpApi query -> dict. <= 3 attempts on network/5xx; none on 4xx. Key masked in every error."""
    params = {"engine": engine, "q": q, "api_key": key, "gl": gl, "hl": hl}
    if engine == "google":
        params.update(google_domain="google.ch" if gl == "ch" else "google.com", num="10")
    url = SERP_ENDPOINT + "?" + urllib.parse.urlencode(params)
    op = opener or urllib.request.urlopen
    last = None
    for attempt in range(1, jw.MAX_ATTEMPTS + 1):
        try:
            with op(urllib.request.Request(url, headers={"User-Agent": "jarvis-subject-research/1"}), timeout=timeout) as r:
                data = json.loads(r.read().decode("utf-8", "replace"))
            if data.get("error"):
                msg = jw.mask(data["error"], extra=[key])
                if "hasn't returned any results" in msg or "no results" in msg.lower():
                    return {}
                raise jw.FetchError(f"serpapi: {msg}")
            return data
        except urllib.error.HTTPError as e:
            if e.code in (401, 403, 429):
                raise SerpAuthError(f"serpapi HTTP {e.code} ({'invalid key' if e.code in (401, 403) else 'quota/rate limit'})")
            if e.code < 500:
                raise jw.FetchError(f"serpapi HTTP {e.code}")
            last = f"HTTP {e.code}"
        except (urllib.error.URLError, TimeoutError, ConnectionError, ValueError) as e:
            last = jw.mask(getattr(e, "reason", e), extra=[key])
        if attempt < jw.MAX_ATTEMPTS:
            sleep(2 * attempt)
    raise jw.FetchError(f"serpapi failed after {jw.MAX_ATTEMPTS} attempts: {last}")


# ---------- facts ----------
def mk_fact(kind, key, text, url, title="", date=None, via=""):
    return {"kind": kind, "key": re.sub(r"\s+", "-", str(key)), "text": one_line(text), "url": url, "title": one_line(title, 160), "date": date, "via": via}


def fkey(*parts):
    return ":".join(jw.slugify(str(p), 50) for p in parts if p)


STYLE_CODE_RE = re.compile(r"(?<![A-Z0-9-])([A-Z]{1,3}\d{4}-\d{3})(?![A-Z0-9-])")


def code_facts(text, url, title, today, via):
    """Manufacturer style codes (e.g. DD1391-100) quoted in a title/snippet: identifiers that other domains can corroborate."""
    out = []
    for code in dict.fromkeys(STYLE_CODE_RE.findall(text or "")):
        out.append(mk_fact("ident", f"id:mpn:{code.replace('-', '').lower()}",
                           f"Référence {code} citée : « {one_line(title or text, 140)} »", url, title, today, via))
    return out


def extract_serp_facts(engine, q, resp, today):
    """Rule-based facts from one SerpApi response. Each carries a source URL (Google result link)."""
    out = []
    via = f'{engine} "{q}"'
    if engine == "google":
        kg = resp.get("knowledge_graph") or {}
        if kg.get("title"):
            src = ((kg.get("source") or {}).get("link")) or kg.get("website") or (kg.get("profiles") or [{}])[0].get("link")
            if src and kg.get("description"):
                typ = f" ({kg['type']})" if kg.get("type") else ""
                out.append(mk_fact("kg", fkey("kg", kg["title"]), f"{kg['title']}{typ}: {kg['description']}", src, kg["title"], today, via))
        ab = resp.get("answer_box") or {}
        ans = ab.get("answer") or ab.get("snippet") or ab.get("result")
        if isinstance(ans, list):
            ans = "; ".join(map(str, ans[:5]))
        if ans and ab.get("link"):
            out.append(mk_fact("answer", fkey("answer", ans), f"{ab.get('title') or q}: {ans}", ab["link"], ab.get("title", ""), today, via))
        for r in (resp.get("organic_results") or [])[:8]:
            if not r.get("link") or not (r.get("snippet") or r.get("title")):
                continue
            pub = f" (publié {r['date']})" if r.get("date") else ""
            out.append(mk_fact("organic", fkey("org", r.get("snippet") or r["title"]), f"{r.get('title', '')} — {r.get('snippet', '')}{pub}",
                               r["link"], r.get("title", ""), today, via))
            out += code_facts(f"{r.get('title', '')} {r.get('snippet', '')}", r["link"], r.get("title", ""), today, via)
        for rq in (resp.get("related_questions") or [])[:3]:
            if rq.get("snippet") and rq.get("link"):
                out.append(mk_fact("organic", fkey("rq", rq["snippet"]), f"Q: {rq.get('question', '')} — {rq['snippet']}", rq["link"],
                                   rq.get("title", ""), today, via))
    shopping = resp.get("shopping_results") or resp.get("inline_shopping_results") or []
    for r in shopping[:10]:
        link = r.get("link") or r.get("product_link")
        title, price, merchant = r.get("title"), r.get("price"), r.get("source")
        if not (link and title):
            continue
        d = registrable(jw.domain_of(jw.unwrap_redirect(link)))
        # Google Shopping often returns google.* product pages: the merchant name is the only independent source then.
        src_dom = merchant or d
        out.append(mk_fact("product", fkey("product", title), f"Produit référencé: {title}", link, title, today, via))
        out += code_facts(title, link, title, today, via)
        if price:
            out.append(mk_fact("offer", fkey("offer", src_dom, title, price), f"Offre: {title} — {price} chez {merchant or d}", link, title, today, via))
    return out


VARIANT_SUFFIX_RE = re.compile(r"\s*[-–|]\s*(?:(?:EU|US|UK|FR|CM)\s*)?\d{1,2}(?:[.,]\d)?(?:\s*[⅓⅔½])?(?:\s*(?:EU|US|UK|FR|CM))?\s*$", re.I)


def base_product_name(name):
    """Drop a trailing size suffix ("... - EU 36.5") so size variants of one page collapse into one product."""
    return VARIANT_SUFFIX_RE.sub("", str(name)).strip() or str(name)


def extract_page_facts(url, html, today, final_url=None):
    """Facts from an opened page: JSON-LD products (+ identifiers) and title/description. Source = the page."""
    page = jw.parse_html(html)
    src = final_url or url
    via = "page ouverte"
    out = []
    seen_names = set()
    prods = sorted(jw.jsonld_products(page["jsonld"]), key=lambda p: p.get("price") is None)
    for p in prods:
        p = dict(p, name=base_product_name(p["name"]), orig=p["name"])
        if p["name"].lower() in seen_names or len(seen_names) >= 2:
            continue
        seen_names.add(p["name"].lower())
        bits = [f"marque {p['brand']}" if p.get("brand") else "", f"MPN {p['mpn']}" if p.get("mpn") else "",
                f"GTIN {p['gtin']}" if p.get("gtin") else "", f"SKU {p['sku']}" if p.get("sku") else ""]
        bits = ", ".join(b for b in bits if b)
        price = f" — {p['price']} {p.get('currency') or ''}".rstrip() if p.get("price") else ""
        out.append(mk_fact("page", fkey("pagejsonld", registrable(jw.domain_of(src)), p["name"], p.get("price")),
                           f"{registrable(jw.domain_of(src))}: fiche produit « {p['name']} »{' (' + bits + ')' if bits else ''}{price}",
                           src, page["title"], today, via))
        out.append(mk_fact("product", fkey("product", p["name"]), f"Produit référencé: {p['name']}", src, page["title"], today, via))
        for label, v in (("GTIN", p.get("gtin")), ("MPN", p.get("mpn"))):
            if v:
                out.append(mk_fact("ident", f"id:{label.lower()}:{re.sub(r'[^A-Za-z0-9]', '', v).lower()}",
                                   f"Identifiant {label} {v} associé à « {p['orig']} »", src, page["title"], today, via))
    meta = page["meta"]
    title = meta.get("og:title") or page["title"]
    desc = meta.get("og:description") or meta.get("description")
    if title:
        dom = registrable(jw.domain_of(src))
        txt = f"{dom}: {title}" + (f" — {one_line(desc, 300)}" if desc else "")
        out.append(mk_fact("page", fkey("pagemeta", dom, title), txt, src, title, today, via))
        out += code_facts(f"{title} {desc or ''}", src, title, today, via)
    return out


# ---------- fiche model ----------
def new_doc(subject, slug, now):
    return {"subject": subject, "slug": slug, "created": now, "updated": now, "runs": 0, "facts": {}, "sources": {},
            "raw": {"confirmed": [], "uncertain": []}, "notes": "", "journal": []}


def fact_status(f):
    if f["kind"] in PRIMARY_KINDS and f["sources"]:
        return "confirmed"
    doms = {registrable(s["domain"]) for s in f["sources"] if s.get("domain")}
    return "confirmed" if len(doms) >= 2 else "uncertain"


def add_fact(doc, f):
    """Merge one fact. Returns (is_new_fact, is_new_source)."""
    nurl = norm_url(f["url"])
    dom = f.get("domain") or registrable(jw.domain_of(f["url"]))
    key = f["key"]
    cur = doc["facts"].get(key)
    new_fact = cur is None
    if new_fact:
        cur = {"key": key, "kind": f["kind"], "text": f["text"], "sources": []}
        doc["facts"][key] = cur
    new_src = all(norm_url(s["url"]) != nurl for s in cur["sources"])
    if new_src:
        cur["sources"].append({"domain": dom, "url": f["url"], "date": f["date"]})
    s = doc["sources"].get(nurl)
    if s is None:
        doc["sources"][nurl] = {"url": f["url"], "title": f["title"] or dom, "domain": dom, "date": f["date"], "via": f["via"]}
    elif not s.get("title") and f["title"]:
        s["title"] = f["title"]
    return new_fact, new_src


def render_doc(doc):
    conf = [f for f in doc["facts"].values() if fact_status(f) == "confirmed"]
    unc = [f for f in doc["facts"].values() if fact_status(f) != "confirmed"]

    def line(f):
        srcs = "; ".join(f"[{s['domain'] or 'source'}]({safe_md_url(s['url'])}) ({s['date']})" for s in f["sources"])
        return f"- {f['text']} <!-- k:{f['key']} t:{f['kind']} --> — sources : {srcs}"
    L = ["---", f"subject: {json.dumps(doc['subject'], ensure_ascii=False)}", f"slug: {doc['slug']}",
         f"created: {doc['created']}", f"updated: {doc['updated']}", f"runs: {doc['runs']}", "---", "",
         f"# {doc.get('title_prefix', 'Sujet')} : {doc['subject']}", ""]
    L += doc.get("preamble") or [
        "> Fiche générée par `docs/jarvis/bin/subject_research.py` (lecture seule). Re-lancer le même sujet complète cette fiche.",
        "> Confirmé = >= 2 domaines indépendants ou source primaire Google ; sinon Incertain. Chaque fait : sources + date de vue."]
    L += ["", "## Confirmé", ""]
    L += [line(f) for f in conf] + doc["raw"]["confirmed"] or ["_(rien pour l'instant)_"]
    L += ["", "## Incertain", ""]
    L += [line(f) for f in unc] + doc["raw"]["uncertain"] or ["_(rien pour l'instant)_"]
    L += ["", "## Sources", ""]
    L += [f"- [{one_line(s['title'], 120)}]({safe_md_url(s['url'])}) — {s['domain']} · vu {s['date']} · via {s['via']}"
          for s in doc["sources"].values()] or ["_(aucune)_"]
    if doc["notes"].strip():
        L += ["", "## Notes", "", doc["notes"].strip()]
    L += ["", "## Journal", ""]
    for j in doc["journal"]:
        L += [j.rstrip(), ""]
    return "\n".join(L).rstrip() + "\n"


_FACT_RE = re.compile(r"^- (?P<text>.*?) <!-- k:(?P<key>\S+) t:(?P<kind>\w+) --> — sources : (?P<src>.*)$")
_SRC_RE = re.compile(r"\[([^\]]*)\]\((\S+?)\) \((\d{4}-\d{2}-\d{2}|None)\)")
_SRCLINE_RE = re.compile(r"^- \[(?P<title>.*)\]\((?P<url>\S+)\) — (?P<dom>\S*) · vu (?P<date>\S+) · via (?P<via>.*)$")


def parse_doc(md):
    """Parse a fiche produced by render_doc. Unknown bullets are kept verbatim; Notes and Journal untouched."""
    fm = {}
    m = re.match(r"^---\n(.*?)\n---\n", md, re.S)
    if m:
        for ln in m.group(1).splitlines():
            k, _, v = ln.partition(": ")
            fm[k.strip()] = v.strip()
    try:
        subject = json.loads(fm.get("subject", '""'))
    except ValueError:
        subject = fm.get("subject", "")
    doc = new_doc(subject, fm.get("slug", ""), fm.get("created", ""))
    doc["updated"] = fm.get("updated", doc["created"])
    doc["runs"] = int(fm["runs"]) if fm.get("runs", "").isdigit() else 0
    sections, cur = {}, None
    for ln in md.splitlines():
        h = re.match(r"^## (.+)$", ln)
        if h:
            cur = h.group(1).strip()
            sections[cur] = []
        elif cur:
            sections[cur].append(ln)
    for name, bucket in (("Confirmé", "confirmed"), ("Incertain", "uncertain")):
        for ln in sections.get(name, []):
            if not ln.startswith("- "):
                continue
            fm_ = _FACT_RE.match(ln)
            if not fm_:
                doc["raw"][bucket].append(ln)
                continue
            srcs = [{"domain": d, "url": u, "date": None if dt == "None" else dt} for d, u, dt in _SRC_RE.findall(fm_["src"])]
            doc["facts"][fm_["key"]] = {"key": fm_["key"], "kind": fm_["kind"], "text": fm_["text"],
                                        "sources": [dict(s, domain=s["domain"] if s["domain"] != "source" else "") for s in srcs]}
    for ln in sections.get("Sources", []):
        sm = _SRCLINE_RE.match(ln)
        if sm:
            doc["sources"][norm_url(sm["url"])] = {"url": sm["url"], "title": sm["title"], "domain": sm["dom"], "date": sm["date"], "via": sm["via"]}
    doc["notes"] = "\n".join(sections.get("Notes", [])).strip()
    jm = re.search(r"^## Journal\n\n(.*)\Z", md, re.S | re.M)
    if jm:
        doc["journal"] = [b.strip("\n") for b in re.split(r"\n(?=### )", jm.group(1).strip()) if b.strip()]
    return doc


def merge_run(doc, facts, now, run_info):
    """Apply a run to doc (mutates). Returns stats dict. Appends one dated journal entry (always)."""
    before = {k: fact_status(f) for k, f in doc["facts"].items()}
    n_fact = n_src = 0
    seen_src_before = len(doc["sources"])
    for f in facts:
        nf, ns = add_fact(doc, f)
        n_fact += nf
        n_src += ns
    promoted = [k for k, f in doc["facts"].items() if before.get(k) == "uncertain" and fact_status(f) == "confirmed"]
    doc["runs"] += 1
    doc["updated"] = now
    stats = {"new_facts": n_fact, "new_sources": len(doc["sources"]) - seen_src_before, "new_source_links": n_src,
             "promoted": len(promoted), "confirmed_total": sum(fact_status(f) == "confirmed" for f in doc["facts"].values()),
             "uncertain_total": sum(fact_status(f) != "confirmed" for f in doc["facts"].values())}
    J = [f"### {now}", ""]
    if run_info.get("subject_input") and run_info["subject_input"] != doc["subject"]:
        J.append(f"- sujet saisi : {run_info['subject_input']}")
    J.append("- mode : " + run_info.get("mode", "serpapi"))
    for q in run_info.get("queries", []):
        J.append(f"- requête {q['engine']} « {q['q']} » : {q['results']} résultats" + (f" ({q['error']})" if q.get("error") else ""))
    for p in run_info.get("pages", []):
        J.append(f"- page ouverte : {p['url']} → {p['outcome']}")
    if run_info.get("price_range"):
        J.append(f"- prix observés (Google Shopping) : {run_info['price_range']}")
    J += run_info.get("extra", [])
    J.append(f"- bilan : +{stats['new_facts']} faits, +{stats['new_sources']} sources, {stats['promoted']} promus en Confirmé "
             f"(total Confirmé {stats['confirmed_total']} / Incertain {stats['uncertain_total']})")
    if not n_fact:
        J.append("- aucun nouveau fait sur ce run")
    for e in run_info.get("errors", []):
        J.append(f"- erreur : {jw.mask(e)}")
    doc["journal"].append("\n".join(J))
    return stats


def price_range(shopping_all):
    vals, cur = [], set()
    for r in shopping_all:
        v = r.get("extracted_price")
        if isinstance(v, (int, float)):
            vals.append(float(v))
            m = re.search(r"(CHF|EUR|€|\$|USD|GBP|£)", str(r.get("price", "")))
            if m:
                cur.add(m.group(1))
    if len(vals) < 1:
        return None
    return f"{min(vals):.2f}–{max(vals):.2f} {'/'.join(sorted(cur)) or '?'} sur {len(vals)} offres"


# ---------- page selection / fetching ----------
def pick_pages(serp_responses, max_pages, seeds=()):
    """Distinct-domain pages to open: seeds first, then organic results by (queries seen in, best position)."""
    cand = {}
    for resp in serp_responses:
        for r in (resp.get("organic_results") or []):
            link = r.get("link")
            if not link:
                continue
            n = norm_url(link)
            c = cand.setdefault(n, {"url": link, "count": 0, "pos": 99})
            c["count"] += 1
            c["pos"] = min(c["pos"], r.get("position") or 99)
        for r in (resp.get("shopping_results") or []):
            link = r.get("link")
            if link and registrable(jw.domain_of(link)) not in SKIP_DOMAINS and "google." not in jw.domain_of(link):
                c = cand.setdefault(norm_url(link), {"url": link, "count": 0, "pos": 50})
                c["count"] += 1
    order = list(seeds) + [c["url"] for c in sorted(cand.values(), key=lambda c: (-c["count"], c["pos"]))]
    out, doms = [], set()
    for u in order:
        if len(out) >= max_pages:
            break
        d = registrable(jw.domain_of(u))
        if not d or d in doms or (d in SKIP_DOMAINS and u not in seeds):
            continue
        doms.add(d)
        out.append(u)
    return out


class PageFetcher:
    """urllib first; the script's own headless browser (created lazily, closed in close()) only if blocked."""

    def __init__(self, mode, log, engine="camoufox", http=jw.http_get):
        self.mode, self.log, self.engine, self.http, self.br = mode, log, engine, http, None

    def close(self):
        if self.br:
            self.br.close()
            self.br = None

    def _browser(self):
        if self.br is None:
            self.br = jw.Browser(self.engine, log=self.log, tool="subject_research").start()
        return self.br

    def get(self, url):
        """-> (html, final_url, how). Raises FetchError/AntiBotError."""
        if self.mode in ("http", "auto"):
            t0 = time.time()
            try:
                status, html, nbytes = self.http(url)
                jw.log_visit(self.log, "subject_research", url, engine="http", status=status, bytes=nbytes, outcome="ok",
                             ms=int((time.time() - t0) * 1000))
                return html, url, "http"
            except jw.AntiBotError as e:
                jw.log_visit(self.log, "subject_research", url, engine="http", outcome="antibot", error=str(e))
                if self.mode == "http":
                    raise
            except jw.FetchError as e:
                jw.log_visit(self.log, "subject_research", url, engine="http", outcome="error", error=str(e))
                if self.mode == "http":
                    raise
        r = jw.browser_fetch_retry(self._browser(), url, "subject_research", self.log, wait_ms=2500, want_text=False)
        return r["html"], r["final_url"], "browser"


# ---------- main ----------
def doc_path(out_dir, slug):
    return os.path.join(out_dir, slug + ".md")


def write_atomic(path, text):
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(text)
    os.replace(tmp, path)


def run(args, env=None, serp=serp_call, fetcher=None, now=None):
    env = os.environ if env is None else env
    subject = clean_subject(args.subject)
    if not subject:
        print("usage: empty subject", file=sys.stderr)
        return EXIT_USAGE, None
    slug = jw.slugify(subject)
    out_dir = os.path.abspath(args.out_dir)
    path = doc_path(out_dir, slug)
    max_q = max(0, min(args.max_queries, HARD_MAX_QUERIES))
    max_p = max(0, min(args.max_pages, HARD_MAX_PAGES))
    key = env.get("SERPAPI_API_KEY") or ""
    seeds = list(args.seed_url or [])
    plan = query_plan(subject, max_q)
    exists = os.path.exists(path)
    summary = {"subject": subject, "slug": slug, "path": path, "exists": exists, "dry_run": bool(args.dry_run),
               "serpapi_key_present": bool(key), "max_queries": max_q, "max_pages": max_p,
               "planned_queries": [{"engine": e, "q": q} for e, q in plan], "seed_urls": seeds}
    if args.dry_run:
        summary["note"] = "dry-run: no network, no file written"
        return EXIT_OK, summary
    if not key and not seeds:
        print("SERPAPI_API_KEY missing in env (use --dry-run to preview, or --seed-url to open given pages)", file=sys.stderr)
        return EXIT_USAGE, None
    nowiso = (now or datetime.datetime.now().astimezone()).isoformat(timespec="seconds")
    today = nowiso[:10]
    doc = parse_doc(open(path, encoding="utf-8").read()) if exists else new_doc(subject, slug, nowiso)
    if not doc["slug"]:
        doc["slug"] = slug
    info = {"mode": "serpapi" if key else "seed-urls seulement (pas de clé SerpApi)", "subject_input": subject,
            "queries": [], "pages": [], "errors": []}
    facts, responses, shopping_all = [], [], []
    code = EXIT_OK
    if key:
        for engine, q in plan:
            t0 = time.time()
            try:
                resp = serp(engine, q, key, gl=args.gl, hl=args.hl)
            except SerpAuthError as e:
                info["errors"].append(jw.mask(e, extra=[key]))
                info["queries"].append({"engine": engine, "q": q, "results": 0, "error": "refusé"})
                code = EXIT_AUTH
                break
            except jw.FetchError as e:
                info["errors"].append(jw.mask(e, extra=[key]))
                info["queries"].append({"engine": engine, "q": q, "results": 0, "error": "échec"})
                code = EXIT_ERR
                continue
            responses.append(resp)
            n = len(resp.get("organic_results") or []) + len(resp.get("shopping_results") or [])
            info["queries"].append({"engine": engine, "q": q, "results": n})
            jw.log_visit(jw.log_path(args.log), "subject_research", SERP_ENDPOINT, engine=engine, q=q, results=n,
                         outcome="ok", ms=int((time.time() - t0) * 1000))
            shopping_all += resp.get("shopping_results") or []
            facts += extract_serp_facts(engine, q, resp, today)
    pages = pick_pages(responses, max_p, seeds)
    own_fetcher = fetcher is None
    fetcher = fetcher or PageFetcher(args.fetch, jw.log_path(args.log))
    try:
        for url in pages:
            try:
                html, final, how = fetcher.get(url)
                pf = extract_page_facts(url, html, today, final)
                facts += pf
                info["pages"].append({"url": jw.safe_log_url(url), "outcome": f"ok via {how}, {len(pf)} faits"})
            except (jw.FetchError, jw.AntiBotError) as e:
                info["pages"].append({"url": jw.safe_log_url(url), "outcome": "échec: " + one_line(jw.mask(e, extra=[key]), 100)})
    finally:
        if own_fetcher:
            fetcher.close()
    info["price_range"] = price_range(shopping_all)
    stats = merge_run(doc, facts, nowiso, info)
    write_atomic(path, render_doc(doc))
    summary.update(stats, queries=info["queries"], pages=info["pages"], errors=info["errors"], price_range=info["price_range"],
                   exists=True, runs=doc["runs"])
    return code, summary


def main(argv=None):
    ap = argparse.ArgumentParser(description="Research a subject (SerpApi) and update its Markdown fiche (read-only).")
    ap.add_argument("subject")
    ap.add_argument("--max-queries", type=int, default=4, help=f"SerpApi queries (default 4, hard max {HARD_MAX_QUERIES})")
    ap.add_argument("--max-pages", type=int, default=3, help=f"pages opened read-only (default 3, hard max {HARD_MAX_PAGES})")
    ap.add_argument("--dry-run", action="store_true", help="print the plan only: no network, no file")
    ap.add_argument("--seed-url", action="append", metavar="URL", help="open this page too (repeatable; works without SerpApi key)")
    ap.add_argument("--fetch", choices=["auto", "http", "browser"], default="auto")
    ap.add_argument("--gl", default="ch", help="Google country (default ch)")
    ap.add_argument("--hl", default="fr", help="Google language (default fr)")
    ap.add_argument("--out-dir", default=DEFAULT_OUT, help="fiche directory (default docs/jarvis/inbox/sujets)")
    ap.add_argument("--log", default=None, help="JSONL visit log path")
    ap.add_argument("--text", action="store_true", help="human-readable summary instead of JSON")
    a = ap.parse_args(argv)
    code, summary = run(a)
    if summary is not None:
        if a.text:
            print(f"{summary['slug']}: {summary.get('new_facts', 0)} nouveaux faits, "
                  f"{summary.get('confirmed_total', '-')} confirmés / {summary.get('uncertain_total', '-')} incertains -> {summary['path']}")
        else:
            print(json.dumps(summary, ensure_ascii=False, indent=2))
    return code


if __name__ == "__main__":
    sys.exit(main())
