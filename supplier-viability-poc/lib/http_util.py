"""HTTP helpers — polite rate limit, robots awareness, no CAPTCHA bypass."""

from __future__ import annotations

import time
import urllib.error
import urllib.request
from typing import Optional
from urllib.parse import urljoin, urlparse
from urllib.robotparser import RobotFileParser

USER_AGENT = "SupplierViabilityPOC/1.0 (+read-only research; respect robots.txt)"


class FetchError(Exception):
    def __init__(self, message: str, *, status: Optional[int] = None, blocked: bool = False):
        super().__init__(message)
        self.status = status
        self.blocked = blocked


class PoliteSession:
    def __init__(self, delay_s: float = 1.0, timeout_s: float = 30.0):
        self.delay_s = delay_s
        self.timeout_s = timeout_s
        self._last = 0.0
        self._robots: dict[str, RobotFileParser] = {}
        self.stats = {"ok": 0, "blocked": 0, "error": 0, "skipped_robots": 0}

    def _wait(self) -> None:
        elapsed = time.monotonic() - self._last
        if elapsed < self.delay_s:
            time.sleep(self.delay_s - elapsed)

    def allowed(self, url: str) -> bool:
        parsed = urlparse(url)
        origin = f"{parsed.scheme}://{parsed.netloc}"
        if origin not in self._robots:
            rp = RobotFileParser()
            robots_url = urljoin(origin + "/", "robots.txt")
            try:
                self._wait()
                req = urllib.request.Request(robots_url, headers={"User-Agent": USER_AGENT})
                with urllib.request.urlopen(req, timeout=self.timeout_s) as resp:
                    raw = resp.read().decode("utf-8", "ignore")
                self._last = time.monotonic()
                rp.parse(raw.splitlines())
            except Exception:
                rp = RobotFileParser()
                rp.parse(["User-agent: *", "Allow: /"])
            self._robots[origin] = rp
        return bool(self._robots[origin].can_fetch(USER_AGENT, url))

    def get(self, url: str, *, respect_robots: bool = True) -> tuple[int, str, bytes]:
        if respect_robots and not self.allowed(url):
            self.stats["skipped_robots"] += 1
            raise FetchError(f"robots.txt disallows {url}", blocked=False)
        self._wait()
        req = urllib.request.Request(
            url,
            headers={
                "User-Agent": USER_AGENT,
                "Accept": "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
                "Accept-Language": "de-CH,de;q=0.9,en;q=0.8",
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=self.timeout_s) as resp:
                body = resp.read()
                status = getattr(resp, "status", 200)
                ctype = resp.headers.get("Content-Type", "")
                self._last = time.monotonic()
                text_head = body[:4000].decode("utf-8", "ignore").lower()
                if (
                    status in (401, 403, 429, 503)
                    or "just a moment" in text_head
                    or "cf-browser-verification" in text_head
                    or "access denied" in text_head
                    or "challenge-platform" in text_head
                ):
                    self.stats["blocked"] += 1
                    raise FetchError("blocked_or_captcha", status=status, blocked=True)
                self.stats["ok"] += 1
                return status, ctype, body
        except FetchError:
            raise
        except urllib.error.HTTPError as e:
            self._last = time.monotonic()
            body = e.read() if hasattr(e, "read") else b""
            head = body[:2000].decode("utf-8", "ignore").lower()
            blocked = e.code in (401, 403, 429, 503) or "captcha" in head or "just a moment" in head
            self.stats["blocked" if blocked else "error"] += 1
            raise FetchError(f"HTTP {e.code}", status=e.code, blocked=blocked)
        except Exception as e:
            self.stats["error"] += 1
            self._last = time.monotonic()
            raise FetchError(str(e))


def get_text(session: PoliteSession, url: str) -> str:
    _, _, body = session.get(url)
    return body.decode("utf-8", "ignore")
