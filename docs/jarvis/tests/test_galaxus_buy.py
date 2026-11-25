"""Run: python3 -m unittest discover -s docs/jarvis/tests -v  (stdlib only, no network, no browser)."""
import io, json, os, sys, tempfile, unittest, urllib.error
from contextlib import redirect_stderr, redirect_stdout

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "bin"))
import galaxus_buy as gb

PRODUCT_HTML = """<html><script type="application/ld+json">
{"@type":"Product","name":"Zipro Catwalk","url":"/fr/s3/product/zipro-catwalk-66191188",
 "offers":{"@type":"Offer","price":"299.00","priceCurrency":"CHF"},
 "aggregateRating":{"ratingValue":"4.3","reviewCount":"27"}}</script>
<body><p>Livraison CHF 9.90</p><p>Livraison en 2-3 jours ouvrables.</p></body></html>"""
SEARCH_HTML = """<script type="application/ld+json">{"@type":"ItemList","itemListElement":[
{"@type":"ListItem","item":{"@type":"Product","name":"A","url":"/a","offers":{"price":10}}},
{"@type":"ListItem","item":{"@type":"Product","name":"B","url":"/b","offers":[{"price":"1'234.50"}]}}]}</script>"""


class FakeBackend:
    instances = []

    def __init__(self, ship=9.9):
        self.ship, self.cart_calls, self.pay_calls, self.closed = ship, 0, 0, False
        FakeBackend.instances.append(self)

    def add_to_cart(self, url):
        self.cart_calls += 1
        return {"shipping_chf": self.ship, "delivery": "2-3 jours", "cart_url": "https://x/cart", "checkout_url": "https://x/checkout"}

    def pay(self):  # must never be called by default
        self.pay_calls += 1

    def close(self):
        self.closed = True


def run(argv, fetch=None, env=None):
    FakeBackend.instances.clear()
    logs = []
    out, err = io.StringIO(), io.StringIO()
    old = dict(os.environ)
    os.environ.update(env or {})
    try:
        with redirect_stdout(out), redirect_stderr(err):
            code = gb.main(argv, fetch=fetch or (lambda u: PRODUCT_HTML), backend_factory=FakeBackend,
                           now_log=lambda p, **r: (logs.append(r), gb.log_attempt(p, **r))[1])
    finally:
        os.environ.clear(); os.environ.update(old)
    return code, out.getvalue(), err.getvalue(), logs


class Base(unittest.TestCase):
    def setUp(self):
        self.d = tempfile.TemporaryDirectory()
        self.log = os.path.join(self.d.name, "achats.jsonl")
        self.cfg = os.path.join(self.d.name, "achat.json")

    def tearDown(self):
        self.d.cleanup()

    def write_cfg(self, auto=500, daily=1000):
        with open(self.cfg, "w") as f:
            json.dump({"auto_buy_max_chf": auto, "daily_max_chf": daily}, f)


class TestDefaultStop(Base):
    def test_default_stops_before_payment_even_with_generous_limits(self):
        self.write_cfg()
        code, out, _, logs = run(["buy", "--url", "https://www.galaxus.ch/p", "--log", self.log], env={"JARVIS_ACHAT_CONFIG": self.cfg})
        b = FakeBackend.instances[0]
        self.assertEqual(code, 0)
        self.assertEqual(b.cart_calls, 1)
        self.assertEqual(b.pay_calls, 0)
        self.assertTrue(b.closed)
        self.assertIn("STOPPED BEFORE PAYMENT", out)
        self.assertIn("308.90", out)
        self.assertIn("https://x/checkout", out)
        self.assertEqual(logs[0]["status"], "stopped")

    def test_default_stop_without_config_file(self):
        code, _, _, logs = run(["buy", "--url", "https://www.galaxus.ch/p", "--log", self.log], env={"JARVIS_ACHAT_CONFIG": "/nonexistent"})
        self.assertEqual((code, FakeBackend.instances[0].pay_calls, logs[0]["status"]), (0, 0, "stopped"))

    def test_dry_run_touches_no_backend(self):
        code, out, _, logs = run(["buy", "--url", "https://www.galaxus.ch/p", "--dry-run", "--log", self.log])
        self.assertEqual(code, 0)
        self.assertEqual(FakeBackend.instances, [])
        self.assertIn("DRY-RUN", out)
        self.assertEqual(logs[0]["status"], "dry_run")


class TestPayPolicy(Base):
    L = {"auto_buy_max_chf": 100.0, "daily_max_chf": 150.0}

    def test_no_confirm_never_pays(self):
        self.assertFalse(gb.decide_pay(10, self.L, 0, False)[0])

    def test_missing_config_refuses(self):
        self.assertFalse(gb.decide_pay(10, None, 0, True)[0])
        self.assertIsNone(gb.load_limits("/nonexistent/achat.json"))

    def test_unknown_total_refuses(self):
        self.assertFalse(gb.decide_pay(None, self.L, 0, True)[0])

    def test_strictly_below_cap(self):
        self.assertTrue(gb.decide_pay(99.99, self.L, 0, True)[0])
        self.assertFalse(gb.decide_pay(100.0, self.L, 0, True)[0])

    def test_daily_cap(self):
        self.assertTrue(gb.decide_pay(50, self.L, 100, True)[0])
        self.assertFalse(gb.decide_pay(50.01, self.L, 100, True)[0])

    def test_bad_config_file(self):
        open(self.cfg, "w").write('{"auto_buy_max_chf": 5}')
        self.assertIsNone(gb.load_limits(self.cfg))
        open(self.cfg, "w").write("not json")
        self.assertIsNone(gb.load_limits(self.cfg))

    def test_confirm_pay_over_cap_refused_exit4_no_pay(self):
        self.write_cfg(auto=100)
        code, _, err, logs = run(["buy", "--url", "https://www.galaxus.ch/p", "--confirm-pay", "--log", self.log], env={"JARVIS_ACHAT_CONFIG": self.cfg})
        self.assertEqual(code, 4)
        self.assertEqual(FakeBackend.instances[0].pay_calls, 0)
        self.assertIn("PAYMENT REFUSED", err)
        self.assertEqual(logs[0]["status"], "refused")

    def test_confirm_pay_within_limits_pays_via_mock_and_logs(self):
        self.write_cfg(auto=500, daily=1000)
        code, out, _, logs = run(["buy", "--url", "https://www.galaxus.ch/p", "--confirm-pay", "--log", self.log], env={"JARVIS_ACHAT_CONFIG": self.cfg})
        self.assertEqual((code, FakeBackend.instances[0].pay_calls, logs[0]["status"]), (0, 1, "paid"))
        self.assertEqual(gb.spent_today(self.log), 308.9)

    def test_daily_cap_blocks_second_purchase(self):
        self.write_cfg(auto=500, daily=400)
        env = {"JARVIS_ACHAT_CONFIG": self.cfg}
        a = ["buy", "--url", "https://www.galaxus.ch/p", "--confirm-pay", "--log", self.log]
        self.assertEqual(run(a, env=env)[0], 0)
        code, *_ = run(a, env=env)
        self.assertEqual((code, FakeBackend.instances[0].pay_calls), (4, 0))

    def test_confirm_pay_missing_config_refused(self):
        code, *_ = run(["buy", "--url", "https://www.galaxus.ch/p", "--confirm-pay", "--log", self.log], env={"JARVIS_ACHAT_CONFIG": "/nonexistent"})
        self.assertEqual((code, FakeBackend.instances[0].pay_calls), (4, 0))


class TestParsing(unittest.TestCase):
    def test_product(self):
        p = gb.parse_products(PRODUCT_HTML)[0]
        self.assertEqual((p["name"], p["price_chf"], p["rating"], p["reviews"]), ("Zipro Catwalk", 299.0, 4.3, 27))
        self.assertTrue(p["url"].startswith("https://www.galaxus.ch/fr/s3"))

    def test_search_list_and_swiss_price(self):
        ps = gb.parse_products(SEARCH_HTML)
        self.assertEqual([x["name"] for x in ps], ["A", "B"])
        self.assertEqual(ps[1]["price_chf"], 1234.5)

    def test_delivery(self):
        self.assertEqual(gb.parse_delivery(PRODUCT_HTML)[0], 9.9)
        self.assertIn("2-3 jours", gb.parse_delivery(PRODUCT_HTML)[1])
        self.assertEqual(gb.parse_delivery("<p>Livraison gratuite</p>")[0], 0.0)
        self.assertIsNone(gb.parse_delivery("<p>nothing</p>")[0])

    def test_total(self):
        self.assertEqual(gb.compute_total(299, 9.9), 308.9)
        self.assertIsNone(gb.compute_total(299, None))

    def test_to_float(self):
        for s, v in [("CHF 1'299.–", 1299.0), ("12,50", 12.5), ("1,299.00", 1299.0), (None, None), ("abc", None)]:
            self.assertEqual(gb.to_float(s), v)

    def test_search_cli_json(self):
        code, out, _, _ = run(["search", "x", "--json"], fetch=lambda u: SEARCH_HTML)
        self.assertEqual((code, len(json.loads(out))), (0, 2))


class TestLogging(Base):
    def test_jsonl_fields_and_daily_sum(self):
        gb.log_attempt(self.log, product="P", price_chf=10, total_chf=12, link="u", status="paid", reason="ok")
        gb.log_attempt(self.log, product="P", price_chf=10, total_chf=99, link="u", status="stopped", reason="r")
        r = json.loads(open(self.log).readline())
        for k in ("ts", "product", "price_chf", "link", "status", "reason"):
            self.assertIn(k, r)
        self.assertEqual(gb.spent_today(self.log), 12.0)
        self.assertEqual(gb.spent_today(self.log, "1999-01-01"), 0.0)
        self.assertEqual(gb.spent_today("/nonexistent/x.jsonl"), 0.0)

    def test_log_path_env(self):
        os.environ["GALAXUS_BUY_LOG"] = "/tmp/zz.jsonl"
        try:
            self.assertEqual(gb.log_path(), "/tmp/zz.jsonl")
        finally:
            del os.environ["GALAXUS_BUY_LOG"]
        self.assertIn(".local/share", gb.log_path())


class TestAntiBot(Base):
    def test_detect(self):
        for st, body in [(403, ""), (429, ""), (200, "<title>Access denied</title>"), (200, "please solve the captcha")]:
            with self.assertRaises(gb.AntiBotError):
                gb.detect_antibot(st, body)
        gb.detect_antibot(200, "<html>ok</html>")

    def test_cli_exit3_and_logged(self):
        def boom(u):
            raise gb.AntiBotError("403")
        code, _, err, logs = run(["buy", "--url", "https://www.galaxus.ch/p", "--log", self.log], fetch=boom)
        self.assertEqual(code, 3)
        self.assertIn("ANTI-BOT", err)
        self.assertEqual(logs[0]["status"], "blocked")

    def test_403_no_retry(self):
        calls = []

        def opener(req, timeout=0):
            calls.append(1)
            raise urllib.error.HTTPError(req.full_url, 403, "no", {}, io.BytesIO(b"Access denied"))
        with self.assertRaises(gb.AntiBotError):
            gb.http_get("https://x", min_delay=0, opener=opener, sleep=lambda s: None)
        self.assertEqual(len(calls), 1)

    def test_5xx_bounded_retries(self):
        calls = []

        def opener(req, timeout=0):
            calls.append(1)
            raise urllib.error.HTTPError(req.full_url, 503, "x", {}, io.BytesIO(b""))
        with self.assertRaises(gb.FetchError):
            gb.http_get("https://x", min_delay=0, opener=opener, sleep=lambda s: None)
        self.assertEqual(len(calls), gb.MAX_RETRIES + 1)




class TestLiveMarkupListing(unittest.TestCase):
    """Markup shape captured from the live Galaxus category page (2026-11-25)."""
    HTML = (
        '<a href="/fr/s3/product/zipro-yougo-tapis-de-course-41297308"> </a>'
        '<a href="/fr/s3/product/zipro-yougo-tapis-de-course-41297308?imageIndex=1"> </a>'
        '<div>Tapis de course <span>CHF</span> <span>166.\u2013</span> <span>Zipro Yougo</span> <span>109</span></div>'
        '<a href="/fr/s3/product/zipro-catwalk-tapis-de-course-66191188"> </a>'
        '<div>Tapis de course <span>CHF</span> <span>139.\u2013</span> <span>Zipro Catwalk</span> <span>16</span></div>'
    )

    def test_listing_prices_names_dedup(self):
        r = gb.parse_listing(self.HTML)
        self.assertEqual([(x["name"], x["price_chf"]) for x in r], [("Zipro Yougo", 166.0), ("Zipro Catwalk", 139.0)])

    def test_delivery_live_phrase(self):
        self.assertEqual(gb.parse_delivery("<p>Livr\u00e9 entre ven, 27/11 et sam, 28/11</p>")[1], "Livr\u00e9 entre ven, 27/11 et sam, 28/11")


class TestCartSafety(Base):
    def test_refuses_when_cart_has_other_items(self):
        import galaxus_buy as g
        class B:
            def add_to_cart(self, url):
                return {"shipping_chf": 0.0, "delivery": None, "cart_total_chf": 260.10, "items": 2,
                        "cart_url": "c", "checkout_url": "k"}
            def pay(self): raise AssertionError("must not pay")
            def close(self): pass
        logs = []
        a = g.build_parser().parse_args(["buy", "--url", "https://www.galaxus.ch/fr/s3/product/x-1234567", "--confirm-pay"])
        page = '<script type="application/ld+json">{"@type":"Product","name":"X","offers":{"price":"139"}}</script>'
        with redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
            code = g.cmd_buy(a, lambda u: page, lambda: B(), lambda p, **r: logs.append(r))
        self.assertEqual(code, g.EXIT_PAY_REFUSED)
        self.assertEqual(logs[-1]["status"], "refused")


if __name__ == "__main__":
    unittest.main()
