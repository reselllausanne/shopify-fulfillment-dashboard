"""Run: python3 -m unittest discover -s docs/jarvis/tests -v  (stdlib only: no network, no browser, no YouTube API)."""
import io, json, os, sys, tempfile, unittest, urllib.error
from contextlib import redirect_stderr, redirect_stdout

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "bin"))
import jarvis_web as jw
import youtube_video as yv

FAKE_KEY = "FAKEYT_do_not_leak_987654"
VID = "abcDEF12345"
INITIAL = {"contents": {"twoColumn": {"results": [
    {"videoPrimaryInfoRenderer": {"title": {"runs": [{"text": "Nike "}, {"text": "Outlet deals"}]},
                                  "viewCount": {"videoViewCountRenderer": {"viewCount": {"simpleText": "36,472 views"}, "originalViewCount": "36472"}},
                                  "dateText": {"simpleText": "Nov 19, 2026"}}},
    {"videoSecondaryInfoRenderer": {"owner": {"videoOwnerRenderer": {
        "title": {"runs": [{"text": "Deal Channel"}]},
        "navigationEndpoint": {"browseEndpoint": {"browseId": "UC123", "canonicalBaseUrl": "/@dealchannel"}},
        "subscriberCountText": {"simpleText": "125K subscribers"}}},
        "attributedDescription": {"content": "Outlet prices for Jordan and Nike. Second sentence here about discounts."}}}]}}}
PLAYER = {"playabilityStatus": {"status": "OK"},
          "videoDetails": {"videoId": VID, "title": "Nike Outlet deals", "author": "Deal Channel", "channelId": "UC123", "lengthSeconds": "552",
                           "viewCount": "40000", "shortDescription": "Player description", "keywords": ["nike", "outlet"]},
          "microformat": {"playerMicroformatRenderer": {"publishDate": "2026-11-19T08:00:00-08:00"}},
          "captions": {"playerCaptionsTracklistRenderer": {"captionTracks": [
              {"baseUrl": "https://www.youtube.com/api/timedtext?v=abcDEF12345&lang=en", "languageCode": "en", "kind": "asr"},
              {"baseUrl": "https://www.youtube.com/api/timedtext?v=abcDEF12345&lang=fr", "languageCode": "fr"}]}}}
PAGE = f"<html><script>var ytInitialData = {json.dumps(INITIAL)};</script><script>var ytInitialPlayerResponse = {json.dumps(PLAYER)};var meta={{}};</script></html>"
BOT_PLAYER = {"playabilityStatus": {"status": "LOGIN_REQUIRED", "reason": "Sign in to confirm you're not a bot"}}
BOT_PAGE = f"<html><script>var ytInitialData = {json.dumps(INITIAL)};</script><script>var ytInitialPlayerResponse = {json.dumps(BOT_PLAYER)};</script></html>"
JSON3 = json.dumps({"events": [{"tStartMs": 0, "segs": [{"utf8": "hello "}, {"utf8": "world"}]}, {"tStartMs": 2000, "segs": [{"utf8": "\n"}]},
                               {"tStartMs": 3000, "segs": [{"utf8": "hello world"}]}, {"tStartMs": 4000, "segs": [{"utf8": "next line"}]}]})
XML = '<?xml version="1.0"?><transcript><text start="0.5" dur="2">Tom &amp;amp; Jerry</text><text start="3" dur="1">second <i>line</i></text></transcript>'


class UrlTest(unittest.TestCase):
    def test_variants(self):
        for u in [f"https://www.youtube.com/watch?v={VID}&t=5s", f"https://youtu.be/{VID}?si=x", f"https://m.youtube.com/watch?v={VID}",
                  f"https://www.youtube.com/shorts/{VID}", f"https://www.youtube.com/embed/{VID}", f"https://www.youtube.com/live/{VID}?feature=share"]:
            self.assertEqual(yv.parse_video_url(u), (VID, f"https://www.youtube.com/watch?v={VID}"))

    def test_rejects(self):
        for u in ["https://example.com/watch?v=" + VID, "https://www.youtube.com/watch?v=short", "https://www.youtube.com/@channel",
                  "https://youtube.com.evil.com/watch?v=" + VID, "javascript:alert(1)", "http://127.0.0.1/watch?v=" + VID, ""]:
            with self.assertRaises(ValueError):
                yv.parse_video_url(u)


class ParseTest(unittest.TestCase):
    def test_subscribers(self):
        for t, n in [("125K subscribers", 125000), ("1.2M subscribers", 1200000), ("1,234 subscribers", 1234), ("4.56M subscribers", 4560000),
                     ("125 k abonnés", 125000), ("2 Mio. abonnés", 2000000), ("1,2 M d’abonnés", 1200000), ("125 thousand subscribers", 125000), ("7 subscribers", 7)]:
            self.assertEqual(yv.parse_subscribers(t), n, t)
        for t in ["", None, "no idea", "Subscribe"]:
            self.assertIsNone(yv.parse_subscribers(t))

    def test_date_count_duration(self):
        self.assertEqual(yv.parse_date_text("Nov 19, 2026"), "2026-11-19")
        self.assertEqual(yv.parse_date_text("Premiered on Sep 2, 2024"), "2024-09-02")
        self.assertEqual(yv.parse_date_text("2009-10-24T23:57:33-07:00"), "2009-10-24")
        self.assertIsNone(yv.parse_date_text("7 days ago"))
        self.assertEqual(yv.parse_count("36,472 views"), 36472)
        self.assertEqual(yv.parse_iso_duration("PT1H2M3S"), 3723)
        self.assertEqual(yv.parse_iso_duration("PT45S"), 45)
        self.assertIsNone(yv.parse_iso_duration("nope"))

    def test_watch_page_full(self):
        w = yv.parse_watch_page(PAGE, VID)
        self.assertEqual((w["title"], w["channel_name"], w["channel_id"], w["subscribers"]), ("Nike Outlet deals", "Deal Channel", "UC123", 125000))
        self.assertEqual((w["views"], w["duration_seconds"], w["published_at"]), (40000, 552, "2026-11-19"))
        self.assertEqual(w["tags"], ["nike", "outlet"])
        self.assertEqual(len(w["caption_tracks"]), 2)
        self.assertEqual(w["channel_url"], "https://www.youtube.com/@dealchannel")

    def test_watch_page_bot_wall_keeps_initial_data(self):
        w = yv.parse_watch_page(BOT_PAGE, VID)
        self.assertEqual(w["playability"], "LOGIN_REQUIRED")
        self.assertEqual((w["title"], w["views"], w["subscribers"]), ("Nike Outlet deals", 36472, 125000))
        self.assertIsNone(w["duration_seconds"])
        self.assertEqual(w["caption_tracks"], [])
        self.assertIn("Outlet prices", w["description"])

    def test_watch_page_garbage(self):
        w = yv.parse_watch_page("<html>nothing</html>", VID)
        self.assertIsNone(w["title"])
        self.assertEqual(w["caption_tracks"], [])

    def test_player_for_other_video_ignored(self):
        w = yv.parse_watch_page(PAGE, "zzzzzzzzzzz")
        self.assertEqual(w["title"], "Nike Outlet deals")  # from initial data, player ignored
        self.assertIsNone(w["duration_seconds"])


class TranscriptTest(unittest.TestCase):
    def test_json3_and_xml(self):
        segs = yv.parse_timedtext(JSON3)
        self.assertEqual(yv.segments_to_text(segs), "hello world next line")
        x = yv.parse_timedtext(XML)
        self.assertEqual(yv.segments_to_text(x), "Tom & Jerry second line")
        self.assertEqual(yv.parse_timedtext(""), [])
        self.assertEqual(yv.parse_timedtext("{broken"), [])

    def test_pick_track(self):
        tr = PLAYER["captions"]["playerCaptionsTracklistRenderer"]["captionTracks"]
        self.assertEqual(yv.pick_track(tr, ("fr", "en"))["languageCode"], "fr")
        self.assertEqual(yv.pick_track(tr, ("en",))["kind"], "asr")
        self.assertEqual(yv.pick_track(tr, ("de",))["languageCode"], "fr")  # first manual
        self.assertIsNone(yv.pick_track([], ("en",)))

    def test_fetch_ok_empty_blocked_and_ssrf(self):
        tr = PLAYER["captions"]["playerCaptionsTracklistRenderer"]["captionTracks"]
        with tempfile.TemporaryDirectory() as d:
            log = os.path.join(d, "l.jsonl")
            ok = yv.fetch_transcript(tr, ("fr",), log, VID, http=lambda u, **k: (200, JSON3, len(JSON3)))
            self.assertEqual((ok["status"], ok["kind"], ok["lang"]), ("ok", "manual", "fr"))
            empty = yv.fetch_transcript(tr, ("fr",), log, VID, http=lambda u, **k: (200, "", 0))
            self.assertEqual(empty["status"], "unavailable")
            self.assertIn("empty", empty["reason"])

            def blocked(u, **k):
                raise jw.AntiBotError("HTTP 429")
            self.assertIn("blocked", yv.fetch_transcript(tr, ("fr",), log, VID, http=blocked)["reason"])
            evil = [{"baseUrl": "https://evil.example.com/timedtext", "languageCode": "en"}]
            called = []
            r = yv.fetch_transcript(evil, ("en",), log, VID, http=lambda u, **k: called.append(u) or (200, JSON3, 1))
            self.assertEqual((r["status"], called), ("unavailable", []))
            self.assertEqual(yv.fetch_transcript([], ("en",), log, VID)["status"], "unavailable")


class ApiTest(unittest.TestCase):
    def test_no_retry_on_403_key_masked(self):
        calls = []

        def op(req, timeout=None):
            calls.append(req.full_url)
            raise urllib.error.HTTPError(req.full_url, 403, "quota", {}, None)
        with self.assertRaises(yv.ApiAuthError) as cm:
            yv.api_get("videos", {"id": VID}, FAKE_KEY, opener=op, sleep=lambda s: None)
        self.assertEqual(len(calls), 1)
        self.assertNotIn(FAKE_KEY, str(cm.exception))

    def test_retry_cap_5xx_and_mask(self):
        calls = []

        def op(req, timeout=None):
            calls.append(1)
            raise urllib.error.URLError(f"boom key={FAKE_KEY}")
        with self.assertRaises(jw.FetchError) as cm:
            yv.api_get("videos", {"id": VID}, FAKE_KEY, opener=op, sleep=lambda s: None)
        self.assertEqual(len(calls), jw.MAX_ATTEMPTS)
        self.assertNotIn(FAKE_KEY, str(cm.exception))

    def test_video_from_api(self):
        item = {"id": VID, "snippet": {"title": "T", "channelTitle": "C", "channelId": "UC1", "publishedAt": "2026-01-02T00:00:00Z", "description": "d", "tags": ["a"]},
                "statistics": {"viewCount": "1234"}, "contentDetails": {"duration": "PT10M"}}
        ch = {"statistics": {"subscriberCount": "5000"}, "snippet": {"publishedAt": "2015-05-06T00:00:00Z"}}
        v = yv.video_from_api(item, ch)
        self.assertEqual((v["views"], v["subscribers"], v["channel_created"], v["duration_seconds"], v["published_at"]), (1234, 5000, "2015-05-06", 600, "2026-01-02"))
        hidden = yv.video_from_api(item, {"statistics": {"hiddenSubscriberCount": True, "subscriberCount": "0"}, "snippet": {}})
        self.assertIsNone(hidden["subscribers"])


class GetVideoTest(unittest.TestCase):
    def test_keyless_from_html_transcript_unavailable_on_bot_wall(self):
        r = yv.get_video(f"https://youtu.be/{VID}", env={}, html=BOT_PAGE, log=os.devnull)
        self.assertEqual(r["source"], "watch_page")
        self.assertEqual(r["transcript"]["status"], "unavailable")
        self.assertTrue(any("YOUTUBE_API_KEY absent" in n for n in r["notes"]))
        self.assertTrue(any("LOGIN_REQUIRED" in n for n in r["notes"]))

    def test_keyless_full_with_transcript_mock(self):
        r = yv.get_video(f"https://youtu.be/{VID}", env={}, html=PAGE, log=os.devnull, http=lambda u, **k: (200, JSON3, 10))
        self.assertEqual(r["transcript"]["status"], "ok")
        self.assertEqual(r["transcript"]["text"], "hello world next line")

    def test_api_mode_and_no_key_leak(self):
        api = {"videos": lambda ids: {VID: {"id": VID, "snippet": {"title": "API title", "channelTitle": "C", "channelId": "UC1", "publishedAt": "2026-01-01T00:00:00Z"},
                                            "statistics": {"viewCount": "10"}, "contentDetails": {"duration": "PT1M"}}},
               "channels": lambda ids: {"UC1": {"statistics": {"subscriberCount": "99"}, "snippet": {"publishedAt": "2020-01-01T00:00:00Z"}}}}
        r = yv.get_video(f"https://youtu.be/{VID}", env={"YOUTUBE_API_KEY": FAKE_KEY}, want_transcript=False, api=api, log=os.devnull)
        self.assertEqual((r["source"], r["title"], r["subscribers"]), ("youtube_data_api", "API title", 99))
        self.assertEqual(r["transcript"]["status"], "skipped")
        self.assertNotIn(FAKE_KEY, json.dumps(r))

    def test_api_refused_falls_back_keyless_and_masks(self):
        def boom(ids):
            raise yv.ApiAuthError(f"youtube api HTTP 403 key {FAKE_KEY}")
        r = yv.get_video(f"https://youtu.be/{VID}", env={"YOUTUBE_API_KEY": FAKE_KEY}, want_transcript=False, api={"videos": boom, "channels": boom},
                         html=BOT_PAGE, log=os.devnull)
        self.assertEqual(r["source"], "watch_page")
        self.assertNotIn(FAKE_KEY, json.dumps(r))

    def test_cli(self):
        with tempfile.TemporaryDirectory() as d:
            f = os.path.join(d, "w.html")
            with open(f, "w") as fh:
                fh.write(BOT_PAGE)
            out = io.StringIO()
            with redirect_stdout(out), redirect_stderr(io.StringIO()):
                code = yv.main([f"https://youtu.be/{VID}", "--from-html", f, "--log", os.path.join(d, "l.jsonl")])
            self.assertEqual(code, 0)
            j = json.loads(out.getvalue())
            self.assertEqual(j["title"], "Nike Outlet deals")
            self.assertFalse([k for k in j if k.startswith("_")])
            with redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
                self.assertEqual(yv.main(["https://example.com/x"]), 2)


if __name__ == "__main__":
    unittest.main()
