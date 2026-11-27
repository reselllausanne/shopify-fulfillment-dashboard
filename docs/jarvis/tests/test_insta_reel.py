"""Run: python3 -m unittest discover -s docs/jarvis/tests -v  (stdlib only: no network, no browser)."""
import io, json, os, sys, tempfile, unittest
from contextlib import redirect_stderr, redirect_stdout

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "bin"))
import insta_reel as ir
import jarvis_web as jw

MEDIA = {"__typename": "XIGPolarisVideoMedia", "pk": "1", "code": "ABCde12345", "if_not_gated_logged_out": {
    "user": {"pk": "9", "username": "shoeshop"}, "taken_at": 1745774306, "product_type": "clips", "like_count": 1631,
    "comment_count": 60, "caption": {"text": "New Dunk Panda drop #kicks #Resell @nike @shoeshop_ch\nShop: https://l.instagram.com/?u=https%3A%2F%2Fwww.nike.com%2Ft%2Fdunk-low%3Futm_source%3Dig&e=1 and mystore.ch/products/dunk"},
    "accessibility_caption": "Video by Shoe Shop on April 27, 2025.", "usertags": {"in": [{"user": {"username": "nikestore"}}]},
    "coauthor_producers": [{"username": "collab_acc"}], "location": {"name": "Lausanne"},
    "clips_metadata": {"music_info": {"music_asset_info": {"title": "Song", "display_artist": "Artist"}}}},
    "comments_connection": {"edges": [{"node": {"text": "Trop beau", "user": {"username": "fan1"}, "comment_like_count": 2}}]}}
PAGE = ('<html><head><meta property="og:title" content="Shoe Shop on Instagram: &quot;New Dunk Panda drop&quot;">'
        '<meta property="og:description" content="1,631 likes, 60 comments - shoeshop on April 27, 2025: &quot;New Dunk Panda drop&quot;.">'
        '</head><body><a href="https://l.instagram.com/?u=https%3A%2F%2Flinktr.ee%2Fshoeshop&e=1">bio</a>'
        '<a href="https://www.threads.com/">t</a><script type="application/json">{"x":{"xig_polaris_media":' + json.dumps(MEDIA) + '}}</script></body></html>')


class UrlTest(unittest.TestCase):
    def test_variants(self):
        for u, kind in [("https://www.instagram.com/reel/ABCde12345/?igsh=zz", "reel"), ("http://instagram.com/p/ABCde12345", "post"),
                        ("https://www.instagram.com/someuser/reel/ABCde12345/", "reel"), ("https://www.instagram.com/tv/ABCde12345/", "tv")]:
            k, code, canon = ir.parse_ig_url(u)
            self.assertEqual((k, code), (kind, "ABCde12345"))
            self.assertNotIn("?", canon)

    def test_rejects(self):
        for u in ["https://example.com/reel/ABCde12345/", "https://www.instagram.com/someuser/", "javascript:alert(1)",
                  "https://instagram.com.evil.com/p/ABCde12345/"]:
            with self.assertRaises(ValueError):
                ir.parse_ig_url(u)


class ParseTest(unittest.TestCase):
    def test_hashtags_mentions_links(self):
        t = "Drop #kicks #resell #kicks #été2026 mail a@b.com @nike @nike.ch see (https://x.com/a?utm_source=ig&id=3) #123 #1st"
        self.assertEqual(jw.extract_hashtags(t), ["kicks", "resell", "été2026", "1st"])
        self.assertEqual(jw.extract_mentions(t), ["nike", "nike.ch"])
        self.assertIn("https://x.com/a?id=3", jw.extract_urls(t))

    def test_unwrap_and_bare_domain(self):
        self.assertEqual(jw.unwrap_redirect("https://l.instagram.com/?u=https%3A%2F%2Fa.com%2Fp&e=1"), "https://a.com/p")
        self.assertIn("https://mystore.ch/products/dunk", jw.extract_urls("go mystore.ch/products/dunk now"))
        self.assertNotIn("https://b.com", jw.extract_urls("write to a@b.com"))

    def test_embedded_full_result(self):
        r = ir.build_result("https://www.instagram.com/reel/ABCde12345/", PAGE, "Log In\nSign Up\n")
        self.assertEqual(r["account"], "shoeshop")
        self.assertEqual(r["author_name"], "Shoe Shop")
        self.assertEqual((r["likes"], r["comments_count"]), (1631, 60))
        self.assertEqual(r["hashtags"], ["kicks", "Resell"])
        self.assertEqual(r["mentions"], ["nike", "shoeshop_ch"])
        self.assertEqual(r["music"], "Artist - Song")
        self.assertEqual(r["tagged_accounts"], ["nikestore"])
        self.assertEqual(r["location"], "Lausanne")
        self.assertIn("https://www.nike.com/t/dunk-low", r["links"]["product"])
        self.assertIn("https://mystore.ch/products/dunk", r["links"]["product"])
        self.assertEqual(r["links"]["link_hub"], ["https://linktr.ee/shoeshop"])
        self.assertEqual(r["links"]["other"], [])
        self.assertIn("nikestore", r["brand_candidates"]["accounts"])
        self.assertNotIn("shoeshop", r["brand_candidates"]["accounts"])
        self.assertIn("Nike", r["brand_candidates"]["named"])
        self.assertEqual(r["top_comments"][0]["account"], "fan1")
        self.assertEqual(r["extracted_via"], ["embedded_json", "og_meta"])
        self.assertFalse(r["login_wall"])

    def test_og_fallback(self):
        html = PAGE.split("<script")[0] + "</body></html>"
        r = ir.build_result("https://www.instagram.com/reel/ABCde12345/", html, "")
        self.assertEqual((r["account"], r["caption"], r["likes"]), ("shoeshop", "New Dunk Panda drop", "1,631"))
        self.assertEqual(r["extracted_via"], ["og_meta"])

    def test_login_wall_reported_not_faked(self):
        html = '<html><meta property="og:title" content="Instagram"><meta name="description" content="Create an account or log in to Instagram"></html>'
        r = ir.build_result("https://www.instagram.com/reel/ABCde12345/", html, "Log into Instagram\nMobile number\nSign up\nLog in")
        self.assertTrue(r["login_wall"])
        self.assertEqual(r["caption"], "")
        self.assertIsNone(r["account"])

    def test_cli_from_html_and_exit_codes(self):
        with tempfile.TemporaryDirectory() as d:
            f = os.path.join(d, "p.html")
            with open(f, "w") as fh:
                fh.write(PAGE)
            out, err = io.StringIO(), io.StringIO()
            with redirect_stdout(out), redirect_stderr(err):
                code = ir.main(["https://www.instagram.com/reel/ABCde12345/", "--from-html", f])
            self.assertEqual(code, 0)
            self.assertEqual(json.loads(out.getvalue())["account"], "shoeshop")
            with redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
                self.assertEqual(ir.main(["https://example.com/x"]), 2)
            with open(f, "w") as fh:
                fh.write("<html><title>Instagram</title><body>Log into Instagram Sign up Log in</body></html>")
            with redirect_stdout(io.StringIO()):
                self.assertEqual(ir.main(["https://www.instagram.com/reel/ABCde12345/", "--from-html", f]), 3)

    def test_text_render(self):
        r = ir.build_result("https://www.instagram.com/reel/ABCde12345/", PAGE, "")
        t = ir.render_text(r)
        self.assertIn("@shoeshop", t)
        self.assertIn("#kicks", t)


class SafetyTest(unittest.TestCase):
    def test_mask(self):
        os.environ["SERPAPI_API_KEY"] = "sk_test_1234567890"
        try:
            m = jw.mask("GET https://serpapi.com/search.json?q=a&api_key=sk_test_1234567890 failed; key sk_test_1234567890")
            self.assertNotIn("1234567890", m)
            self.assertNotIn("user:pa55", jw.mask("http://user:pa55@proxy:8080"))
        finally:
            del os.environ["SERPAPI_API_KEY"]

    def test_private_urls_refused(self):
        for u in ["http://127.0.0.1/x", "http://localhost/x", "http://169.254.169.254/latest/meta-data", "file:///etc/passwd", "ftp://a.com/x"]:
            with self.assertRaises(jw.FetchError):
                jw.check_public_url(u)

    def test_log_strips_query_and_secrets(self):
        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, "l.jsonl")
            jw.log_visit(p, "t", "https://www.instagram.com/reel/ABC/?igsh=SECRETTOKEN", outcome="error", error="boom api_key=abcdef123456")
            with open(p) as fh:
                s = fh.read()
            self.assertNotIn("SECRETTOKEN", s)
            self.assertNotIn("abcdef123456", s)

    def test_http_retry_caps(self):
        calls = []

        def op(req, timeout=None):
            calls.append(1)
            raise jw.urllib.error.URLError("down")
        orig = jw.check_public_url
        jw.check_public_url = lambda u: None
        try:
            with self.assertRaises(jw.FetchError):
                jw.http_get("https://example.com/", opener=op, sleep=lambda s: None)
            self.assertEqual(len(calls), jw.MAX_ATTEMPTS)
            calls.clear()

            def op403(req, timeout=None):
                calls.append(1)
                raise jw.urllib.error.HTTPError(req.full_url, 403, "no", {}, None)
            with self.assertRaises(jw.AntiBotError):
                jw.http_get("https://example.com/", opener=op403, sleep=lambda s: None)
            self.assertEqual(len(calls), 1)
        finally:
            jw.check_public_url = orig


if __name__ == "__main__":
    unittest.main()
