"""Run: python3 -m unittest discover -s docs/jarvis/tests -v  (stdlib only: no network, no browser, no SerpApi)."""
import argparse, io, json, os, sys, tempfile, unittest, urllib.error
from contextlib import redirect_stderr, redirect_stdout

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "bin"))
import jarvis_web as jw
import subject_research as sr

FAKE_KEY = "FAKEKEY_do_not_leak_123456"
NOW1, NOW2 = "2026-11-27T10:00:00+01:00", "2026-11-28T09:30:00+01:00"
GOOGLE = {"organic_results": [
    {"position": 1, "title": "Nike Dunk Low Panda DD1391-100", "link": "https://shop-a.ch/p/panda?utm_source=x", "snippet": "Le Dunk Low Panda, réf DD1391-100."},
    {"position": 2, "title": "Dunk Panda review", "link": "https://blog-b.com/panda", "snippet": "Avis sur DD1391-100 : confortable."},
    {"position": 3, "title": "Vidéo", "link": "https://www.youtube.com/watch?v=1", "snippet": "video"}],
    "knowledge_graph": {"title": "Nike Dunk", "type": "Sneaker", "description": "Modèle de basket Nike.", "source": {"link": "https://en.wikipedia.org/wiki/Nike_Dunk"}}}
SHOP = {"shopping_results": [
    {"title": "Nike Dunk Low Panda", "link": "https://shop-a.ch/p/panda", "source": "Shop A", "price": "CHF 129.00", "extracted_price": 129.0},
    {"title": "Nike Dunk Low Panda", "link": "https://shop-c.fr/panda", "source": "Shop C", "price": "CHF 119.90", "extracted_price": 119.9}]}
PAGE_HTML = ('<html><head><title>Panda</title><meta property="og:title" content="Dunk Low Panda DD1391-100"></head>'
             '<script type="application/ld+json">{"@type":"Product","name":"Nike Dunk Low Panda","brand":{"name":"Nike"},"mpn":"DD1391-100",'
             '"gtin13":"0195244000001","offers":{"price":"129.00","priceCurrency":"CHF"}}</script></html>')


def doc_with(facts, now=NOW1, subject="Nike Dunk Panda"):
    d = sr.new_doc(subject, sr.jw.slugify(subject), now)
    sr.merge_run(d, facts, now, {"queries": [], "pages": []})
    return d


class SlugTest(unittest.TestCase):
    def test_accents_spaces_stable(self):
        self.assertEqual(jw.slugify("Nike Dunk « Panda » été 2026"), "nike-dunk-panda-ete-2026")
        self.assertEqual(jw.slugify("  Crème  brûlée  "), "creme-brulee")
        self.assertEqual(jw.slugify("Œuvre Æsir straße"), "oeuvre-aesir-strasse")
        self.assertEqual(jw.slugify("NIKE dunk"), jw.slugify("nike   DUNK"))

    def test_edge_cases(self):
        self.assertTrue(jw.slugify("🔥🔥").startswith("sujet-"))
        self.assertEqual(jw.slugify("🔥🔥"), jw.slugify("🔥🔥"))
        self.assertLessEqual(len(jw.slugify("mot " * 50)), 60)
        self.assertNotIn("/", jw.slugify("../../etc/passwd"))
        self.assertEqual(jw.slugify("../../etc/passwd"), "etc-passwd")


class ExtractTest(unittest.TestCase):
    def test_serp_facts(self):
        f = sr.extract_serp_facts("google", "q", GOOGLE, "2026-11-27")
        kinds = [x["kind"] for x in f]
        self.assertIn("kg", kinds)
        self.assertIn("ident", kinds)
        self.assertTrue(all(x["url"] and x["date"] == "2026-11-27" for x in f))
        s = sr.extract_serp_facts("google_shopping", "q", SHOP, "2026-11-27")
        self.assertEqual(sum(x["kind"] == "offer" for x in s), 2)
        self.assertEqual(sr.price_range(SHOP["shopping_results"]), "119.90–129.00 CHF sur 2 offres")

    def test_page_facts(self):
        f = sr.extract_page_facts("https://shop-d.com/x", PAGE_HTML, "2026-11-27")
        keys = {x["key"] for x in f}
        self.assertIn("id:gtin:0195244000001", keys)
        self.assertIn("id:mpn:dd1391100", keys)

    def test_size_variants_collapse(self):
        html = ('<script type="application/ld+json">[' + ",".join(
            '{"@type":"Product","name":"Dunk Low - EU %s","gtin13":"19450000000%d","offers":{"price":"89","priceCurrency":"CHF"}}' % (sz, i)
            for i, sz in enumerate(["35.5", "36", "36.5"])) + ']</script>')
        f = sr.extract_page_facts("https://shop-e.ch/x", html, "2026-11-27")
        self.assertEqual(sum(x["kind"] == "product" for x in f), 1)
        self.assertEqual(sr.base_product_name("Dunk Low - EU 36.5"), "Dunk Low")
        self.assertEqual(sr.base_product_name("Dunk Low 2021"), "Dunk Low 2021")

    def test_pick_pages_skips_social_and_dupe_domains(self):
        resp = dict(GOOGLE, organic_results=GOOGLE["organic_results"] + [{"position": 4, "title": "x", "link": "https://shop-a.ch/other", "snippet": "s"}])
        pages = sr.pick_pages([resp, SHOP], 5)
        self.assertNotIn("https://www.youtube.com/watch?v=1", pages)
        self.assertEqual(len({jw.domain_of(p) for p in pages}), len(pages))
        self.assertEqual(len(sr.pick_pages([resp], 1)), 1)
        self.assertEqual(sr.pick_pages([resp], 0), [])
        self.assertEqual(sr.pick_pages([], 3, seeds=["https://seed.com/a"]), ["https://seed.com/a"])

    def test_stockx_goat_never_opened(self):
        resp = {"organic_results": [{"position": 1, "title": "t", "link": "https://stockx.com/nike", "snippet": "s"},
                                    {"position": 2, "title": "t", "link": "https://www.goat.com/x", "snippet": "s"}]}
        self.assertEqual(sr.pick_pages([resp], 3), [])


class MergeTest(unittest.TestCase):
    def facts(self, which=("g", "s")):
        out = []
        if "g" in which:
            out += sr.extract_serp_facts("google", "q", GOOGLE, "2026-11-27")
        if "s" in which:
            out += sr.extract_serp_facts("google_shopping", "q", SHOP, "2026-11-27")
        return out

    def test_status_rule(self):
        d = doc_with(self.facts())
        st = {k: sr.fact_status(f) for k, f in d["facts"].items()}
        self.assertEqual(st["id:mpn:dd1391100"], "confirmed")  # shop-a.ch + blog-b.com
        self.assertEqual(st["kg:nike-dunk"], "confirmed")  # primary source
        self.assertEqual(st[[k for k in st if k.startswith("product:")][0]], "confirmed")  # 2 merchants
        self.assertEqual(st[[k for k in st if k.startswith("offer:")][0]], "uncertain")  # single merchant price

    def test_idempotent_rerun_dedupes_but_journals(self):
        d = doc_with(self.facts())
        n_facts, n_src = len(d["facts"]), len(d["sources"])
        stats = sr.merge_run(d, self.facts(), NOW2, {"queries": [], "pages": []})
        self.assertEqual((stats["new_facts"], stats["new_sources"]), (0, 0))
        self.assertEqual((len(d["facts"]), len(d["sources"])), (n_facts, n_src))
        self.assertEqual((d["runs"], len(d["journal"])), (2, 2))
        self.assertIn("aucun nouveau fait", d["journal"][1])
        self.assertTrue(all(len(f["sources"]) == len({sr.norm_url(s["url"]) for s in f["sources"]}) for f in d["facts"].values()))

    def test_promotion_across_runs(self):
        d = doc_with(sr.extract_serp_facts("google", "q", {"organic_results": GOOGLE["organic_results"][:1]}, "2026-11-27"))
        self.assertEqual(sr.fact_status(d["facts"]["id:mpn:dd1391100"]), "uncertain")
        stats = sr.merge_run(d, sr.extract_page_facts("https://shop-d.com/x", PAGE_HTML, "2026-11-28"), NOW2, {"queries": [], "pages": []})
        self.assertEqual(sr.fact_status(d["facts"]["id:mpn:dd1391100"]), "confirmed")
        self.assertGreaterEqual(stats["promoted"], 1)
        self.assertEqual({s["date"] for s in d["facts"]["id:mpn:dd1391100"]["sources"]}, {"2026-11-27", "2026-11-28"})

    def test_price_change_is_new_dated_fact(self):
        d = doc_with(self.facts(("s",)))
        shop2 = {"shopping_results": [dict(SHOP["shopping_results"][0], price="CHF 99.00")]}
        stats = sr.merge_run(d, sr.extract_serp_facts("google_shopping", "q", shop2, "2026-11-28"), NOW2, {"queries": [], "pages": []})
        self.assertGreaterEqual(stats["new_facts"], 1)

    def test_render_parse_roundtrip_and_notes(self):
        d = doc_with(self.facts())
        d["notes"] = "Note manuelle de Théo."
        md = sr.render_doc(d)
        self.assertIn("## Confirmé", md)
        self.assertIn("## Incertain", md)
        self.assertLess(md.index("## Confirmé"), md.index("## Incertain"))
        d2 = sr.parse_doc(md)
        self.assertEqual(sr.render_doc(d2), md)
        self.assertEqual(d2["notes"], "Note manuelle de Théo.")
        self.assertEqual((d2["subject"], d2["runs"]), (d["subject"], 1))

    def test_unknown_bullets_preserved(self):
        d = doc_with(self.facts())
        md = sr.render_doc(d).replace("## Incertain\n", "## Incertain\n\n- ma ligne manuelle sans balise\n", 1)
        d2 = sr.parse_doc(md)
        self.assertIn("- ma ligne manuelle sans balise", sr.render_doc(d2))

    def test_every_fact_line_has_source_and_date(self):
        md = sr.render_doc(doc_with(self.facts()))
        for ln in md.splitlines():
            if "<!-- k:" in ln:
                self.assertRegex(ln, r"sources : \[.*\]\(https?://\S+\) \(\d{4}-\d{2}-\d{2}\)")


class SerpCallTest(unittest.TestCase):
    def test_no_retry_on_429_and_key_masked(self):
        calls = []

        def op(req, timeout=None):
            calls.append(req.full_url)
            raise urllib.error.HTTPError(req.full_url, 429, "limit", {}, None)
        with self.assertRaises(sr.SerpAuthError) as cm:
            sr.serp_call("google", "q", FAKE_KEY, opener=op, sleep=lambda s: None)
        self.assertEqual(len(calls), 1)
        self.assertNotIn(FAKE_KEY, str(cm.exception))

    def test_retry_cap_on_5xx(self):
        calls = []

        def op(req, timeout=None):
            calls.append(1)
            raise urllib.error.HTTPError(req.full_url, 503, "x", {}, None)
        with self.assertRaises(jw.FetchError):
            sr.serp_call("google", "q", FAKE_KEY, opener=op, sleep=lambda s: None)
        self.assertEqual(len(calls), jw.MAX_ATTEMPTS)

    def test_api_error_masked(self):
        class R(io.BytesIO):
            def __enter__(self): return self
            def __exit__(self, *a): pass
        op = lambda req, timeout=None: R(json.dumps({"error": f"Invalid API key. Your API key: {FAKE_KEY}"}).encode())
        with self.assertRaises(jw.FetchError) as cm:
            sr.serp_call("google", "q", FAKE_KEY, opener=op)
        self.assertNotIn(FAKE_KEY, str(cm.exception))


class FakeFetcher:
    def __init__(self):
        self.urls = []

    def get(self, url):
        self.urls.append(url)
        return PAGE_HTML, url, "http"

    def close(self):
        pass


def args(out, **kw):
    base = dict(subject="Nike Dunk Panda", max_queries=4, max_pages=3, dry_run=False, seed_url=None, fetch="auto", gl="ch", hl="fr",
                out_dir=out, log=os.path.join(out, "log.jsonl"), text=False)
    base.update(kw)
    return argparse.Namespace(**base)


class RunTest(unittest.TestCase):
    def test_dry_run_no_network_no_file(self):
        with tempfile.TemporaryDirectory() as d:
            def boom(*a, **k):
                raise AssertionError("network called")
            code, summ = sr.run(args(d, dry_run=True), env={"SERPAPI_API_KEY": FAKE_KEY}, serp=boom, fetcher=FakeFetcher())
            self.assertEqual(code, 0)
            self.assertEqual(os.listdir(d), [])
            self.assertEqual(len(summ["planned_queries"]), 4)
            self.assertNotIn(FAKE_KEY, json.dumps(summ))

    def test_caps(self):
        with tempfile.TemporaryDirectory() as d:
            code, summ = sr.run(args(d, dry_run=True, max_queries=99, max_pages=99), env={})
            self.assertEqual(summ["max_queries"], sr.HARD_MAX_QUERIES)
            self.assertEqual(summ["max_pages"], sr.HARD_MAX_PAGES)

    def test_missing_key_without_seed_is_usage_error(self):
        with tempfile.TemporaryDirectory() as d, redirect_stderr(io.StringIO()):
            code, _ = sr.run(args(d), env={}, fetcher=FakeFetcher())
            self.assertEqual(code, 2)
            self.assertEqual(os.listdir(d), [])

    def test_full_run_twice_same_fiche_no_secret(self):
        with tempfile.TemporaryDirectory() as d:
            def serp(engine, q, key, gl="ch", hl="fr"):
                return GOOGLE if engine == "google" else SHOP
            ff = FakeFetcher()
            c1, s1 = sr.run(args(d, subject="Nike Dunk « Panda »"), env={"SERPAPI_API_KEY": FAKE_KEY}, serp=serp, fetcher=ff,
                            now=sr.datetime.datetime.fromisoformat(NOW1))
            self.assertEqual(c1, 0)
            files = [f for f in os.listdir(d) if f.endswith(".md")]
            self.assertEqual(files, ["nike-dunk-panda.md"])
            self.assertLessEqual(len(ff.urls), 3)
            self.assertEqual(len(s1["queries"]), 4)
            c2, s2 = sr.run(args(d, subject="nike dunk   panda"), env={"SERPAPI_API_KEY": FAKE_KEY}, serp=serp, fetcher=ff,
                            now=sr.datetime.datetime.fromisoformat(NOW2))
            self.assertEqual(s2["new_facts"], 0)
            self.assertEqual(s2["runs"], 2)
            self.assertEqual([f for f in os.listdir(d) if f.endswith(".md")], ["nike-dunk-panda.md"])
            with open(os.path.join(d, "nike-dunk-panda.md"), encoding="utf-8") as fh:
                md = fh.read()
            self.assertEqual(md.count("\n### 2026-"), 2)
            self.assertNotIn(FAKE_KEY, md)
            self.assertNotIn(FAKE_KEY, json.dumps(s1) + json.dumps(s2))
            with open(os.path.join(d, "log.jsonl")) as fh:
                self.assertNotIn(FAKE_KEY, fh.read())

    def test_auth_refusal_stops_and_masks(self):
        with tempfile.TemporaryDirectory() as d:
            n = []

            def serp(*a, **k):
                n.append(1)
                raise sr.SerpAuthError(f"serpapi HTTP 401 key {FAKE_KEY}")
            code, summ = sr.run(args(d), env={"SERPAPI_API_KEY": FAKE_KEY}, serp=serp, fetcher=FakeFetcher())
            self.assertEqual(code, 3)
            self.assertEqual(len(n), 1)
            with open(os.path.join(d, "nike-dunk-panda.md"), encoding="utf-8") as fh:
                self.assertNotIn(FAKE_KEY, fh.read())

    def test_seed_urls_work_without_key(self):
        with tempfile.TemporaryDirectory() as d:
            ff = FakeFetcher()
            code, summ = sr.run(args(d, seed_url=["https://shop-d.com/x"]), env={}, fetcher=ff)
            self.assertEqual(code, 0)
            self.assertEqual(ff.urls, ["https://shop-d.com/x"])
            self.assertEqual(summ["queries"], [])


if __name__ == "__main__":
    unittest.main()
