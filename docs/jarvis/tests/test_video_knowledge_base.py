"""Run: python3 -m unittest discover -s docs/jarvis/tests -v  (stdlib only: no network, no browser, no YouTube API)."""
import argparse, datetime, io, json, os, sys, tempfile, unittest
from contextlib import redirect_stderr

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "bin"))
import jarvis_web as jw
import subject_research as sr
import video_knowledge_base as kb
import youtube_video as yv

FAKE_KEY = "FAKEYT_do_not_leak_987654"
NOW1, NOW2 = "2026-11-27T10:00:00+01:00", "2026-11-28T10:00:00+01:00"
BASE_ID, C1, C2, C3 = "baseVIDEO01", "candVIDEO01", "candVIDEO02", "candVIDEO03"


def rec(vid, title, channel, subs, views, desc="", created=None, tags=(), published="2026-11-01"):
    return {"video_id": vid, "url": f"https://www.youtube.com/watch?v={vid}", "title": title, "channel_name": channel, "channel_id": "UC" + channel,
            "subscribers": subs, "channel_created": created, "published_at": published, "views": views, "duration_seconds": 600,
            "description": desc, "tags": list(tags), "source": "watch_page", "notes": [], "_tracks": [],
            "transcript": {"status": "skipped", "reason": "x", "lang": None, "kind": None, "segments": 0, "text": ""}}


DESC = ("Nike outlet prices on Jordan sneakers at the factory store. We compare outlet discounts and stacked promotions. "
        "The outlet back wall has the best Jordan prices every week. Always check the price tag before buying sneakers at the outlet.")
RECS = {
    BASE_ID: rec(BASE_ID, "Nike Outlet Jordan deals", "Base Channel", 125000, 36000, DESC),
    C1: rec(C1, "Jordan sneakers at the Nike factory store outlet", "Channel One", 400000, 900000, DESC, created="2014-01-01"),
    C2: rec(C2, "Outlet sneaker prices and Nike discounts", "Channel Two", 50000, 40000, DESC),
    C3: rec(C3, "Cooking pasta at home", "Chef", 2000000, 5000000, "pasta tomato basil recipe"),
}


def fake_get_video(calls):
    def f(url, env=None, want_transcript=True, langs=("fr", "en"), log=None, **k):
        vid, _ = yv.parse_video_url(url)
        calls.append((vid, want_transcript))
        r = json.loads(json.dumps(RECS[vid]))
        return r
    return f


def fake_ensure(calls):
    def f(r, langs=("fr", "en"), log=None, http=None):
        calls.append(r["video_id"])
        r["transcript"] = {"status": "unavailable", "reason": "test: empty timedtext", "lang": None, "kind": None, "segments": 0, "text": ""}
        return r["transcript"]
    return f


def args(out, **kw):
    base = dict(url=f"https://www.youtube.com/watch?v={BASE_ID}", seed_urls=[f"https://www.youtube.com/watch?v={C1}", f"https://youtu.be/{C2}", f"https://youtu.be/{C3}"],
                list_only=False, dry_run=False, min_score=50.0, min_overlap=2, max_queries=2, max_candidates=10, max_videos=5, keywords=8,
                summary_sentences=3, lang="fr,en", subject=None, out_dir=out, log=os.path.join(out, "log.jsonl"), text=False, trust_seeds=False)
    base.update(kw)
    return argparse.Namespace(**base)


class KeywordTest(unittest.TestCase):
    def test_rules(self):
        kws = kb.extract_keywords("Nike Outlet Jordan deals", DESC, ["nike"], "", 8, exclude=["Base Channel"])
        words = [k for k, _ in kws]
        self.assertIn("outlet", words)
        self.assertIn("jordan", words)
        self.assertIn("nike", words)
        self.assertNotIn("the", words)
        self.assertNotIn("sneakers", words)  # plural folded
        self.assertIn("sneaker", words)
        self.assertEqual(kws, sorted(kws, key=lambda x: (-x[1], x[0])) if all(" " not in w for w in words) else kws)

    def test_possessive_stopwords_urls_excluded(self):
        kws = [k for k, _ in kb.extract_keywords("Jordan's best", "https://spam.example/video subscribe now 12 2026 #jordan", [], "", 8, exclude=["spamchannel"])]
        self.assertIn("jordan", kws)
        self.assertNotIn("spam", kws)
        self.assertNotIn("subscribe", kws)
        self.assertNotIn("12", kws)

    def test_deterministic(self):
        a = kb.extract_keywords("Nike Outlet Jordan deals", DESC, [], "", 8)
        self.assertEqual(a, kb.extract_keywords("Nike Outlet Jordan deals", DESC, [], "", 8))

    def test_overlap(self):
        kws = kb.extract_keywords("Nike Outlet Jordan deals", DESC, [], "", 8)
        self.assertGreaterEqual(kb.overlap(RECS[C1], kws), 3)
        self.assertEqual(kb.overlap(RECS[C3], kws), 0)


class ScoreTest(unittest.TestCase):
    TODAY = datetime.date(2026, 11, 27)

    def test_anchors(self):
        s, c, b = kb.score_video({"subscribers": 1000, "views": 1000}, self.TODAY)
        self.assertEqual((s, b), (0.0, "subs+views"))
        s, c, b = kb.score_video({"subscribers": 1_000_000, "views": 1_000_000}, self.TODAY)
        self.assertEqual(s, 100.0)
        s, c, b = kb.score_video({"subscribers": 1_000_000, "views": 1_000_000, "channel_created": "2018-11-27"}, self.TODAY)
        self.assertEqual(b, "age+subs+views")
        self.assertAlmostEqual(c["age"], 20 * 8 / 8, delta=0.2)

    def test_unknown_excluded_not_guessed(self):
        s, c, b = kb.score_video({"subscribers": None, "views": 1_000_000}, self.TODAY)
        self.assertEqual((s, b), (100.0, "views"))
        self.assertEqual(kb.score_video({}, self.TODAY), (0.0, {}, "no data"))

    def test_clamps_and_monotonic(self):
        lo = kb.score_video({"subscribers": 5, "views": 3}, self.TODAY)[0]
        hi = kb.score_video({"subscribers": 9e9, "views": 9e12}, self.TODAY)[0]
        self.assertEqual((lo, hi), (0.0, 100.0))
        a = kb.score_video({"subscribers": 10_000, "views": 10_000}, self.TODAY)[0]
        b = kb.score_video({"subscribers": 100_000, "views": 100_000}, self.TODAY)[0]
        self.assertLess(a, b)


class SummaryTest(unittest.TestCase):
    def test_extractive_ordered_and_bounded(self):
        kws = kb.extract_keywords("Nike Outlet Jordan deals", DESC, [], "", 8)
        text = ("Intro about my day and random life stuff that matters little here. " + DESC +
                " Subscribe to my channel for more content and follow me everywhere please. https://x.example/a")
        out = kb.summarize(text, kws, 2)
        self.assertEqual(len(out), 2)
        self.assertTrue(all(s in text for s in out))  # extractive: verbatim sentences
        self.assertEqual(out, sorted(out, key=text.index))
        self.assertFalse(any("http" in s for s in out))

    def test_boilerplate_and_short_dropped(self):
        kws = [("outlet", 3), ("jordan", 3)]
        text = ("I may earn a commission if you buy through these outlet links today. Subscribe for more Jordan outlet deals every week please. "
                "Instagram - instagram.com/outletguy follows jordan news. Nike Factory Store INT Dr. "
                "The outlet back wall had Jordan retros marked down by forty percent this week.")
        out = kb.summarize(text, kws, 5)
        self.assertEqual(out, ["The outlet back wall had Jordan retros marked down by forty percent this week."])
        self.assertEqual(kb.summarize("A completely unrelated sentence about cooking pasta tonight.", kws, 3), [])

    def test_dedupe_and_empty(self):
        kws = [("outlet", 3)]
        s = "The outlet has great prices today for everyone. " * 3
        self.assertEqual(len(kb.summarize(s, kws, 3)), 1)
        self.assertEqual(kb.summarize("", kws, 3), [])
        self.assertEqual(kb.summarize("short.", kws, 3), [])

    def test_unpunctuated_captions_chunked(self):
        words = " ".join(["outlet jordan prices stack discounts"] * 40)
        self.assertGreater(len(kb.split_sentences(words)), 1)


class FactsTest(unittest.TestCase):
    def test_facts_sourced_and_dated(self):
        kws = kb.extract_keywords("Nike Outlet Jordan deals", DESC, [], "", 8)
        f = kb.video_facts(RECS[C1], kws, "2026-11-27", "candidate", ["A summary sentence about outlet prices here."], "description")
        kinds = {x["kind"] for x in f}
        self.assertEqual(kinds, {"meta", "topic", "summary"})
        for x in f:
            self.assertTrue(x["url"].startswith("https://www.youtube.com/watch?v="))
            self.assertEqual(x["date"], "2026-11-27")
            self.assertEqual(x["domain"], "channel-one")

    def test_views_bucket_limits_churn(self):
        self.assertEqual(kb.sig2(36472), kb.sig2(36100))
        self.assertNotEqual(kb.sig2(36472), kb.sig2(52000))


class RunTest(unittest.TestCase):
    def deps(self, calls=None, tcalls=None):
        return {"get_video": fake_get_video([] if calls is None else calls), "ensure_transcript": fake_ensure([] if tcalls is None else tcalls)}

    def test_dry_run_no_network(self):
        with tempfile.TemporaryDirectory() as d:
            def boom(*a, **k):
                raise AssertionError("network")
            code, s = kb.run(args(d, dry_run=True), env={"YOUTUBE_API_KEY": FAKE_KEY}, deps={"get_video": boom, "ensure_transcript": boom})
            self.assertEqual(code, 0)
            self.assertEqual(os.listdir(d), [])
            self.assertNotIn(FAKE_KEY, json.dumps(s))
            self.assertTrue(s["youtube_api_key_present"])

    def test_no_source_is_usage_error(self):
        with tempfile.TemporaryDirectory() as d, redirect_stderr(io.StringIO()):
            code, s = kb.run(args(d, seed_urls=[]), env={}, deps=self.deps())
            self.assertEqual((code, s), (2, None))

    def test_bad_base_url(self):
        with tempfile.TemporaryDirectory() as d, redirect_stderr(io.StringIO()):
            self.assertEqual(kb.run(args(d, url="https://example.com/x"), env={}, deps=self.deps())[0], 2)

    def test_list_only_no_transcript_no_file(self):
        with tempfile.TemporaryDirectory() as d:
            calls, tcalls = [], []
            code, s = kb.run(args(d, list_only=True), env={}, deps=self.deps(calls, tcalls))
            self.assertEqual(code, 0)
            self.assertEqual(tcalls, [])
            self.assertTrue(all(w is False for _, w in calls))  # base AND candidates fetched without transcript
            self.assertEqual([f for f in os.listdir(d) if f.endswith(".md")], [])
            by = {c["video_id"]: c for c in s["candidates"]}
            self.assertTrue(by[C1]["retained"])
            self.assertFalse(by[C3]["retained"])  # high score but off-topic: overlap gate
            self.assertEqual(s["candidates"][0]["score"], max(c["score"] for c in s["candidates"]))
            self.assertTrue(all("_rec" not in c for c in s["candidates"]))
            self.assertTrue(all({"title", "channel", "url", "score"} <= set(c) for c in s["candidates"]))

    def test_threshold_configurable(self):
        with tempfile.TemporaryDirectory() as d:
            _, hi = kb.run(args(d, list_only=True, min_score=95), env={}, deps=self.deps())
            _, lo = kb.run(args(d, list_only=True, min_score=1), env={}, deps=self.deps())
            self.assertLess(hi["retained"], lo["retained"])

    def test_trust_seeds_bypasses_overlap_only(self):
        with tempfile.TemporaryDirectory() as d:
            _, s = kb.run(args(d, list_only=True, trust_seeds=True), env={}, deps=self.deps())
            self.assertTrue({c["video_id"]: c for c in s["candidates"]}[C3]["retained"])

    def test_full_run_twice_idempotent_and_confirmed_topics(self):
        with tempfile.TemporaryDirectory() as d:
            c1, s1 = kb.run(args(d), env={}, now=datetime.datetime.fromisoformat(NOW1), deps=self.deps())
            self.assertEqual(c1, 0)
            files = [f for f in os.listdir(d) if f.endswith(".md")]
            self.assertEqual(files, ["yt-basevideo01.md"])
            with open(os.path.join(d, files[0]), encoding="utf-8") as fh:
                md1 = fh.read()
            self.assertIn("## Confirmé", md1)
            self.assertIn("## Incertain", md1)
            self.assertIn("Thème récurrent : « outlet »", md1)
            doc = sr.parse_doc(md1)
            self.assertEqual(sr.fact_status(doc["facts"]["topic:outlet"]), "confirmed")  # base + 2 other channels
            self.assertTrue(all(sr.fact_status(f) == "confirmed" for f in doc["facts"].values() if f["kind"] == "meta"))
            self.assertTrue(all(sr.fact_status(f) == "uncertain" for f in doc["facts"].values() if f["kind"] == "summary"))
            self.assertNotIn("candVIDEO03", md1.split("## Journal")[0])  # off-topic never a fact
            for ln in md1.splitlines():
                if "<!-- k:" in ln:
                    self.assertRegex(ln, r"sources : \[[a-z0-9-]+\]\(https://www\.youtube\.com/watch\?v=\w+\) \(\d{4}-\d{2}-\d{2}\)")
            c2, s2 = kb.run(args(d), env={}, now=datetime.datetime.fromisoformat(NOW2), deps=self.deps())
            self.assertEqual((s2["new_facts"], s2["runs"]), (0, 2))
            with open(os.path.join(d, files[0]), encoding="utf-8") as fh:
                md2 = fh.read()
            self.assertEqual(md2.split("## Journal")[0].replace("updated: " + NOW1, "updated: " + NOW2).split("---", 2)[2],
                             md1.split("## Journal")[0].split("---", 2)[2])
            self.assertEqual(md2.count("\n### 2026-"), 2)
            self.assertIn("aucun nouveau fait", md2)

    def test_max_videos_cap_and_transcript_only_for_retained(self):
        with tempfile.TemporaryDirectory() as d:
            tcalls = []
            kb.run(args(d, max_videos=1), env={}, deps=self.deps(None, tcalls))
            self.assertEqual(len(tcalls), 1)
            self.assertNotIn(C3, tcalls)

    def test_api_mode_search_and_key_never_leaks(self):
        with tempfile.TemporaryDirectory() as d:
            searched = []

            def search(q, n):
                searched.append(q)
                return [C1, C2, BASE_ID]

            def videos(ids):
                return {i: {"id": i, "snippet": {"title": RECS[i]["title"], "channelTitle": RECS[i]["channel_name"], "channelId": "UC" + i,
                                                  "publishedAt": "2026-10-01T00:00:00Z", "description": RECS[i]["description"]},
                            "statistics": {"viewCount": str(RECS[i]["views"])}, "contentDetails": {"duration": "PT10M"}} for i in ids}

            def channels(ids):
                return {c: {"statistics": {"subscriberCount": "300000"}, "snippet": {"publishedAt": "2012-01-01T00:00:00Z"}} for c in ids}
            deps = dict(self.deps(), search=search, videos=videos, channels=channels)
            code, s = kb.run(args(d, seed_urls=[], max_queries=2), env={"YOUTUBE_API_KEY": FAKE_KEY}, deps=deps)
            self.assertEqual(code, 0)
            self.assertLessEqual(len(searched), 2)
            self.assertEqual({c["video_id"] for c in s["candidates"]}, {C1, C2})  # base excluded
            self.assertEqual(s["mode"], "youtube-data-api")
            blob = json.dumps(s)
            for f in os.listdir(d):
                with open(os.path.join(d, f), encoding="utf-8") as fh:
                    blob += fh.read()
            self.assertNotIn(FAKE_KEY, blob)

    def test_api_auth_refused_stops_masked(self):
        with tempfile.TemporaryDirectory() as d:
            n = []

            def search(q, k):
                n.append(1)
                raise yv.ApiAuthError(f"youtube api HTTP 403 key {FAKE_KEY}")
            code, s = kb.run(args(d, seed_urls=[]), env={"YOUTUBE_API_KEY": FAKE_KEY}, deps=dict(self.deps(), search=search))
            self.assertEqual((code, len(n)), (3, 1))
            self.assertNotIn(FAKE_KEY, json.dumps(s))

    def test_caps(self):
        with tempfile.TemporaryDirectory() as d:
            _, s = kb.run(args(d, dry_run=True, max_queries=99, max_candidates=999, max_videos=999), env={}, deps=self.deps())
            self.assertEqual((s["max_candidates"], s["max_videos"]), (kb.HARD_MAX_CANDIDATES, kb.HARD_MAX_VIDEOS))
            _, s = kb.run(args(d, dry_run=True, max_queries=99), env={"YOUTUBE_API_KEY": "k"}, deps=self.deps())
            self.assertEqual(s["max_queries"], kb.HARD_MAX_QUERIES)

    def test_search_plan_bounded_and_unique(self):
        kws = kb.extract_keywords("Nike Outlet Jordan deals", DESC, [], "", 8)
        p = kb.search_plan(RECS[BASE_ID], kws, 3)
        self.assertLessEqual(len(p), 3)
        self.assertEqual(len(p), len(set(p)))
        self.assertEqual(kb.search_plan(RECS[BASE_ID], kws, 0), [])

    def test_invalid_seed_ignored_and_base_not_candidate(self):
        with tempfile.TemporaryDirectory() as d, redirect_stderr(io.StringIO()):
            _, s = kb.run(args(d, list_only=True, seed_urls=["https://example.com/x", f"https://youtu.be/{BASE_ID}", f"https://youtu.be/{C1}"]), env={}, deps=self.deps())
            self.assertEqual([c["video_id"] for c in s["candidates"]], [C1])

    def test_slug_is_video_id_not_title_and_subject_override(self):
        with tempfile.TemporaryDirectory() as d:
            _, s = kb.run(args(d, dry_run=True), env={}, deps=self.deps())
            self.assertEqual(s["slug"], "yt-basevideo01")
            _, s = kb.run(args(d, dry_run=True, subject="Nike Outlet « Jordan » deals!"), env={}, deps=self.deps())
            self.assertEqual(s["slug"], "nike-outlet-jordan-deals")

    def test_title_change_between_runs_same_fiche(self):
        with tempfile.TemporaryDirectory() as d:
            kb.run(args(d), env={}, now=datetime.datetime.fromisoformat(NOW1), deps=self.deps())
            RECS[BASE_ID]["title"] = "A completely different A/B test title"
            try:
                kb.run(args(d), env={}, now=datetime.datetime.fromisoformat(NOW2), deps=self.deps())
            finally:
                RECS[BASE_ID]["title"] = "Nike Outlet Jordan deals"
            self.assertEqual([f for f in os.listdir(d) if f.endswith(".md")], ["yt-basevideo01.md"])


if __name__ == "__main__":
    unittest.main()
