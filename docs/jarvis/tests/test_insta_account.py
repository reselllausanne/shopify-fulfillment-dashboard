"""Run: python3 -m unittest discover -s docs/jarvis/tests -v  (stdlib only: no network, no browser, no ffmpeg/tesseract needed)."""
import argparse, datetime, io, json, os, sys, tempfile, unittest, urllib.error
from contextlib import redirect_stderr

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "bin"))
import insta_account as ia
import insta_reel as ir
import jarvis_web as jw

NOW1, NOW2 = "2026-11-28T10:00:00+01:00", "2026-11-29T10:00:00+01:00"
HANDLE = "demo.account"
CAPTIONS = {
    "AAAAAAAAA01": ("Comment \"AGENT\" and I send you the free training. Link in bio. Build your business with AI agents?", 1760000000),
    "AAAAAAAAA02": ("DM me BUILD to get started with your AI agent business https://demo.example/offer", 1759000000),
    "AAAAAAAAA03": ("🏝️🎥", 1758000000),
    "AAAAAAAAA04": ("Sunset ride", 1757000000),
}


def embed_html(handle=HANDLE, posts=CAPTIONS, followers=47486):
    ctx = {"context": {"username": handle, "full_name": "Demo Account", "followers_count": followers, "posts_count": 10,
                       "graphql_media": [{"shortcode_media": {"__typename": "GraphVideo", "shortcode": c, "is_video": True, "taken_at_timestamp": ts,
                                                              "edge_media_to_caption": {"edges": [{"node": {"text": cap}}]},
                                                              "edge_liked_by": {"count": 100}, "edge_media_to_comment": {"count": 10},
                                                              "coauthor_producers": [{"username": "friend.one"}]}}
                                         for c, (cap, ts) in posts.items()]}}
    inner = json.dumps(ctx)
    return '<html><script>x={"isProfileEmbed":true,"contextJSON":' + json.dumps(inner) + '}</script></html>'


def post_html(code, handle=HANDLE, caption=None, login=False):
    cap = caption if caption is not None else CAPTIONS[code][0]
    if login:
        return "<html><title>Instagram</title></html>"
    m = {"code": code, "if_not_gated_logged_out": {"user": {"username": handle}, "taken_at": CAPTIONS.get(code, ("", 1700000000))[1], "product_type": "clips",
                                                     "like_count": 120, "comment_count": 12, "caption": {"text": cap},
                                                     "accessibility_caption": "Video by Demo Account on January 1, 2026. May be an image of motorcycle and text.",
                                                     "usertags": {"in": []}, "coauthor_producers": [{"username": "friend.one"}],
                                                     "video_versions": [{"url": "https://scontent-x.cdninstagram.com/v/a.mp4"}]},
         "comments_connection": {"edges": []}}
    return '<html><script>{"xig_polaris_media":' + json.dumps(m) + '}</script></html>'


def page_fetcher(blocked=(), wrong_handle=()):
    calls = []

    def f(url):
        calls.append(url)
        if "/embed/" in url:
            return {"html": embed_html(), "text": "", "status": 200, "bytes": 1000, "capped": False, "final_url": url}
        code = url.rstrip("/").split("/")[-1]
        if code in blocked:
            return {"html": post_html(code, login=True), "text": "Log into Instagram Sign up Log in", "status": 200, "bytes": 1000, "capped": False, "final_url": url}
        return {"html": post_html(code, handle="other.person" if code in wrong_handle else HANDLE), "text": "", "status": 200, "bytes": 1000, "capped": False, "final_url": url}
    f.calls = calls
    return f


def fake_visual(items, env, tools, budget, cap, log):
    return {"status": "ok", "reason": None, "media": [], "ocr_lines": ["SCREEN TEXT"], "vision_model": ia.vision_status(env), "confidence": "incertain"}


def args(out, **kw):
    base = dict(handle=HANDLE, limit=12, urls_file=None, seed_urls=None, from_embed=None, no_visual=False, dry_run=False, engine="camoufox",
                page_mb=6.0, max_total_mb=60.0, max_video_mb=25.0, refresh_visual=False, out_dir=out, log=os.path.join(out, "log.jsonl"), text=False)
    base.update(kw)
    return argparse.Namespace(**base)


TOOLS = {"ffmpeg": True, "ffprobe": True, "tesseract": True, "ocr_lang": "eng"}


def deps(fetch=None, visual=fake_visual):
    return {"fetch_page": fetch or page_fetcher(), "analyze_media": visual, "tools": TOOLS}


class HandleTest(unittest.TestCase):
    def test_valid(self):
        for raw, exp in [("blakeestephens", "blakeestephens"), ("@Blake.E_Stephens", "blake.e_stephens"), ("https://www.instagram.com/some_user/", "some_user"),
                         ("a", "a"), ("__x__", "__x__")]:
            self.assertEqual(ia.validate_handle(raw), exp)

    def test_injection_and_garbage_rejected(self):
        for raw in ["", "../etc/passwd", "a/b", "a?x=1", "a#f", "a b", "a..b", ".a", "a.", "a" * 31, "accounts", "reel", "é", "a;rm", "a\nb", "a%2f", "..", "...",
                    "http://evil.com/user", "https://www.instagram.com/p/abc/", "https://www.instagram.com/", "https://instagram.com.evil.com/u/", "javascript:alert(1)"]:
            with self.assertRaises(ValueError, msg=raw):
                ia.validate_handle(raw)

    def test_post_refs(self):
        self.assertEqual(ia.normalize_post_ref("https://www.instagram.com/reel/DgQ6DimIP_s/?igsh=x")[1], "DgQ6DimIP_s")
        self.assertEqual(ia.normalize_post_ref("DgQ6DimIP_s")[0], "https://www.instagram.com/p/DgQ6DimIP_s/")
        for bad in ["https://example.com/p/abcde/", "http://127.0.0.1/p/abcde/", "../../x", "ab"]:
            with self.assertRaises(ValueError):
                ia.normalize_post_ref(bad)

    def test_refs_file(self):
        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, "u.txt")
            with open(p, "w") as f:
                f.write("# comment\nhttps://www.instagram.com/p/AAAAAAAAA01/\n\nAAAAAAAAA02  # trailing\n")
            self.assertEqual(ia.read_refs_file(p), ["https://www.instagram.com/p/AAAAAAAAA01/", "AAAAAAAAA02"])


class EmbedTest(unittest.TestCase):
    def test_parse(self):
        pe = ia.parse_profile_embed(embed_html())
        self.assertEqual((pe["username"], pe["followers"], pe["posts_count"]), (HANDLE, 47486, 10))
        self.assertEqual([p["shortcode"] for p in pe["posts"]], list(CAPTIONS))
        self.assertEqual(pe["posts"][0]["media_kind"], "video")
        self.assertTrue(pe["posts"][0]["posted_at"].startswith("2025-"))
        self.assertEqual(pe["posts"][0]["coauthors"], ["friend.one"])

    def test_garbage_and_login_page(self):
        self.assertIsNone(ia.parse_profile_embed("<html>Log into Instagram</html>"))
        self.assertIsNone(ia.parse_profile_embed('"contextJSON":"{broken"'))
        bad = embed_html(posts={"x": ("c", 1)})  # shortcode too short -> skipped, not crashed
        self.assertEqual(ia.parse_profile_embed(bad)["posts"], [])


class CtaTest(unittest.TestCase):
    def types(self, t):
        return {c["type"] for c in ia.detect_ctas(t)}

    def test_positive(self):
        self.assertIn("comment_keyword", self.types('Comment "AGENT" below'))
        self.assertIn("comment_keyword", self.types("Comment AGENT and I send it"))
        self.assertIn("comment_keyword", self.types("Commente « IA » en dessous"))
        self.assertIn("dm", self.types("DM me BUILD"))
        self.assertIn("dm", self.types("envoie-moi un DM"))
        self.assertIn("link_in_bio", self.types("Link in bio!"))
        self.assertIn("link_in_bio", self.types("lien en bio"))
        self.assertIn("url_in_caption", self.types("see https://demo.example/offer?utm_source=ig"))
        self.assertIn("url_in_caption", self.types("go to mystore.ch/offer"))
        self.assertIn("lead_magnet", self.types("Get my free training"))
        self.assertIn("book_call", self.types("book a free call"))
        self.assertIn("follow", self.types("Follow me for more"))
        self.assertIn("engagement_question", self.types("What do you think?"))
        self.assertIn("save_share", self.types("Save this for later"))

    def test_keywords_extracted(self):
        c = [x for x in ia.detect_ctas('Comment "AGENT" and comment BUILD') if x["type"] == "comment_keyword"]
        self.assertEqual({x["keyword"] for x in c}, {"AGENT", "BUILD"})

    def test_negative(self):
        for t in ["Comment ça va ?", "‘Insert Caption here’", "🏝️🎥", "Q4", "In motion.", "I comment on things", "message from the team", ""]:
            self.assertNotIn("comment_keyword", self.types(t), t)
            self.assertNotIn("dm", self.types(t), t)
        self.assertEqual(self.types("🏝️🎥"), set())
        self.assertNotIn("url_in_caption", self.types("https://www.instagram.com/p/abc/"))

    def test_structure(self):
        s = ia.caption_structure("Why do agents fail? Because 90% of builders skip step 1.")
        self.assertTrue(s["question_hook"] and s["has_numbers"])
        self.assertEqual(s["length_bucket"], "court (<=8 mots)" if s["words"] <= 8 else "moyenne (9-40)")
        self.assertTrue(ia.caption_structure("🏝️🎥")["emoji_or_symbol_only"])
        self.assertTrue(ia.caption_structure("")["empty"])


class MergeAnalyzeTest(unittest.TestCase):
    def rec(self, code, today="2026-11-28", **kw):
        cap, ts = CAPTIONS[code]
        res = {"caption": cap, "posted_at": datetime.datetime.fromtimestamp(ts, datetime.timezone.utc).isoformat(timespec="seconds"), "likes": 100, "comments_count": 10,
               "alt_text": "Video by Demo on January 1, 2026. May be an image of motorcycle and text.", "extracted_via": ["embedded_json"], "login_wall": False,
               "coauthors": ["friend.one"], "tagged_accounts": [], "links": {"product": [], "link_hub": [], "other": []}, "top_comments": []}
        res.update(kw)
        return ia.build_post_record(code, f"https://www.instagram.com/p/{code}/", HANDLE, res, None, None, today)

    def test_merge_idempotent_by_id(self):
        a = self.rec("AAAAAAAAA01")
        b = ia.merge_record(a, self.rec("AAAAAAAAA01", today="2026-11-29"))
        self.assertEqual((b["first_seen"], b["last_seen"], b["runs"]), ("2026-11-28", "2026-11-29", 2))
        self.assertEqual(len(b["engagement_history"]), 1)  # unchanged counts: no new history row
        c = ia.merge_record(b, self.rec("AAAAAAAAA01", today="2026-11-30", likes=150))
        self.assertEqual(len(c["engagement_history"]), 2)
        self.assertEqual(c["likes"], 150)

    def test_merge_keeps_old_visual_when_new_skipped(self):
        a = self.rec("AAAAAAAAA01")
        a["visual"] = {"status": "ok", "ocr_lines": ["X"], "media": []}
        b = self.rec("AAAAAAAAA01", today="2026-11-29")
        self.assertEqual(ia.merge_record(a, b)["visual"]["status"], "ok")

    def test_no_signed_urls_kept(self):
        r = self.rec("AAAAAAAAA01", _media=[{"type": "video", "versions": [{"url": "https://scontent-x.cdninstagram.com/v/secret.mp4?oh=SIGNED"}]}])
        self.assertNotIn("SIGNED", json.dumps(r))

    def test_analysis_claims_sourced_and_split(self):
        posts = [self.rec(c) for c in CAPTIONS]
        an = ia.analyze_account(posts, {"followers": 47486, "full_name": "Demo Account"})
        texts_c = [c["text"] for c in an["confirmed"]]
        texts_u = [c["text"] for c in an["uncertain"]]
        self.assertTrue(any("CTA « lien en bio » dans 1/" in t for t in texts_u))  # single post -> uncertain
        self.assertTrue(any(t.startswith("CTA « commenter un mot-clé »") for t in texts_u + texts_c))
        self.assertTrue(any("Vocabulaire d'offre" in t for t in texts_c))  # agent/business in 2 captions
        self.assertTrue(any(t.startswith("Fréquence : 4 posts datés") for t in texts_c))
        for c in an["confirmed"] + an["uncertain"]:
            self.assertTrue(c["posts"])
            self.assertTrue(all(len(x) == 11 for x in c["posts"]))
        self.assertTrue(any("motorcycle" in t for t in texts_u))  # auto alt-text is never confirmed
        self.assertFalse(any("motorcycle" in t for t in texts_c))
        self.assertFalse(any("demo" in t.lower() and "Élément visuel" in t for t in texts_u))  # account name filtered
        self.assertFalse(any(w in t.lower() for t in texts_u for w in ("january", "photo by", "video by")))  # alt-text boilerplate stripped
        self.assertEqual(ia.alt_visual_text("Photo by Blake stephens on November 11, 2026. May be an image of text."), "May be an image of text.")

    def test_no_offer_vocab_reported_honestly(self):
        posts = [self.rec("AAAAAAAAA03"), self.rec("AAAAAAAAA04")]
        an = ia.analyze_account(posts)
        self.assertTrue(any(c["text"].startswith("Aucun vocabulaire d'offre") for c in an["confirmed"]))
        brief = " ".join(ia.strategy_brief(an))
        self.assertIn("Offre / business", brief)

    def test_frequency_needs_three_for_confirmed(self):
        two = ia.analyze_account([self.rec("AAAAAAAAA01"), self.rec("AAAAAAAAA02")])
        self.assertTrue(any("Fréquence : 2 posts datés" in c["text"] for c in two["uncertain"]))
        self.assertFalse(any("posts datés" in c["text"] for c in two["confirmed"]))

    def test_render_summary_sections_and_journal(self):
        posts = [self.rec(c) for c in CAPTIONS]
        an = ia.analyze_account(posts)
        md = ia.render_summary(HANDLE, posts, an, {"followers": 1, "posts_count": 2, "seen": "2026-11-28"}, ["### 2026-11-28\n\n- mode : x"], NOW1, TOOLS)
        for h in ["## Stratégie en bref", "## Confirmé", "## Incertain", "## Posts analysés", "## Limites et non testé", "## Journal"]:
            self.assertIn(h, md)
        self.assertEqual(ia.parse_journal(md), ["### 2026-11-28\n\n- mode : x"])


class DownloadTest(unittest.TestCase):
    class R(io.BytesIO):
        def __init__(self, data, clen=None):
            super().__init__(data)
            self.headers = {"Content-Length": str(clen if clen is not None else len(data))}

        def __enter__(self):
            return self

        def __exit__(self, *a):
            pass

    def setUp(self):
        self._orig = jw.check_public_url
        jw.check_public_url = lambda u: None

    def tearDown(self):
        jw.check_public_url = self._orig

    def test_host_allowlist(self):
        for u in ["https://evil.example.com/a.mp4", "http://127.0.0.1/a.mp4", "https://cdninstagram.com.evil.com/a.mp4", "file:///etc/passwd"]:
            with self.assertRaises(jw.FetchError):
                ia.download_capped(u, 1000, os.devnull, "video", opener=lambda *a, **k: self.R(b"x"))

    def test_cap_enforced_both_ways(self):
        with self.assertRaises(ia.TooLarge):
            ia.download_capped("https://scontent-x.cdninstagram.com/a.mp4", 100, os.devnull, "video", opener=lambda *a, **k: self.R(b"x" * 500))
        with self.assertRaises(ia.TooLarge):  # lying Content-Length: body still capped
            ia.download_capped("https://scontent-x.cdninstagram.com/a.mp4", 100, os.devnull, "video", opener=lambda *a, **k: self.R(b"x" * 500, clen=10))
        self.assertEqual(ia.download_capped("https://scontent-x.cdninstagram.com/a.mp4", 1000, os.devnull, "video", opener=lambda *a, **k: self.R(b"abc")), b"abc")

    def test_retry_rules_and_log_hides_path(self):
        calls = []

        def down(req, timeout=None):
            calls.append(1)
            raise urllib.error.URLError("down")
        with tempfile.TemporaryDirectory() as d:
            log = os.path.join(d, "l.jsonl")
            with self.assertRaises(jw.FetchError):
                ia.download_capped("https://scontent-x.cdninstagram.com/v/SIGNEDPATH.mp4?oh=Q", 100, log, "video", opener=down, sleep=lambda s: None)
            self.assertEqual(len(calls), jw.MAX_ATTEMPTS)
            calls.clear()

            def forbidden(req, timeout=None):
                calls.append(1)
                raise urllib.error.HTTPError(req.full_url, 403, "no", {}, None)
            with self.assertRaises(jw.FetchError):
                ia.download_capped("https://scontent-x.cdninstagram.com/v/SIGNEDPATH.mp4", 100, log, "video", opener=forbidden, sleep=lambda s: None)
            self.assertEqual(len(calls), 1)
            with open(log) as fh:
                s = fh.read()
            self.assertNotIn("SIGNEDPATH", s)
            self.assertNotIn("oh=Q", s)


class VisualTest(unittest.TestCase):
    def test_vision_status_never_calls_api(self):
        self.assertEqual(ia.vision_status({})["status"], "not_configured")
        v = ia.vision_status({"OPENAI_API_KEY": "sk-should-not-appear-123456"})
        self.assertEqual(v["status"], "key_present_not_used")
        self.assertNotIn("sk-should", json.dumps(v))

    def test_tsv_confidence_filter(self):
        tsv = "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n" \
              "5\t1\t1\t1\t1\t1\t0\t0\t1\t1\t95\tBuild\n5\t1\t1\t1\t1\t2\t0\t0\t1\t1\t91\tagents\n5\t1\t1\t1\t2\t1\t0\t0\t1\t1\t20\tXqzzz\n5\t1\t1\t1\t3\t1\t0\t0\t1\t1\t90\tWSs\n"
        self.assertEqual(ia.parse_tsv_lines(tsv), ["Build agents"])

    def test_analyze_media_video_frames_ocr(self):
        runs = []

        def run(cmd, timeout):
            runs.append(cmd[0])
            if cmd[0] == "ffprobe":
                return type("R", (), {"stdout": "10.0"})()
            if cmd[0] == "ffmpeg":
                open(cmd[-1], "wb").write(b"png")
                return type("R", (), {"stdout": ""})()
            return type("R", (), {"stdout": "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n5\t1\t1\t1\t1\t1\t0\t0\t1\t1\t96\tFREE TRAINING\n"})()
        items = [{"type": "video", "versions": [{"url": "https://scontent-x.cdninstagram.com/v/a.mp4"}]}]
        r = ia.analyze_media(items, {}, TOOLS, ia.Budget(10_000_000), 1_000_000, os.devnull, dl=lambda *a, **k: b"video-bytes", run=run)
        self.assertEqual(r["status"], "ok")
        self.assertEqual(r["media"][0]["frames"], 4)
        self.assertEqual(r["ocr_lines"], ["FREE TRAINING"])
        self.assertEqual(r["confidence"], "incertain")
        self.assertEqual(r["vision_model"]["status"], "not_configured")

    def test_missing_tools_and_failures_marked(self):
        items = [{"type": "video", "versions": [{"url": "https://scontent-x.cdninstagram.com/v/a.mp4"}]}]
        self.assertEqual(ia.analyze_media(items, {}, {"ffmpeg": False, "tesseract": False}, ia.Budget(1000), 100, os.devnull)["status"], "skipped")
        self.assertEqual(ia.analyze_media([], {}, TOOLS, ia.Budget(1000), 100, os.devnull)["status"], "skipped")

        def too_big(*a, **k):
            raise ia.TooLarge("x")
        r = ia.analyze_media(items, {}, TOOLS, ia.Budget(10_000_000), 100, os.devnull, dl=too_big)
        self.assertEqual(r["status"], "failed")
        self.assertIn("too large", r["reason"])

    def test_budget_exhausted_stops_downloads(self):
        n = []
        items = [{"type": "image", "versions": [{"url": "https://scontent-x.cdninstagram.com/v/a.jpg"}]}] * 3
        ia.analyze_media(items, {}, TOOLS, ia.Budget(0), 100, os.devnull, dl=lambda *a, **k: n.append(1) or b"x")
        self.assertEqual(n, [])


class RunTest(unittest.TestCase):
    def test_dry_run_no_network_no_files(self):
        with tempfile.TemporaryDirectory() as d:
            out = os.path.join(d, "o")
            code, s = ia.run(args(out, dry_run=True), env={"JARVIS_PROXY_URL": "http://u:p4ss@proxy:1"}, deps={"tools": TOOLS})
            self.assertEqual(code, 0)
            self.assertFalse(os.path.exists(out))
            self.assertNotIn("p4ss", json.dumps(s))

    def test_bad_handle_before_any_url(self):
        with tempfile.TemporaryDirectory() as d, redirect_stderr(io.StringIO()):
            f = page_fetcher()
            code, s = ia.run(args(d, handle="../../etc"), env={}, deps=deps(f))
            self.assertEqual((code, s, f.calls), (2, None, []))

    def test_full_run_then_idempotent_rerun(self):
        with tempfile.TemporaryDirectory() as d:
            out = os.path.join(d, HANDLE)
            c1, s1 = ia.run(args(out), env={}, now=datetime.datetime.fromisoformat(NOW1), deps=deps())
            self.assertEqual((c1, s1["posts_processed"], s1["posts_total"]), (0, 4, 4))
            files = sorted(os.listdir(out))
            self.assertEqual([f for f in files if f.endswith(".json") and f.startswith("AAAA")], [c + ".json" for c in sorted(CAPTIONS)])
            self.assertIn("resume-compte.md", files)
            with open(os.path.join(out, "AAAAAAAAA01.json"), encoding="utf-8") as fh:
                rec = json.load(fh)
            self.assertEqual(rec["handle"], HANDLE)
            self.assertEqual(rec["visual"]["ocr_lines"], ["SCREEN TEXT"])
            self.assertEqual(rec["transcript"]["status"], "unavailable")
            c2, s2 = ia.run(args(out), env={}, now=datetime.datetime.fromisoformat(NOW2), deps=deps())
            self.assertEqual(s2["posts_total"], 4)
            self.assertEqual(len([f for f in os.listdir(out) if f.endswith(".json") and f.startswith("AAAA")]), 4)
            with open(os.path.join(out, "AAAAAAAAA01.json"), encoding="utf-8") as fh:
                rec2 = json.load(fh)
            self.assertEqual((rec2["first_seen"], rec2["last_seen"], rec2["runs"]), ("2026-11-28", "2026-11-29", 2))
            with open(os.path.join(out, "resume-compte.md"), encoding="utf-8") as fh:
                md = fh.read()
            self.assertEqual(md.count("\n### 2026-"), 2)
            self.assertEqual(md.count("| [AAAAAAAAA01]"), 1)

    def test_visual_reused_unless_refresh(self):
        with tempfile.TemporaryDirectory() as d:
            n = []

            def vis(*a, **k):
                n.append(1)
                return fake_visual(*a)
            ia.run(args(d), env={}, deps=deps(visual=vis))
            self.assertEqual(len(n), 4)
            ia.run(args(d), env={}, deps=deps(visual=vis))
            self.assertEqual(len(n), 4)  # reused
            ia.run(args(d, refresh_visual=True), env={}, deps=deps(visual=vis))
            self.assertEqual(len(n), 8)

    def test_limit_and_cap(self):
        with tempfile.TemporaryDirectory() as d:
            f = page_fetcher()
            _, s = ia.run(args(d, limit=2), env={}, deps=deps(f))
            self.assertEqual(s["posts_processed"], 2)
            self.assertEqual(len([c for c in f.calls if "/p/" in c]), 2)
            _, s = ia.run(args(d, limit=999, dry_run=True), env={}, deps=deps(f))
            self.assertEqual(s["limit"], ia.HARD_MAX_LIMIT)

    def test_two_consecutive_blocks_stop_fetching(self):
        with tempfile.TemporaryDirectory() as d:
            blocked = set(CAPTIONS)
            f = page_fetcher(blocked=blocked)
            code, s = ia.run(args(d), env={}, deps=deps(f))
            self.assertEqual(len([c for c in f.calls if "/p/" in c]), 2)  # stopped after 2 login walls
            self.assertEqual(len(s["blocked_posts"]), 4)
            self.assertEqual(s["posts_processed"], 4)  # embed stubs still recorded, marked embed_only
            with open(os.path.join(d, "AAAAAAAAA01.json"), encoding="utf-8") as fh:
                self.assertEqual(json.load(fh)["page_status"], "embed_only")

    def test_foreign_account_post_skipped(self):
        with tempfile.TemporaryDirectory() as d:
            f = page_fetcher(wrong_handle={"AAAAAAAAA02"})
            _, s = ia.run(args(d), env={}, deps=deps(f))
            self.assertFalse(os.path.exists(os.path.join(d, "AAAAAAAAA02.json")))
            self.assertTrue(any("not @" in e for e in s["errors"]))

    def test_seed_urls_mode_skips_embed(self):
        with tempfile.TemporaryDirectory() as d:
            f = page_fetcher()
            _, s = ia.run(args(d, seed_urls=["https://www.instagram.com/reel/AAAAAAAAA01/", "AAAAAAAAA02"]), env={}, deps=deps(f))
            self.assertFalse(any("/embed/" in c for c in f.calls))
            self.assertEqual((s["mode"], s["posts_processed"]), ("seed-urls", 2))

    def test_embed_login_redirect_reported(self):
        with tempfile.TemporaryDirectory() as d:
            def fetch(url):
                return {"html": "<html>login</html>", "text": "", "status": 200, "bytes": 10, "capped": False, "final_url": "https://www.instagram.com/accounts/login/?next=x"}
            code, s = ia.run(args(d), env={}, deps=deps(fetch))
            self.assertEqual(code, 3)
            self.assertTrue(any("login" in e for e in s["errors"]))
            self.assertEqual(os.listdir(d), [])

    def test_embed_username_mismatch(self):
        with tempfile.TemporaryDirectory() as d:
            def fetch(url):
                return {"html": embed_html(handle="someone.else"), "text": "", "status": 200, "bytes": 10, "capped": False, "final_url": url}
            code, s = ia.run(args(d), env={}, deps=deps(fetch))
            self.assertEqual(code, 3)

    def test_secrets_never_written(self):
        with tempfile.TemporaryDirectory() as d:
            env = {"JARVIS_PROXY_URL": "http://user:SuperSecretPw@proxy.example:8080", "OPENAI_API_KEY": "sk-LEAKCHECK-123456789"}
            os.environ.update(env)
            try:
                ia.run(args(d), env=env, deps=deps())
                blob = ""
                for root, _, fs in os.walk(d):
                    for fn in fs:
                        with open(os.path.join(root, fn), encoding="utf-8") as fh:
                            blob += fh.read()
                self.assertNotIn("SuperSecretPw", blob)
                self.assertNotIn("LEAKCHECK", blob)
            finally:
                for k in env:
                    os.environ.pop(k, None)

    def test_budget_exhaustion_stops_pages(self):
        with tempfile.TemporaryDirectory() as d:
            f = page_fetcher()

            def fetch(url):
                r = f(url)
                r["bytes"] = 5_000_000
                return r
            code, s = ia.run(args(d, max_total_mb=3), env={}, deps=deps(fetch))
            self.assertEqual([c for c in f.calls if "/p/" in c], [])  # embed alone exceeded the total cap
            self.assertTrue(any("budget" in e for e in s["errors"]))


if __name__ == "__main__":
    unittest.main()
