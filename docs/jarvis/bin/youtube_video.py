#!/usr/bin/env python3
"""youtube-video: read ONE public YouTube video (read-only, no login, no cookie): metadata + transcript if available.

Usage:
  youtube_video.py <url> [--no-transcript] [--lang fr,en] [--text] [--log PATH]
  youtube_video.py <url> --from-html watch.html          (offline parse of a saved watch page, no network)

Sources, best first:
  1. YouTube Data API v3 (videos.list + channels.list) when env YOUTUBE_API_KEY is set: title, channel, subscribers,
     channel creation date, publish date, views, duration, description, tags. Key only from env, masked everywhere.
  2. Public watch page (HTTP GET, ytInitialData / ytInitialPlayerResponse): title, channel, subscribers, views,
     date, description (+ duration/tags/caption tracks only when YouTube serves the player response).
No key => keyless mode, stated in the output (`source`), nothing invented: missing fields stay null.

Transcript (manual or auto captions): needs the watch page's caption track list, then the public timedtext URL.
The Data API cannot download captions with a key (needs OAuth), so it never gives transcripts. From datacenter IPs
YouTube often serves "Sign in to confirm you're not a bot" (no tracks) and/or an empty timedtext body (PO token
required): reported as transcript.status="unavailable" + reason, never retried in a loop, never faked.

Read-only: GET only. Caps: JARVIS_MAX_PAGE_MB per page (default 4 here), 1 MB per transcript, <= 3 attempts on
network/5xx errors, none on 401/403/429/captcha. Private/loopback targets refused; transcript URLs must be youtube.com.
Visit log JSONL (no content, no key): JARVIS_WEB_LOG.

Exit codes: 0 ok | 1 error | 2 usage | 3 blocked (nothing extracted).
"""
import argparse
import datetime
import html as htmllib
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request

import jarvis_web as jw

EXIT_OK, EXIT_ERR, EXIT_USAGE, EXIT_BLOCKED = 0, 1, 2, 3
YT_HOSTS = {"youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be", "www.youtu.be"}
ID_RE = re.compile(r"^[A-Za-z0-9_-]{11}$")
API_BASE = "https://www.googleapis.com/youtube/v3/"
WATCH_MAX_MB = 4.0
TRANSCRIPT_MAX_BYTES = 1024 * 1024
EN_HEADERS = {"Accept-Language": "en-US,en;q=0.9"}


class ApiAuthError(Exception):
    pass


# ---------- url ----------
def parse_video_url(url):
    """-> (video_id, canonical_url). ValueError if not a YouTube video URL."""
    u = urllib.parse.urlsplit((url or "").strip())
    host = (u.hostname or "").lower()
    if u.scheme not in ("http", "https") or host not in YT_HOSTS:
        raise ValueError("not a youtube.com / youtu.be url")
    vid = None
    if host.endswith("youtu.be"):
        vid = u.path.strip("/").split("/")[0]
    elif u.path == "/watch":
        vid = (urllib.parse.parse_qs(u.query).get("v") or [None])[0]
    else:
        m = re.match(r"^/(?:shorts|embed|live|v)/([^/?]+)", u.path)
        vid = m.group(1) if m else None
    if not vid or not ID_RE.match(vid):
        raise ValueError("no valid 11-char video id in url")
    return vid, f"https://www.youtube.com/watch?v={vid}"


# ---------- small parsers ----------
_SUBS_RE = re.compile(r"([\d][\d.,\u00a0\u202f ]*)\s*(K|M|B|thousand|million|billion|mille|Mio)?\.?\s*(?:d['’]\s*)?(?:subscribers?|abonn)", re.I)
_MULT = {"k": 1e3, "thousand": 1e3, "mille": 1e3, "m": 1e6, "million": 1e6, "mio": 1e6, "b": 1e9, "billion": 1e9}


def parse_subscribers(text):
    """'125K subscribers' -> 125000 ; '1.2M subscribers' -> 1200000 ; '1,234 subscribers' -> 1234 ; None if unknown."""
    if not text:
        return None
    m = _SUBS_RE.search(str(text))
    if not m:
        return None
    num, suf = re.sub(r"[\s\u00a0\u202f]", "", m.group(1)), (m.group(2) or "").lower()
    try:
        if suf:
            return int(round(float(num.replace(",", ".") if "." not in num else num.replace(",", "")) * _MULT[suf]))
        return int(re.sub(r"[.,]", "", num))
    except ValueError:
        return None


def parse_count(text):
    """'36,472 views' / '36472' -> 36472."""
    if text is None:
        return None
    digits = re.sub(r"[^\d]", "", str(text))
    return int(digits) if digits else None


def parse_date_text(text):
    """'Nov 19, 2026' / 'Premiered on Sep 2, 2024' -> '2026-11-19'. None if unparseable."""
    if not text:
        return None
    t = re.sub(r"^(Premiered|Streamed live|Started streaming|Premiered on|Streamed live on|Started streaming on)\s*(on)?\s*", "", str(text).strip(), flags=re.I)
    for fmt in ("%b %d, %Y", "%B %d, %Y", "%d %b %Y", "%Y-%m-%d"):
        try:
            return datetime.datetime.strptime(t, fmt).date().isoformat()
        except ValueError:
            continue
    m = re.match(r"^(\d{4}-\d{2}-\d{2})", t)
    return m.group(1) if m else None


def parse_iso_duration(s):
    """'PT1H2M3S' -> 3723."""
    m = re.match(r"^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$", s or "")
    if not m:
        return None
    d, h, mi, se = (int(x or 0) for x in m.groups())
    return d * 86400 + h * 3600 + mi * 60 + se


def _json_after(html, name):
    m = re.search(re.escape(name) + r'["\]]?\s*=\s*', html)
    if not m:
        return None
    try:
        obj, _ = json.JSONDecoder().raw_decode(html[m.end():])
        return obj
    except ValueError:
        return None


def _find(o, key, out=None, limit=50):
    out = [] if out is None else out
    if len(out) >= limit:
        return out
    if isinstance(o, dict):
        for k, v in o.items():
            if k == key:
                out.append(v)
            _find(v, key, out, limit)
    elif isinstance(o, list):
        for x in o:
            _find(x, key, out, limit)
    return out


def _runs(node):
    if not isinstance(node, dict):
        return None
    if node.get("simpleText"):
        return node["simpleText"]
    if node.get("runs"):
        return "".join(r.get("text", "") for r in node["runs"])
    return None


def parse_watch_page(html, video_id=None):
    """Extract what the public watch page exposes. Missing fields are None. Never raises on odd markup."""
    out = {"title": None, "channel_name": None, "channel_id": None, "channel_url": None, "subscribers": None,
           "published_at": None, "views": None, "duration_seconds": None, "description": None, "tags": [],
           "playability": None, "playability_reason": None, "caption_tracks": []}
    data = _json_after(html, "ytInitialData") or {}
    pr = _json_after(html, "ytInitialPlayerResponse") or {}
    vp = (_find(data, "videoPrimaryInfoRenderer", limit=1) or [{}])[0]
    out["title"] = _runs(vp.get("title"))
    vc = (_find(vp, "originalViewCount", limit=1) or [None])[0]
    out["views"] = parse_count(vc) if vc else parse_count(_runs(((vp.get("viewCount") or {}).get("videoViewCountRenderer") or {}).get("viewCount")))
    out["published_at"] = parse_date_text(_runs(vp.get("dateText")))
    owner = (_find(data, "videoOwnerRenderer", limit=1) or [{}])[0]
    out["channel_name"] = _runs(owner.get("title"))
    be = ((owner.get("navigationEndpoint") or {}).get("browseEndpoint")) or {}
    out["channel_id"] = be.get("browseId")
    if be.get("canonicalBaseUrl"):
        out["channel_url"] = "https://www.youtube.com" + be["canonicalBaseUrl"]
    sub = owner.get("subscriberCountText") or {}
    out["subscribers"] = parse_subscribers(_runs(sub) or ((sub.get("accessibility") or {}).get("accessibilityData") or {}).get("label"))
    ad = (_find(data, "attributedDescription", limit=1) or [None])[0]
    if isinstance(ad, dict) and ad.get("content"):
        out["description"] = ad["content"]
    ps = pr.get("playabilityStatus") or {}
    out["playability"], out["playability_reason"] = ps.get("status"), ps.get("reason")
    vd = pr.get("videoDetails") or {}
    if vd and (video_id is None or vd.get("videoId") == video_id):
        out["title"] = vd.get("title") or out["title"]
        out["channel_name"] = vd.get("author") or out["channel_name"]
        out["channel_id"] = vd.get("channelId") or out["channel_id"]
        out["views"] = parse_count(vd.get("viewCount")) if vd.get("viewCount") else out["views"]
        out["duration_seconds"] = int(vd["lengthSeconds"]) if str(vd.get("lengthSeconds", "")).isdigit() else None
        out["description"] = vd.get("shortDescription") or out["description"]
        out["tags"] = list(vd.get("keywords") or [])
        pm = ((pr.get("microformat") or {}).get("playerMicroformatRenderer")) or {}
        out["published_at"] = parse_date_text(pm.get("publishDate") or pm.get("uploadDate")) or out["published_at"]
        out["caption_tracks"] = (((pr.get("captions") or {}).get("playerCaptionsTracklistRenderer")) or {}).get("captionTracks") or []
    return out


# ---------- transcript ----------
def pick_track(tracks, langs=("fr", "en")):
    """Prefer manual over auto within the first matching language; else first manual; else first auto."""
    def lang_ok(t, l):
        return (t.get("languageCode") or "").lower().split("-")[0] == l
    for l in langs:
        cand = [t for t in tracks if lang_ok(t, l)]
        if cand:
            return sorted(cand, key=lambda t: t.get("kind") == "asr")[0]
    return sorted(tracks, key=lambda t: t.get("kind") == "asr")[0] if tracks else None


def parse_timedtext(body):
    """json3 or XML timedtext -> list of (start_seconds, text). Empty list if nothing parseable."""
    body = (body or "").strip()
    segs = []
    if not body:
        return segs
    if body.startswith("{"):
        try:
            for ev in json.loads(body).get("events", []):
                txt = "".join(s.get("utf8", "") for s in ev.get("segs", []) or []).replace("\n", " ").strip()
                if txt:
                    segs.append(((ev.get("tStartMs") or 0) / 1000.0, htmllib.unescape(txt)))
        except ValueError:
            return []
        return segs
    for m in re.finditer(r'<text[^>]*?start="([\d.]+)"[^>]*>(.*?)</text>', body, re.S):
        txt = htmllib.unescape(re.sub(r"<[^>]+>", "", htmllib.unescape(m.group(2)))).replace("\n", " ").strip()
        if txt:
            segs.append((float(m.group(1)), txt))
    return segs


def segments_to_text(segs):
    out, prev = [], None
    for _, t in segs:
        if t != prev:
            out.append(t)
        prev = t
    return re.sub(r"\s+", " ", " ".join(out)).strip()


def fetch_transcript(tracks, langs, log, vid, http=jw.http_get):
    """-> dict(status, reason, lang, kind, segments, text). One attempt chain (http_get caps retries); never raises."""
    base = {"status": "unavailable", "reason": None, "lang": None, "kind": None, "segments": 0, "text": ""}
    tr = pick_track(tracks or [], langs)
    if not tr:
        return dict(base, reason="no caption tracks exposed by the watch page")
    url = tr.get("baseUrl") or ""
    host = (urllib.parse.urlsplit(url).hostname or "").lower()
    if not (host == "youtube.com" or host.endswith(".youtube.com")):
        return dict(base, reason="caption url not on youtube.com: refused")
    sep = "&" if "?" in url else "?"
    try:
        status, body, nbytes = http(url + sep + "fmt=json3", max_bytes=TRANSCRIPT_MAX_BYTES, headers=EN_HEADERS, any_type=True)
    except jw.AntiBotError as e:
        jw.log_visit(log, "youtube_video", url, engine="http", outcome="antibot", error=str(e), vid=vid, what="timedtext")
        return dict(base, reason=f"blocked: {jw.mask(e)}")
    except jw.FetchError as e:
        jw.log_visit(log, "youtube_video", url, engine="http", outcome="error", error=str(e), vid=vid, what="timedtext")
        return dict(base, reason=f"error: {jw.mask(e)}")
    jw.log_visit(log, "youtube_video", url, engine="http", status=status, bytes=nbytes, outcome="ok" if body.strip() else "empty", vid=vid, what="timedtext")
    segs = parse_timedtext(body)
    if not segs:
        return dict(base, reason="timedtext body empty or unparseable (YouTube often requires a PO token from datacenter IPs)",
                    lang=tr.get("languageCode"), kind="auto" if tr.get("kind") == "asr" else "manual")
    return {"status": "ok", "reason": None, "lang": tr.get("languageCode"), "kind": "auto" if tr.get("kind") == "asr" else "manual",
            "segments": len(segs), "text": segments_to_text(segs)}


# ---------- Data API ----------
def api_get(path, params, key, opener=None, sleep=None, timeout=20):
    """GET one Data API call. <= 3 attempts on network/5xx; none on 400/401/403/429. Key masked in every error."""
    import time
    sleep = sleep or time.sleep
    q = dict(params, key=key)
    url = API_BASE + path + "?" + urllib.parse.urlencode(q)
    op = opener or urllib.request.urlopen
    last = None
    for attempt in range(1, jw.MAX_ATTEMPTS + 1):
        try:
            with op(urllib.request.Request(url, headers={"User-Agent": "jarvis-youtube/1", "Accept": "application/json"}), timeout=timeout) as r:
                return json.loads(r.read(2 * 1024 * 1024).decode("utf-8", "replace"))
        except urllib.error.HTTPError as e:
            if e.code in (400, 401, 403, 429):
                reason = {400: "bad request / invalid key", 401: "unauthorized", 403: "forbidden or quota exceeded", 429: "rate limited"}[e.code]
                raise ApiAuthError(f"youtube api HTTP {e.code} ({reason})")
            if e.code < 500:
                raise jw.FetchError(f"youtube api HTTP {e.code}")
            last = f"HTTP {e.code}"
        except (urllib.error.URLError, TimeoutError, ConnectionError, ValueError) as e:
            last = jw.mask(getattr(e, "reason", e), extra=[key])
        if attempt < jw.MAX_ATTEMPTS:
            sleep(2 * attempt)
    raise jw.FetchError(f"youtube api failed after {jw.MAX_ATTEMPTS} attempts: {last}")


def api_videos(ids, key, **kw):
    """videos.list for up to 50 ids -> {id: item}."""
    out = {}
    ids = list(dict.fromkeys(ids))
    for i in range(0, len(ids), 50):
        d = api_get("videos", {"part": "snippet,statistics,contentDetails", "id": ",".join(ids[i:i + 50]), "maxResults": 50}, key, **kw)
        for it in d.get("items", []):
            out[it["id"]] = it
    return out


def api_channels(ids, key, **kw):
    out = {}
    ids = list(dict.fromkeys(ids))
    for i in range(0, len(ids), 50):
        d = api_get("channels", {"part": "snippet,statistics", "id": ",".join(ids[i:i + 50]), "maxResults": 50}, key, **kw)
        for it in d.get("items", []):
            out[it["id"]] = it
    return out


def api_search(q, key, max_results=10, lang="fr", **kw):
    """search.list (100 quota units per call) -> list of video ids."""
    d = api_get("search", {"part": "snippet", "type": "video", "q": q, "maxResults": max(1, min(max_results, 25)),
                           "relevanceLanguage": lang, "order": "relevance", "safeSearch": "none"}, key, **kw)
    return [it["id"]["videoId"] for it in d.get("items", []) if (it.get("id") or {}).get("videoId")]


def video_from_api(item, channel=None):
    sn, st, cd = item.get("snippet") or {}, item.get("statistics") or {}, item.get("contentDetails") or {}
    ch = channel or {}
    chs, chn = ch.get("statistics") or {}, ch.get("snippet") or {}
    subs = None if chs.get("hiddenSubscriberCount") else (int(chs["subscriberCount"]) if str(chs.get("subscriberCount", "")).isdigit() else None)
    return {"title": sn.get("title"), "channel_name": sn.get("channelTitle"), "channel_id": sn.get("channelId"),
            "channel_url": f"https://www.youtube.com/channel/{sn['channelId']}" if sn.get("channelId") else None,
            "subscribers": subs, "channel_created": (chn.get("publishedAt") or "")[:10] or None,
            "published_at": (sn.get("publishedAt") or "")[:10] or None,
            "views": int(st["viewCount"]) if str(st.get("viewCount", "")).isdigit() else None,
            "duration_seconds": parse_iso_duration(cd.get("duration")), "description": sn.get("description"),
            "tags": list(sn.get("tags") or [])}


# ---------- orchestration ----------
def fetch_watch(vid, canon, log, http=jw.http_get):
    """-> parsed watch-page dict. Raises jw.AntiBotError / jw.FetchError."""
    import time
    t0 = time.time()
    url = canon + "&hl=en&gl=US"
    try:
        status, html, nbytes = http(url, max_bytes=jw.max_page_bytes(os.environ.get("JARVIS_MAX_PAGE_MB") or WATCH_MAX_MB), headers=EN_HEADERS)
    except jw.AntiBotError as e:
        jw.log_visit(log, "youtube_video", canon, engine="http", outcome="antibot", error=str(e), vid=vid, what="watch")
        raise
    except jw.FetchError as e:
        jw.log_visit(log, "youtube_video", canon, engine="http", outcome="error", error=str(e), vid=vid, what="watch")
        raise
    jw.log_visit(log, "youtube_video", canon, engine="http", status=status, bytes=nbytes, outcome="ok", vid=vid, what="watch",
                 ms=int((time.time() - t0) * 1000))
    return parse_watch_page(html, vid)


def get_video(url, env=None, want_transcript=True, langs=("fr", "en"), log=None, http=jw.http_get, api=None, html=None):
    """Full record for one video. api = dict of callables (videos, channels) for tests. Never raises on partial data;
    raises jw.AntiBotError/FetchError only when nothing at all could be read."""
    env = os.environ if env is None else env
    vid, canon = parse_video_url(url)
    log = log or jw.log_path(None)
    key = env.get("YOUTUBE_API_KEY") or ""
    rec = {"video_id": vid, "url": canon, "title": None, "channel_name": None, "channel_id": None, "channel_url": None,
           "subscribers": None, "channel_created": None, "published_at": None, "views": None, "duration_seconds": None,
           "description": None, "tags": [], "source": None, "notes": [],
           "transcript": {"status": "skipped", "reason": "--no-transcript / list-only", "lang": None, "kind": None, "segments": 0, "text": ""}}
    watch = None
    if key:
        try:
            a_videos = (api or {}).get("videos") or (lambda ids: api_videos(ids, key))
            a_channels = (api or {}).get("channels") or (lambda ids: api_channels(ids, key))
            items = a_videos([vid])
            if vid in items:
                chans = a_channels([items[vid]["snippet"]["channelId"]]) if items[vid].get("snippet", {}).get("channelId") else {}
                rec.update(video_from_api(items[vid], chans.get(items[vid]["snippet"].get("channelId"))))
                rec["source"] = "youtube_data_api"
            else:
                rec["notes"].append("video not returned by Data API (private/removed?)")
        except ApiAuthError as e:
            rec["notes"].append(jw.mask(e, extra=[key]) + ": fell back to keyless watch page")
        except jw.FetchError as e:
            rec["notes"].append(jw.mask(e, extra=[key]) + ": fell back to keyless watch page")
    else:
        rec["notes"].append("YOUTUBE_API_KEY absent: keyless mode (public watch page only)")
    need_watch = want_transcript or rec["source"] is None
    if need_watch:
        try:
            watch = parse_watch_page(html, vid) if html is not None else fetch_watch(vid, canon, log, http)
        except (jw.AntiBotError, jw.FetchError) as e:
            if rec["source"] is None:
                raise
            rec["notes"].append("watch page: " + jw.mask(e, extra=[key]))
    rec["_tracks"] = watch["caption_tracks"] if watch else None
    if watch:
        if rec["source"] is None:
            for k in ("title", "channel_name", "channel_id", "channel_url", "subscribers", "published_at", "views",
                      "duration_seconds", "description", "tags"):
                rec[k] = watch[k]
            rec["source"] = "watch_page"
            if not rec["title"]:
                rec["notes"].append(f"watch page gave no metadata (playability={watch['playability']}: {watch['playability_reason']})")
        if watch["playability"] and watch["playability"] != "OK":
            rec["notes"].append(f"player response: {watch['playability']} ({watch['playability_reason']})")
    if want_transcript:
        if watch is None:
            rec["transcript"] = dict(rec["transcript"], status="unavailable", reason="watch page not fetched")
        else:
            rec["transcript"] = fetch_transcript(watch["caption_tracks"], langs, log, vid, http)
    if not rec["title"] and rec["source"] is None:
        raise jw.FetchError("no data extracted")
    return rec


def ensure_transcript(rec, langs=("fr", "en"), log=None, http=jw.http_get):
    """Download the transcript for a record from get_video (reuses its caption tracks; fetches the watch page if needed)."""
    log = log or jw.log_path(None)
    tracks = rec.get("_tracks")
    if tracks is None:
        try:
            tracks = fetch_watch(rec["video_id"], rec["url"], log, http)["caption_tracks"]
        except (jw.AntiBotError, jw.FetchError) as e:
            rec["transcript"] = {"status": "unavailable", "reason": "watch page: " + jw.mask(e), "lang": None, "kind": None, "segments": 0, "text": ""}
            return rec["transcript"]
        rec["_tracks"] = tracks
    rec["transcript"] = fetch_transcript(tracks, langs, log, rec["video_id"], http)
    return rec["transcript"]


def render_text(r):
    ch = r.get("channel_name")
    L = [f"{r['title']}", f"{r['url']}", f"chaîne: {ch} (abonnés: {r.get('subscribers')}, créée: {r.get('channel_created')})",
         f"publiée: {r.get('published_at')}  vues: {r.get('views')}  durée (s): {r.get('duration_seconds')}  source: {r['source']}"]
    if r.get("tags"):
        L.append("tags: " + ", ".join(r["tags"][:15]))
    L += ["", "description:", (r.get("description") or "(vide)")[:1500], ""]
    t = r["transcript"]
    L.append(f"transcript: {t['status']}" + (f" ({t['lang']}, {t['kind']}, {t['segments']} segments)" if t["status"] == "ok" else f" ({t['reason']})"))
    if t["text"]:
        L.append(t["text"][:1500])
    for n in r["notes"]:
        L.append(f"note: {n}")
    return "\n".join(L)


def main(argv=None):
    ap = argparse.ArgumentParser(description="Read one public YouTube video (read-only).")
    ap.add_argument("url")
    ap.add_argument("--no-transcript", action="store_true")
    ap.add_argument("--lang", default="fr,en", help="preferred transcript languages, comma-separated")
    ap.add_argument("--text", action="store_true", help="human-readable output instead of JSON")
    ap.add_argument("--log", default=None, help="JSONL visit log path")
    ap.add_argument("--from-html", metavar="FILE", help="parse a saved watch page instead of fetching")
    a = ap.parse_args(argv)
    try:
        parse_video_url(a.url)
    except ValueError as e:
        print(f"usage: {e}", file=sys.stderr)
        return EXIT_USAGE
    html = None
    if a.from_html:
        with open(a.from_html, encoding="utf-8", errors="replace") as f:
            html = f.read()
    langs = tuple(x.strip().lower() for x in a.lang.split(",") if x.strip())
    try:
        rec = get_video(a.url, want_transcript=not a.no_transcript, langs=langs, log=jw.log_path(a.log), html=html)
    except jw.AntiBotError as e:
        print(f"blocked: {jw.mask(e)}", file=sys.stderr)
        return EXIT_BLOCKED
    except jw.FetchError as e:
        print(f"error: {jw.mask(e)}", file=sys.stderr)
        return EXIT_ERR
    rec = {k: v for k, v in rec.items() if not k.startswith("_")}
    rec["fetched_at"] = datetime.datetime.now().astimezone().isoformat(timespec="seconds")
    print(render_text(rec) if a.text else json.dumps(rec, ensure_ascii=False, indent=2))
    return EXIT_OK if rec["title"] else EXIT_BLOCKED


if __name__ == "__main__":
    sys.exit(main())
