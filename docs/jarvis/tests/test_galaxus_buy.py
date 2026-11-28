"""Run: python3 -m unittest discover -s docs/jarvis/tests -v  (stdlib only, no network, no browser)."""
import io, json, os, sys, tempfile, unittest, urllib.error
from contextlib import redirect_stderr, redirect_stdout

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "bin"))
import galaxus_buy as gb

FIX = os.path.join(os.path.dirname(__file__), "fixtures")


def fixture(name):
    with open(os.path.join(FIX, name), encoding="utf-8") as f:
        return f.read()

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
    initial_cart = None  # list of cart items; default = tests/fixtures/cart.html
    removal_works = True
    search_results = None

    def __init__(self, ship=9.9):
        self.ship, self.cart_calls, self.pay_calls, self.closed = ship, 0, 0, False
        self.remove_calls, self.search_calls = [], []
        items = FakeBackend.initial_cart if FakeBackend.initial_cart is not None else gb.parse_cart(fixture("cart.html"))["items"]
        self.items = [dict(i) for i in items]
        FakeBackend.instances.append(self)

    def search(self, query, limit=8):
        self.search_calls.append((query, limit))
        res = FakeBackend.search_results
        if res is None:
            res = gb.parse_search_graphql(json.loads(fixture("search_graphql.json")))
        return res[:limit]

    def cart_items(self):
        return {"list_found": True, "items": [dict(i) for i in self.items], "shipping_chf": 0.0, "total_chf": None}

    def remove_item(self, pid):
        self.remove_calls.append(pid)
        hit = [i for i in self.items if i["id"] == pid]
        if hit and FakeBackend.removal_works:
            self.items.remove(hit[0])
        return bool(hit)

    def add_to_cart(self, url):
        self.cart_calls += 1
        return {"shipping_chf": self.ship, "delivery": "2-3 jours", "cart_url": "https://x/cart", "checkout_url": "https://x/checkout"}

    def pay(self):  # must never be called by default
        self.pay_calls += 1
        return {"status": getattr(self, "pay_status", "confirmed"), "order": "12345678", "url": "https://x/order"}

    def close(self):
        self.closed = True


def run(argv, fetch=None, env=None):
    FakeBackend.instances.clear()
    FakeBackend.initial_cart, FakeBackend.removal_works, FakeBackend.search_results = None, True, None
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
        code, out, _, _ = run(["search", "x", "--json", "--limit", "2"])
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


class TestSearchClientSide(Base):
    """Search is client-rendered: results come from the useSearchDataQuery GraphQL response (live 2026-11-28)."""

    def test_graphql_parse(self):
        ps = gb.parse_search_graphql(json.loads(fixture("search_graphql.json")))
        self.assertEqual(len(ps), 6)
        p = ps[0]
        self.assertEqual(p["name"], "Niimbot Etiquettes thermiques 15x50 mm, 130 pcs")
        self.assertEqual((p["price_chf"], p["rating"], p["reviews"], p["properties"]), (13.6, 4.8, 16, "15 mm"))
        self.assertEqual(p["url"], "https://www.galaxus.ch/fr/s12/product/niimbot-etiquettes-thermiques-15x50-mm-130-pcs-15-mm-rouleau-detiquettes-35585504")
        self.assertTrue(all(x["url"].startswith("https://www.galaxus.ch/") and x["price_chf"] for x in ps))

    def test_graphql_empty_or_garbage(self):
        for bad in ({}, {"data": None}, {"data": {"shopSearch": {"products": {"edges": []}}}}, None, []):
            self.assertEqual(gb.parse_search_graphql(bad), [])

    def test_dom_fallback_fixture(self):
        r = gb.parse_listing(fixture("search_listing_dom.html"))
        self.assertEqual([x["price_chf"] for x in r], [13.6, 7.3, 9.65])
        self.assertEqual(r[0]["name"], "Niimbot Etiquettes thermiques 15x50 mm, 130 pcs (15 mm)")
        self.assertIn("/s12/product/", r[1]["url"])

    def test_cli_text_output_has_title_price_url(self):
        code, out, _, _ = run(["search", "etiquettes", "--limit", "3"])
        self.assertEqual(code, 0)
        lines = out.strip().splitlines()
        self.assertEqual(len(lines), 3)
        self.assertIn("CHF 13.60", lines[0])
        self.assertIn("https://www.galaxus.ch/fr/s12/product/", lines[0])
        self.assertTrue(FakeBackend.instances[0].closed)
        self.assertEqual(FakeBackend.instances[0].search_calls, [("etiquettes", 3)])

    def test_buy_by_query_uses_search(self):
        code, out, _, _ = run(["buy", "etiquettes", "--pick", "2", "--dry-run", "--log", self.log])
        self.assertEqual(code, 0)
        self.assertEqual(FakeBackend.instances[0].search_calls[0][0], "etiquettes")
        self.assertIn("b21", out)


class FakeResponse:
    def __init__(self, url, status, payload):
        self.url, self.status, self._p = url, status, payload

    def json(self):
        if isinstance(self._p, Exception):
            raise self._p
        return self._p


class FakeGoto:
    def __init__(self, status):
        self.status = status


class FakePage:
    """Stands in for a Playwright page: goto() fires the registered response handlers like the live page does."""

    def __init__(self, responses=(), html="<html></html>", goto_status=200):
        self.handlers, self.responses, self.html, self.goto_status = [], list(responses), html, goto_status
        self.gotos = []

    def on(self, ev, fn):
        self.handlers.append(fn)

    def remove_listener(self, ev, fn):
        self.handlers.remove(fn)

    def goto(self, url, wait_until=None):
        self.gotos.append(url)
        for r in self.responses:
            for h in list(self.handlers):
                h(r)
        return FakeGoto(self.goto_status)

    def wait_for_timeout(self, ms):
        pass

    def content(self):
        return self.html


def backend_with(page):
    b = gb.BrowserBackend.__new__(gb.BrowserBackend)
    b.page = page
    return b


class TestBrowserSearch(Base):
    def setUp(self):
        super().setUp()
        self._env = dict(os.environ)
        os.environ["GALAXUS_MIN_DELAY"] = "0"
        self._sleep = gb.time.sleep
        self.sleeps = []
        gb.time.sleep = lambda s: self.sleeps.append(s)

    def tearDown(self):
        gb.time.sleep = self._sleep
        os.environ.clear(); os.environ.update(self._env)
        super().tearDown()

    def test_captures_graphql_response(self):
        page = FakePage([FakeResponse("https://www.galaxus.ch/graphql/o/abc/useSearchDataQuery", 200, json.loads(fixture("search_graphql.json")))])
        res = backend_with(page).search("etiquettes", 4)
        self.assertEqual(len(res), 4)
        self.assertEqual(len(page.gotos), 1)
        self.assertEqual(page.handlers, [])
        self.assertIn("/fr/search?q=etiquettes", page.gotos[0])

    def test_403_on_navigation_is_antibot_no_retry(self):
        page = FakePage(goto_status=403)
        with self.assertRaises(gb.AntiBotError):
            backend_with(page).search("x")
        self.assertEqual(len(page.gotos), 1)

    def test_403_on_search_query_is_antibot_no_retry(self):
        page = FakePage([FakeResponse("https://www.galaxus.ch/graphql/o/abc/useSearchDataQuery", 403, {})])
        with self.assertRaises(gb.AntiBotError):
            backend_with(page).search("x")
        self.assertEqual(len(page.gotos), 1)

    def test_captcha_page_is_antibot(self):
        page = FakePage(html="<html><title>Please solve the captcha</title></html>")
        with self.assertRaises(gb.AntiBotError):
            backend_with(page).search("x")
        self.assertEqual(len(page.gotos), 1)

    def test_no_response_bounded_retries_then_clean_fail(self):
        page = FakePage()
        with self.assertRaises(gb.FetchError):
            backend_with(page).search("x")
        self.assertEqual(len(page.gotos), gb.MAX_RETRIES + 1)
        self.assertEqual(self.sleeps.count(2) + self.sleeps.count(4), gb.MAX_RETRIES)

    def test_falls_back_to_dom_when_no_graphql(self):
        page = FakePage(html=fixture("search_listing_dom.html"))
        res = backend_with(page).search("x", 2)
        self.assertEqual(len(res), 2)
        self.assertEqual(len(page.gotos), 1)

    def test_throttle_waits_between_requests(self):
        os.environ["GALAXUS_MIN_DELAY"] = "3"
        waits = []
        gb.time.sleep = lambda s: waits.append(s)
        gb._last_req[0] = gb.time.time()
        page = FakePage([FakeResponse("u/useSearchDataQuery", 200, json.loads(fixture("search_graphql.json")))])
        backend_with(page).search("x")
        self.assertTrue(waits and 0 < waits[0] <= 3)

    def test_cli_exit3_on_antibot(self):
        class B(FakeBackend):
            def search(self, q, limit=8):
                raise gb.AntiBotError("403")
        out, err = io.StringIO(), io.StringIO()
        with redirect_stdout(out), redirect_stderr(err):
            code = gb.main(["search", "x"], backend_factory=B, now_log=lambda p, **r: None)
        self.assertEqual(code, 3)
        self.assertIn("ANTI-BOT", err.getvalue())


ARTDEV = "https://www.galaxus.ch/fr/s12/product/artdev-porte-rouleau-al-t451-etiquettes-accessoires-41111111"
ZEBRA = "https://www.galaxus.ch/fr/s12/product/zebra-z-select-2000d-25x76-rouleau-detiquettes-42222222"
ZIPRO = "https://www.galaxus.ch/fr/s12/product/zipro-catwalk-tapis-de-course-43333333?imageIndex=1"


class TestCartParse(unittest.TestCase):
    def test_parse_fixture_active_list_only(self):
        c = gb.parse_cart(fixture("cart.html"))
        self.assertEqual([i["id"] for i in c["items"]], ["41111111", "42222222", "43333333"])
        self.assertEqual([i["price_chf"] for i in c["items"]], [68.28, 107.0, 133.0])
        self.assertEqual(c["items"][0]["name"], "Artdev Porte-rouleau AL-T451")
        self.assertEqual((c["total_chf"], c["shipping_chf"], c["list_found"]), (308.28, 0.0, True))

    def test_empty_or_unknown_page(self):
        c = gb.parse_cart("<html><body>Votre panier est vide</body></html>")
        self.assertEqual((c["items"], c["list_found"]), ([], False))

    def test_product_id(self):
        self.assertEqual(gb.product_id(ZIPRO), "43333333")
        self.assertEqual(gb.product_id("https://www.galaxus.ch/fr/s12/product/a-b-123456/"), "123456")
        self.assertIsNone(gb.product_id("https://www.galaxus.ch/fr/cart"))
        self.assertIsNone(gb.product_id(None))

    def test_real_cart_page_shape_shipping(self):
        html = ('<ul aria-label="Produits dans le panier"><li class="cart-item x"><a href="/fr/s12/product/n-35585504">'
                '<p><strong>Niimbot</strong> <span>Etiquettes</span></p></a> 1 CHF 13.60 Supprimer</li></ul>'
                '<div>Envoi (gratuit \u00e0 partir de CHF 50.\u2013) CHF 4.90 Compl\u00e9tez votre panier Total CHF 18.50</div>')
        c = gb.parse_cart(html)
        self.assertEqual((c["shipping_chf"], c["total_chf"], c["items"][0]["qty"]), (4.9, 18.5, 1))


class TestCartCommands(Base):
    def go(self, *argv):
        return run(list(argv) + ["--log", self.log] if argv[0] != "cart-list" else list(argv))

    def assert_no_buy_side_effects(self):
        for b in FakeBackend.instances:
            self.assertEqual((b.pay_calls, b.cart_calls), (0, 0))
            self.assertTrue(b.closed)

    def test_cart_list(self):
        code, out, _, _ = run(["cart-list"])
        self.assertEqual(code, 0)
        self.assertIn("3 item(s)", out)
        self.assertIn("[41111111] Artdev", out)
        self.assertEqual(FakeBackend.instances[0].remove_calls, [])
        self.assert_no_buy_side_effects()

    def test_cart_list_json(self):
        code, out, _, _ = run(["cart-list", "--json"])
        self.assertEqual([i["id"] for i in json.loads(out)["items"]], ["41111111", "42222222", "43333333"])

    def test_remove_dry_run_changes_nothing(self):
        code, out, _, logs = self.go("cart-remove", "--url", ZEBRA, "--dry-run")
        self.assertEqual(code, 0)
        self.assertIn("WOULD REMOVE: [42222222]", out)
        self.assertIn("cart unchanged", out)
        self.assertNotIn("cart AFTER", out)
        self.assertEqual(FakeBackend.instances[0].remove_calls, [])
        self.assertEqual(logs[0]["status"], "dry_run_cart_remove")

    def test_remove_one_lists_before_after_and_verifies(self):
        code, out, _, logs = self.go("cart-remove", "--url", ZEBRA)
        self.assertEqual(code, 0)
        self.assertLess(out.index("cart BEFORE"), out.index("cart AFTER"))
        self.assertIn("3 item(s)", out)
        self.assertIn("-- cart AFTER: 2 item(s)", out)
        self.assertIn("VERIFIED", out)
        self.assertEqual(FakeBackend.instances[0].remove_calls, ["42222222"])
        self.assertEqual([i["id"] for i in FakeBackend.instances[0].items], ["41111111", "43333333"])
        self.assertEqual(logs[0]["status"], "cart_removed")
        self.assert_no_buy_side_effects()

    def test_remove_not_in_cart_refuses(self):
        code, _, err, logs = self.go("cart-remove", "--url", "https://www.galaxus.ch/fr/s12/product/x-99999999")
        self.assertEqual(code, 1)
        self.assertIn("not in the cart", err)
        self.assertEqual(FakeBackend.instances[0].remove_calls, [])
        self.assertEqual(logs[0]["status"], "cart_refused")

    def test_remove_bad_url_usage(self):
        FakeBackend.instances.clear()
        code, _, err, _ = self.go("cart-remove", "--url", "https://www.galaxus.ch/fr/cart")
        self.assertEqual(code, 2)
        self.assertEqual(FakeBackend.instances, [])

    def test_clear_keep_dry_run(self):
        code, out, _, logs = self.go("cart-clear", "--keep", ARTDEV, "--dry-run")
        self.assertEqual(code, 0)
        self.assertIn("WOULD REMOVE: [42222222]", out)
        self.assertIn("WOULD REMOVE: [43333333]", out)
        self.assertNotIn("WOULD REMOVE: [41111111]", out)
        self.assertEqual(FakeBackend.instances[0].remove_calls, [])
        self.assertEqual([l["status"] for l in logs], ["dry_run_cart_remove"] * 2)

    def test_clear_keep_real_removes_only_others(self):
        code, out, _, _ = self.go("cart-clear", "--keep", ARTDEV)
        b = FakeBackend.instances[0]
        self.assertEqual(code, 0)
        self.assertEqual(b.remove_calls, ["42222222", "43333333"])
        self.assertEqual([i["id"] for i in b.items], ["41111111"])
        self.assertIn("-- cart AFTER: 1 item(s)", out)
        self.assertIn("VERIFIED", out)
        self.assert_no_buy_side_effects()

    def test_clear_keep_repeatable(self):
        code, *_ = self.go("cart-clear", "--keep", ARTDEV, "--keep", ZIPRO)
        self.assertEqual(code, 0)
        self.assertEqual(FakeBackend.instances[0].remove_calls, ["42222222"])

    def test_clear_requires_keep(self):
        FakeBackend.instances.clear()
        with redirect_stderr(io.StringIO()), self.assertRaises(SystemExit) as cm:
            gb.main(["cart-clear"], backend_factory=FakeBackend, now_log=lambda p, **r: None)
        self.assertEqual(cm.exception.code, 2)
        self.assertEqual(FakeBackend.instances, [])

    def test_clear_typo_guard_keep_not_in_cart(self):
        code, _, err, _ = self.go("cart-clear", "--keep", "https://www.galaxus.ch/fr/s12/product/x-99999999")
        self.assertEqual(code, 1)
        self.assertIn("typo guard", err)
        self.assertEqual(FakeBackend.instances[0].remove_calls, [])

    def test_clear_nothing_to_remove(self):
        FakeBackend.initial_cart = [i for i in gb.parse_cart(fixture("cart.html"))["items"] if i["id"] == "41111111"]
        out, err = io.StringIO(), io.StringIO()
        with redirect_stdout(out), redirect_stderr(err):
            code = gb.main(["cart-clear", "--keep", ARTDEV], backend_factory=FakeBackend, now_log=lambda p, **r: None)
        self.assertEqual(code, 0)
        self.assertIn("nothing to remove", out.getvalue())

    def test_verify_fails_when_removal_did_not_stick(self):
        FakeBackend.instances.clear()
        FakeBackend.removal_works = False
        out, err = io.StringIO(), io.StringIO()
        with redirect_stdout(out), redirect_stderr(err):
            code = gb.main(["cart-remove", "--url", ZEBRA, "--log", self.log], backend_factory=FakeBackend, now_log=lambda p, **r: None)
        FakeBackend.removal_works = True
        self.assertEqual(code, 1)
        self.assertIn("VERIFY FAILED", err.getvalue())

    def test_search_and_buy_never_remove(self):
        run(["search", "x"])
        run(["buy", "--url", "https://www.galaxus.ch/p", "--log", self.log])
        self.assertTrue(all(b.remove_calls == [] for b in FakeBackend.instances))

    def test_antibot_during_cart_exit3(self):
        class B(FakeBackend):
            def cart_items(self):
                raise gb.AntiBotError("captcha")
        logs = []
        with redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
            code = gb.main(["cart-remove", "--url", ZEBRA], backend_factory=B, now_log=lambda p, **r: logs.append(r))
        self.assertEqual(code, 3)
        self.assertEqual(logs[0]["status"], "blocked")

    def test_no_pay_or_checkout_code_path_in_cart_commands(self):
        import inspect
        for fn in (gb.cmd_cart_list, gb.cmd_cart_remove, gb.cmd_cart_clear, gb._cart_apply):
            src = inspect.getsource(fn)
            for banned in ("pay(", "confirm_pay", "checkout", "add_to_cart"):
                self.assertNotIn(banned, src)
        self.assertNotIn("confirm", gb.build_parser().parse_args(["cart-clear", "--keep", ARTDEV]).__dict__)


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


class TestPayOutcomes(Base):
    def _run(self, status):
        import galaxus_buy as g
        class B:
            def add_to_cart(self, url): return {"shipping_chf": 0.0, "delivery": None, "cart_total_chf": 139.0, "items": 1, "cart_url": "c", "checkout_url": "k"}
            def pay(self): return {"status": status, "order": None, "url": "https://www.paypal.com/x"}
            def close(self): pass
        logs = []
        with tempfile.TemporaryDirectory() as d:
            cfg = os.path.join(d, "a.json"); open(cfg, "w").write('{"auto_buy_max_chf":150,"daily_max_chf":500}')
            os.environ["JARVIS_ACHAT_CONFIG"] = cfg
            a = g.build_parser().parse_args(["buy", "--url", "https://www.galaxus.ch/fr/s3/product/x-1234567", "--confirm-pay", "--log", os.path.join(d, "l.jsonl")])
            page = '<script type="application/ld+json">{"@type":"Product","name":"X","offers":{"price":"139"}}</script>'
            with redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
                code = g.cmd_buy(a, lambda u: page, lambda: B(), lambda p, **r: logs.append(r))
            os.environ.pop("JARVIS_ACHAT_CONFIG", None)
        return code, logs[-1]["status"]

    def test_paypal_redirect_is_not_paid(self):
        self.assertEqual(self._run("needs_paypal"), (4, "pending_needs_paypal"))

    def test_unknown_is_not_paid(self):
        self.assertEqual(self._run("unknown"), (4, "pending_unknown"))

    def test_confirmed_is_paid(self):
        self.assertEqual(self._run("confirmed"), (0, "paid"))


if __name__ == "__main__":
    unittest.main()
