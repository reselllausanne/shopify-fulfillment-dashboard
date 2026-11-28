#!/usr/bin/env python3
"""insta-account: read the recent public posts/reels of ONE Instagram account (no login) and build a rule-based
content-strategy summary. Read-only. Reuses insta_reel.py (post parsing) and jarvis_web.py (browser, caps, log, masking).

Usage:
  insta_account.py <handle> [--limit 12] [--no-visual] [--dry-run] [--text]
  insta_account.py <handle> --urls-file posts.txt            posts you provide (one URL or shortcode per line, # comments)
  insta_account.py <handle> --seed-urls URL1 URL2 ...        same, inline
  insta_account.py <handle> --from-embed embed.html          offline: parse a saved <handle>/embed/ page

Writes (default docs/jarvis/inbox/sujets/<handle>/): <shortcode>.json per post (merged by post id, re-runnable without
duplicates) + resume-compte.md / resume-compte.json (regenerated from all post files + a dated journal).

HOW THE POST LIST IS FOUND (verified 2026-11-28 from a datacenter IP, no login, no cookie):
  - instagram.com/<handle>/ and /<handle>/reels/ redirect to the login page: blocked, not bypassed, not retried.
  - instagram.com/<handle>/embed/ (public profile embed, rendered by the script's own headless browser) exposes the
    profile header (followers, post count) and a short list of the latest posts (shortcode, date, caption, likes,
    comments, collaborators). It exposes only a few posts (6 on the tested account): --limit cannot go beyond that.
    If it is empty/blocked, use --urls-file / --seed-urls. Nothing is guessed or fabricated.

PER POST (insta_reel.build_result on /p/<code>/): caption, hashtags, mentions, date, likes, comments, music, tagged
accounts, auto alt-text, top comments. Then best-effort visual layer (unless --no-visual), every output marked uncertain:
  - transcript: NOT available (no local speech-to-text model; Instagram exposes no captions) -> status "unavailable".
  - media: only public CDN URLs (cdninstagram.com / fbcdn.net) found in the page JSON, size-capped (--max-video-mb),
    video -> N frames via ffmpeg (local file only) -> OCR via tesseract. Images -> OCR directly.
  - image description by a model: ONLY if a key is already in the env (OPENAI_API_KEY, ANTHROPIC_API_KEY, GEMINI_API_KEY,
    GOOGLE_API_KEY). This tool never calls such an API: with a key present it reports "key_present_not_used"; without,
    "not_configured". Decision point for Théo (which model, which budget).

ANALYSIS (rules only, no LLM): CTA regexes (comment "KEYWORD", DM, link in bio, URL, follow, lead magnet, book a call,
engagement question), keyword counts (captions + hashtags; alt-text/OCR counted apart as uncertain), caption structure
(hook, question, numbers, length, emoji-only), publication frequency (median gap, posts/week), collaborators, offer
signals. Every claim lists the post URLs + dates it comes from. Confirmé = backed by >= 2 posts with first-party fields
(caption/date/counts); Incertain = single post, OCR, alt-text, or sample too small.

Caps: --limit (default 12, max 30), per page JARVIS_MAX_PAGE_MB (default 6 here), --max-total-mb (default 60, pages +
media), --max-video-mb (default 25) , <= 3 attempts per page, no retry on 401/403/429/login wall, stop after 2
consecutive blocked posts. One headless browser (Camoufox default, --engine patchright), closed at the end, never the
Mac's Chrome. Optional proxy: env JARVIS_PROXY_URL (never logged). Visit log JSONL (no content, no query):
JARVIS_WEB_LOG, default ~/.local/share/jarvis-resell/web-visits.jsonl.

Exit codes: 0 ok | 1 error | 2 usage | 3 blocked (nothing extracted).
"""
import argparse
import collections
import datetime
import json
import os
import re
import shutil
import statistics
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request

import insta_reel as ir
import jarvis_web as jw

EXIT_OK, EXIT_ERR, EXIT_USAGE, EXIT_BLOCKED = 0, 1, 2, 3
HARD_MAX_LIMIT = 30
DEFAULT_LIMIT, DEFAULT_PAGE_MB, DEFAULT_TOTAL_MB, DEFAULT_VIDEO_MB = 12, 6.0, 60.0, 25.0
DEFAULT_OUT_ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "inbox", "sujets")
HANDLE_RE = re.compile(r"^(?!\.)(?!.*\.\.)(?!.*\.$)[A-Za-z0-9._]{1,30}$")
RESERVED = {"accounts", "explore", "p", "reel", "reels", "tv", "stories", "direct", "about", "web", "api", "oauth", "developer", "emails",
            "challenge", "legal", "privacy", "directory", "locations", "popular"}
SHORTCODE_RE = re.compile(r"^[A-Za-z0-9_-]{5,20}$")
MEDIA_HOST_SUFFIXES = ("cdninstagram.com", "fbcdn.net")
VISION_ENV = ("OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY")
FRAMES_PER_VIDEO = 4
MAX_MEDIA_PER_POST = 3


# ---------- handle / urls ----------
def validate_handle(raw):
    """Accepts 'name', '@name' or a profile URL. Returns the lowercase handle. ValueError otherwise (before ANY url is built)."""
    s = (raw or "").strip()
    if s.startswith(("http://", "https://")):
        u = urllib.parse.urlsplit(s)
        if (u.hostname or "").lower() not in ir.IG_HOSTS:
            raise ValueError("not an instagram.com profile url")
        parts = [p for p in u.path.split("/") if p]
        if len(parts) != 1:
            raise ValueError("profile url must be instagram.com/<handle>/")
        s = parts[0]
    s = s.lstrip("@")
    if not HANDLE_RE.match(s) or s.lower() in RESERVED or not re.search(r"[A-Za-z0-9]", s):
        raise ValueError("invalid instagram handle (letters, digits, '.', '_', max 30, no leading/trailing/double dot)")
    return s.lower()


def normalize_post_ref(ref):
    """URL or bare shortcode -> canonical /p/<code>/ URL. ValueError otherwise."""
    ref = (ref or "").strip()
    if SHORTCODE_RE.match(ref):
        return f"https://www.instagram.com/p/{ref}/", ref
    _, code, _ = ir.parse_ig_url(ref)
    return f"https://www.instagram.com/p/{code}/", code


def read_refs_file(path):
    out = []
    with open(path, encoding="utf-8") as f:
        for ln in f:
            ln = ln.split("#", 1)[0].strip() if not ln.strip().startswith("http") else ln.strip()
            if ln:
                out.append(ln)
    return out


# ---------- profile embed ----------
def _decode_context(html):
    m = re.search(r'"contextJSON":"((?:[^"\\]|\\.)*)"', html or "")
    if not m:
        return None
    try:
        return json.loads(json.loads('"' + m.group(1) + '"')).get("context")
    except ValueError:
        return None


def parse_profile_embed(html):
    """-> dict(username, full_name, followers, posts_count, posts=[stub...]) or None if the embed carries no profile context."""
    ctx = _decode_context(html)
    if not ctx or not ctx.get("username"):
        return None
    posts = []
    for g in ctx.get("graphql_media") or []:
        n = (g or {}).get("shortcode_media") or {}
        code = n.get("shortcode")
        if not code or not SHORTCODE_RE.match(code):
            continue
        ce = ((n.get("edge_media_to_caption") or {}).get("edges")) or []
        ts = n.get("taken_at_timestamp")
        posts.append({
            "shortcode": code, "url": f"https://www.instagram.com/p/{code}/",
            "media_kind": {"GraphVideo": "video", "GraphSidecar": "carousel", "GraphImage": "image"}.get(n.get("__typename"), "inconnu"),
            "posted_at": datetime.datetime.fromtimestamp(ts, datetime.timezone.utc).isoformat(timespec="seconds") if isinstance(ts, (int, float)) else None,
            "caption": (ce[0].get("node") or {}).get("text", "") if ce else "",
            "likes": (n.get("edge_liked_by") or {}).get("count"), "comments_count": (n.get("edge_media_to_comment") or {}).get("count"),
            "coauthors": [c.get("username") for c in (n.get("coauthor_producers") or []) if c.get("username")]})
    return {"username": ctx.get("username"), "full_name": ctx.get("full_name"), "followers": ctx.get("followers_count"),
            "posts_count": ctx.get("posts_count"), "posts": posts}


# ---------- CTA / structure rules ----------
_Q = "\"“'‘«"
_QE = "\"”'’»"
CTA_RULES = [
    ("comment_keyword", re.compile(r"\bcomment(?:e|ez|er)?\s*(?:below\s*|ci-dessous\s*)?[" + _Q + r"]\s*([^" + _QE + r"\n]{1,25}?)\s*[" + _QE + r"]", re.I)),
    ("comment_keyword", re.compile(r"\b(?i:comment(?:e|ez|er)?)\s+(?:(?i:the\s+word\s+|le\s+mot\s+))?([A-Z0-9][A-Z0-9_-]{2,19})\b")),
    ("dm", re.compile(r"\b(?:dm|dms)\b|envoie[- ]moi\s+un\s+(?:dm|message)|écris[- ]moi\s+en\s+(?:dm|privé)|send\s+me\s+a\s+(?:dm|message)", re.I)),
    ("link_in_bio", re.compile(r"link\s+in\s+(?:my\s+)?bio|bio\s+link|lien\s+(?:en|dans(?:\s+ma)?)\s+bio|lien\s+en\s+description", re.I)),
    ("follow", re.compile(r"\bfollow\s+(?:me|us|for|@)|\bfollow\b(?=.{0,20}(?:more|pour|for))|abonne[- ]toi|abonnez[- ]vous|suis[- ]moi|follow\s*(?:&|and)\s*(?:like|share)", re.I)),
    ("save_share", re.compile(r"\bsave\s+(?:this|it)\b|\bshare\s+(?:this|it|with)\b|\benregistre\b|\bpartage\s+(?:ce|cette|à)\b|\btag\s+(?:a|someone|your)\b", re.I)),
    ("lead_magnet", re.compile(r"free\s+(?:training|guide|course|template|workshop|webinar|masterclass|ebook|pdf|call|audit)|\bgratuit(?:e|s)?\b|waitlist|liste\s+d['’]attente|\bnewsletter\b", re.I)),
    ("book_call", re.compile(r"book\s+a\s+(?:free\s+)?(?:call|demo)|calendly|réserve\s+un\s+appel|prends?\s+rendez-vous", re.I)),
    ("comment_prompt", re.compile(r"(?:drop|leave|tell\s+me|let\s+me\s+know)[^.\n]{0,40}(?:comment|below)|(?:dis|dites)[- ]moi[^.\n]{0,30}commentaire|what\s+would\s+you|qu['’]en\s+penses[- ]tu", re.I)),
]
OFFER_RE = re.compile(r"\b(?:ai|ia|agents?|automat\w*|chatgpt|gpt|llm|saas|startup|business|revenue|clients?|leads?|funnel|sales?|vends?|vendre|build|run)\b", re.I)
SOCIAL_NOISE = ir.SOCIAL_NOISE


def detect_ctas(text):
    """-> list of {type, match, keyword?}; one entry per distinct (type, keyword). Rules only."""
    out, seen = [], set()
    text = text or ""
    for typ, rx in CTA_RULES:
        for m in rx.finditer(text):
            kw = (m.group(1).strip() if m.groups() and m.group(1) else None)
            key = (typ, (kw or "").lower())
            if key in seen:
                continue
            seen.add(key)
            e = {"type": typ, "match": m.group(0).strip()[:60]}
            if kw:
                e["keyword"] = kw
            out.append(e)
    for u in jw.extract_urls(text):
        d = jw.domain_of(u)
        if d and not any(d == n or d.endswith("." + n) for n in SOCIAL_NOISE):
            key = ("url", u)
            if key not in seen:
                seen.add(key)
                out.append({"type": "url_in_caption", "match": u[:80]})
    if re.search(r"\?\s*$", text.strip()) and not any(c["type"] == "comment_prompt" for c in out):
        out.append({"type": "engagement_question", "match": "caption ends with a question"})
    return out


def caption_structure(text):
    t = (text or "").strip()
    words = re.findall(r"\w+", t, re.UNICODE)
    first = re.split(r"(?<=[.!?…])\s+|\n", t, maxsplit=1)[0].strip() if t else ""
    return {"empty": not t, "emoji_or_symbol_only": bool(t) and not re.search(r"[A-Za-z0-9À-ÿ]", t), "words": len(words),
            "lines": len([x for x in t.splitlines() if x.strip()]), "hook": first[:120],
            "question_hook": first.endswith("?"), "has_numbers": bool(re.search(r"\d|[$€%]", t)),
            "length_bucket": "vide" if not words else "court (<=8 mots)" if len(words) <= 8 else "moyenne (9-40)" if len(words) <= 40 else "longue (>40)"}


STOP = set("""the and for are but not you your with this that these those from have has had was were will would can could should about into over than
then them they their there here what when where which who how why all any each more most other some such only own same too very just also its our out
off per via got get let like make made one two see say said been being does did doing because while after before him her his she he we us me my
le la les un une des du de et en au aux ce ces cet cette mon ton son sa ses mes tes nos vos leurs leur notre votre je tu il elle on nous vous ils
elles qui que quoi dont où pour par avec sans sous sur dans chez vers entre mais ou donc ni car si comme plus moins très trop aussi encore déjà
fait faire être avoir est sont pas non oui tout tous toute toutes autre autres même quand comment pourquoi alors ainsi cela ça com www http https
instagram follow comment link bio dm video reel post photo image may shown text""".split())


def tokens(text):
    out = []
    for t in re.findall(r"[^\W_][\w'’-]*", re.sub(r"https?://\S+", " ", (text or "").lower()), re.UNICODE):
        t = re.sub(r"['’]s$", "", t.strip("'’-"))
        if len(t) > 4 and t.endswith("s") and not t.endswith(("ss", "us", "is")):
            t = t[:-1]
        if len(t) >= 3 and t not in STOP and not (t.isdigit() and len(t) < 4):
            out.append(t)
    return out


# ---------- visual layer ----------
class TooLarge(Exception):
    pass


class Budget:
    def __init__(self, total_bytes):
        self.total, self.used = total_bytes, 0

    def spend(self, n):
        self.used += int(n or 0)

    @property
    def left(self):
        return max(0, self.total - self.used)


def media_host_ok(url):
    h = (urllib.parse.urlsplit(url).hostname or "").lower()
    return any(h == s or h.endswith("." + s) for s in MEDIA_HOST_SUFFIXES)


def _media_log_url(url):
    """CDN paths embed signed ids: log scheme+host only."""
    u = urllib.parse.urlsplit(url)
    return f"{u.scheme}://{u.netloc}/(media)"


def download_capped(url, max_bytes, log, what, opener=None, sleep=time.sleep):
    """GET a public CDN media file, hard size cap. <= 3 attempts on network/5xx, none on 401/403/404/429.
    Only cdninstagram.com / fbcdn.net hosts, public addresses only. -> bytes."""
    if not media_host_ok(url):
        raise jw.UnsafeUrlError("media host not allowed")
    jw.check_public_url(url)
    op = opener or urllib.request.build_opener(jw._SafeRedirect).open
    last = None
    for attempt in range(1, jw.MAX_ATTEMPTS + 1):
        t0 = time.time()
        try:
            req = urllib.request.Request(url, headers={"User-Agent": jw.UA, "Accept": "*/*"})
            with op(req, timeout=30) as r:
                clen = int(r.headers.get("Content-Length") or 0)
                if clen and clen > max_bytes:
                    raise TooLarge(f"content-length {clen} > cap {max_bytes}")
                buf, total = [], 0
                while True:
                    chunk = r.read(65536)
                    if not chunk:
                        break
                    total += len(chunk)
                    if total > max_bytes:
                        raise TooLarge(f"body exceeds cap {max_bytes}")
                    buf.append(chunk)
            jw.log_visit(log, "insta_account", _media_log_url(url), engine="http", status=200, bytes=total, outcome="ok", what=what, attempt=attempt,
                         ms=int((time.time() - t0) * 1000))
            return b"".join(buf)
        except TooLarge:
            jw.log_visit(log, "insta_account", _media_log_url(url), engine="http", outcome="too_large", what=what, attempt=attempt)
            raise
        except urllib.error.HTTPError as e:
            jw.log_visit(log, "insta_account", _media_log_url(url), engine="http", status=e.code, outcome="error", what=what, attempt=attempt)
            if e.code < 500:
                raise jw.FetchError(f"HTTP {e.code}")
            last = f"HTTP {e.code}"
        except (urllib.error.URLError, TimeoutError, ConnectionError, OSError) as e:
            last = jw.mask(getattr(e, "reason", e))
            jw.log_visit(log, "insta_account", _media_log_url(url), engine="http", outcome="error", error=last, what=what, attempt=attempt)
        if attempt < jw.MAX_ATTEMPTS:
            sleep(2 * attempt)
    raise jw.FetchError(f"download failed after {jw.MAX_ATTEMPTS} attempts: {last}")


def detect_tools(which=shutil.which, run=subprocess.run):
    t = {"ffmpeg": bool(which("ffmpeg")), "ffprobe": bool(which("ffprobe")), "tesseract": bool(which("tesseract")), "ocr_lang": None}
    if t["tesseract"]:
        try:
            out = run(["tesseract", "--list-langs"], capture_output=True, text=True, timeout=15).stdout.split()
            langs = [l for l in ("eng", "fra") if l in out]
            t["ocr_lang"] = "+".join(langs) or None
        except (OSError, subprocess.SubprocessError):
            pass
    return t


def vision_status(env):
    present = [k for k in VISION_ENV if env.get(k)]
    if present:
        return {"status": "key_present_not_used", "env_names": present,
                "note": "a model key exists in env but this tool never calls a vision API: decision needed (model, budget)"}
    return {"status": "not_configured", "env_checked": list(VISION_ENV),
            "note": "no vision model/key provided: no image description; frames + OCR + auto alt-text only (uncertain)"}


def clean_ocr(text):
    seen, out = set(), []
    for ln in (text or "").splitlines():
        ln = re.sub(r"\s+", " ", ln).strip()
        alnum = sum(c.isalnum() for c in ln)
        if len(ln) < 3 or alnum < 3 or alnum / max(1, len(ln)) < 0.55:
            continue
        k = ln.lower()
        if k not in seen:
            seen.add(k)
            out.append(ln)
    return out


def run_tool(cmd, timeout, run=subprocess.run):
    return run(cmd, capture_output=True, timeout=timeout, text=True)


def video_duration(path, run=run_tool):
    try:
        r = run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", path], 20)
        return float((r.stdout or "").strip())
    except (OSError, ValueError, subprocess.SubprocessError):
        return None


def extract_frames(path, out_dir, n=FRAMES_PER_VIDEO, run=run_tool):
    """ffmpeg on a LOCAL file only. -> list of png paths (may be shorter than n)."""
    dur = video_duration(path, run)
    stamps = [dur * f for f in (0.1, 0.35, 0.6, 0.85)][:n] if dur and dur > 0 else [0.0]
    frames = []
    for i, ts in enumerate(stamps):
        out = os.path.join(out_dir, f"f{i}.png")
        try:
            run(["ffmpeg", "-nostdin", "-loglevel", "error", "-y", "-protocol_whitelist", "file", "-ss", f"{ts:.2f}", "-i", path,
                 "-frames:v", "1", "-vf", "scale='min(1080,iw)':-2", out], 60)
        except (OSError, subprocess.SubprocessError):
            continue
        if os.path.exists(out) and os.path.getsize(out) > 0:
            frames.append(out)
    return frames


OCR_MIN_CONF = 70
OCR_MIN_WORD = 4  # photos give short low-value fragments ("WSs", "SSS"); real overlay text has longer words


def parse_tsv_lines(tsv, min_conf=OCR_MIN_CONF):
    """tesseract TSV -> text lines made only of words with confidence >= min_conf (photos yield mostly low-confidence noise)."""
    lines = collections.OrderedDict()
    for row in (tsv or "").splitlines()[1:]:
        c = row.split("\t")
        if len(c) < 12:
            continue
        try:
            conf = float(c[10])
        except ValueError:
            continue
        w = c[11].strip()
        if conf >= min_conf and sum(ch.isalnum() for ch in w) >= OCR_MIN_WORD:
            lines.setdefault((c[2], c[3], c[4]), []).append(w)
    return clean_ocr("\n".join(" ".join(ws) for ws in lines.values()))


def ocr_image(path, lang, run=run_tool):
    cmd = ["tesseract", path, "stdout", "--psm", "11"] + (["-l", lang] if lang else []) + ["tsv"]
    r = run(cmd, 45)
    return parse_tsv_lines(r.stdout or "")


def shrink_image(path, out, run=run_tool):
    """Downscale (<=1280 px wide) with ffmpeg for faster OCR; falls back to the original file."""
    try:
        run(["ffmpeg", "-nostdin", "-loglevel", "error", "-y", "-protocol_whitelist", "file", "-i", path, "-vf", "scale='min(1280,iw)':-2", out], 30)
        if os.path.exists(out) and os.path.getsize(out) > 0:
            return out
    except (OSError, subprocess.SubprocessError):
        pass
    return path


def analyze_media(items, env, tools, budget, max_video_bytes, log, dl=download_capped, run=run_tool, workdir=None):
    """Best-effort frames + OCR for the public media of one post. Never raises. Every result is 'incertain'."""
    res = {"status": "skipped", "reason": None, "media": [], "ocr_lines": [], "vision_model": vision_status(env), "confidence": "incertain"}
    if not items:
        res["reason"] = "no public media url in the page JSON"
        return res
    if not tools.get("tesseract") and not tools.get("ffmpeg"):
        res["reason"] = "neither ffmpeg nor tesseract available"
        return res
    ok = 0
    with tempfile.TemporaryDirectory(dir=workdir) as td:
        for idx, it in enumerate(items[:MAX_MEDIA_PER_POST]):
            m = {"type": it["type"], "status": "failed", "reason": None, "bytes": 0, "frames": 0, "ocr_lines": []}
            res["media"].append(m)
            if budget.left <= 0:
                m["reason"] = "total byte budget exhausted"
                continue
            cap = min(max_video_bytes if it["type"] == "video" else max_video_bytes // 2, budget.left)
            data = None
            for v in it["versions"][:2]:
                try:
                    data = dl(v["url"], cap, log, it["type"])
                    break
                except TooLarge as e:
                    m["reason"] = f"too large: {e}"
                except (jw.FetchError, jw.UnsafeUrlError) as e:
                    m["reason"] = f"download: {jw.mask(e)}"
            if data is None:
                continue
            budget.spend(len(data))
            m["bytes"] = len(data)
            path = os.path.join(td, f"m{idx}." + ("mp4" if it["type"] == "video" else "jpg"))
            with open(path, "wb") as f:
                f.write(data)
            targets = [path]
            if it["type"] == "video":
                if not tools.get("ffmpeg"):
                    m["reason"] = "ffmpeg not available"
                    continue
                fd = os.path.join(td, f"fr{idx}")
                os.makedirs(fd, exist_ok=True)
                targets = extract_frames(path, fd, run=run)
                m["frames"] = len(targets)
                if not targets:
                    m["reason"] = "ffmpeg produced no frame"
                    continue
            elif not tools.get("tesseract"):
                m["reason"] = "tesseract not available"
                continue
            elif tools.get("ffmpeg"):
                targets = [shrink_image(path, os.path.join(td, f"s{idx}.png"), run)]
            if not tools.get("tesseract"):
                m["status"], m["reason"] = "partial", "frames extracted, tesseract not available (no OCR)"
                ok += 1
                continue
            lines = []
            for t in targets:
                try:
                    lines += ocr_image(t, tools.get("ocr_lang"), run)
                except (OSError, subprocess.SubprocessError) as e:
                    m["reason"] = f"ocr: {jw.mask(e)}"
            m["ocr_lines"] = list(dict.fromkeys(lines))
            m["status"] = "ok" if m["ocr_lines"] or not m["reason"] else "partial"
            ok += 1
    res["ocr_lines"] = list(dict.fromkeys(l for m in res["media"] for l in m["ocr_lines"]))
    res["status"] = "ok" if ok and all(m["status"] == "ok" for m in res["media"]) else "partial" if ok else "failed"
    if res["status"] != "ok" and not res["reason"]:
        res["reason"] = "; ".join(sorted({m["reason"] for m in res["media"] if m["reason"]})) or None
    return res


# ---------- per-post record ----------
def media_kind_from(alt, stub_kind):
    if stub_kind and stub_kind != "inconnu":
        return stub_kind
    a = (alt or "").lower()
    return "video" if a.startswith("video by") else "image" if a.startswith("photo by") else "inconnu"


def build_post_record(code, url, handle, res, stub, visual, today):
    """Merge insta_reel result (preferred) with the embed stub (fallback). No transient/signed URL is kept."""
    res = res or {}
    stub = stub or {}
    caption = res.get("caption") or stub.get("caption") or ""
    layers = list(res.get("extracted_via") or [])
    if stub:
        layers.append("profile_embed")
    ctas = detect_ctas(caption)
    rec = {
        "id": code, "url": url, "handle": handle, "media_kind": media_kind_from(res.get("alt_text"), stub.get("media_kind")),
        "posted_at": res.get("posted_at") or stub.get("posted_at"), "caption": caption, "hashtags": jw.extract_hashtags(caption),
        "mentions": jw.extract_mentions(caption), "likes": res.get("likes") if res.get("likes") is not None else stub.get("likes"),
        "comments_count": res.get("comments_count") if res.get("comments_count") is not None else stub.get("comments_count"),
        "music": res.get("music") or res.get("original_sound"), "alt_text_auto": res.get("alt_text"), "location": res.get("location"),
        "tagged_accounts": res.get("tagged_accounts") or [], "coauthors": res.get("coauthors") or stub.get("coauthors") or [],
        "links": res.get("links") or {"product": [], "link_hub": [], "other": []},
        "top_comments": [{"text": (c.get("text") or "")[:200]} for c in (res.get("top_comments") or [])[:5]],  # commenter handles not stored
        "ctas": ctas, "structure": caption_structure(caption),
        "offer_signal_in_caption": sorted({m.lower() for m in OFFER_RE.findall(caption)}),
        "transcript": {"status": "unavailable", "reason": "no local speech-to-text model; Instagram exposes no captions", "confidence": "incertain"},
        "visual": visual or {"status": "skipped", "reason": "--no-visual or media not reached", "media": [], "ocr_lines": [],
                             "vision_model": vision_status({}), "confidence": "incertain"},
        "page_status": "ok" if res and not res.get("login_wall") else ("login_wall" if res else "not_fetched"),
        "sources": layers, "first_seen": today, "last_seen": today, "runs": 1,
    }
    rec["engagement_history"] = [{"date": today, "likes": rec["likes"], "comments": rec["comments_count"]}]
    return rec


def merge_record(old, new):
    """Merge by post id: keep first_seen/history, prefer fresh non-empty values, keep earlier visual work if the new run has none."""
    if not old:
        return new
    out = dict(old)
    for k, v in new.items():
        if k in ("first_seen", "runs", "engagement_history", "visual"):
            continue
        if v not in (None, "", [], {}) or k not in old:
            out[k] = v
    out["first_seen"] = old.get("first_seen") or new["first_seen"]
    out["last_seen"] = new["last_seen"]
    out["runs"] = int(old.get("runs", 1)) + 1
    hist = list(old.get("engagement_history") or [])
    last = hist[-1] if hist else None
    cur = new["engagement_history"][0]
    if not last or (last.get("likes"), last.get("comments")) != (cur["likes"], cur["comments"]):
        hist.append(cur)
    out["engagement_history"] = hist[-20:]
    ov, nv = old.get("visual") or {}, new.get("visual") or {}
    rank = {"ok": 3, "partial": 2, "failed": 1, "skipped": 0}
    out["visual"] = nv if rank.get(nv.get("status"), 0) >= rank.get(ov.get("status"), 0) else ov
    return out


# ---------- account analysis ----------
def _src(p):
    return f"[{p['id']}]({p['url']}) ({(p.get('posted_at') or p['first_seen'])[:10]})"


def _srcs(posts, limit=8):
    s = "; ".join(_src(p) for p in posts[:limit])
    return s + (f"; (+{len(posts) - limit} autres)" if len(posts) > limit else "")


ALT_PREFIX_RE = re.compile(r"^(?:photo|video)s?\s+(?:by|shared\s+by)\s+.*?\s+on\s+[A-Z][a-z]+\s+\d{1,2},\s+\d{4}\.?\s*", re.S | re.I)


def alt_visual_text(alt):
    """Instagram auto alt-text without the 'Photo by X on <date>' boilerplate (keeps 'May be an image of ...')."""
    return ALT_PREFIX_RE.sub("", alt or "").strip()


TAG_PREFIXES = [("freq", ("Fréquence :",)), ("cta", ("CTA «", "Aucun CTA", "Majorité de posts sans CTA")),
                ("structure", ("Légende vide", "Longueur de légende", "Accroche en question", "Chiffres/prix")), ("theme", ("Thème «",)),
                ("visual", ("Élément visuel", "Texte à l'écran")), ("collab", ("Compte associé",)),
                ("offer", ("Vocabulaire d'offre", "Aucun vocabulaire d'offre")), ("engagement", ("Moyenne ",))]


def claim_tag(text):
    for tag, prefixes in TAG_PREFIXES:
        if text.startswith(prefixes):
            return tag
    return "other"


def strategy_brief(analysis):
    """Short human summary (angle, pitch, CTA, frequency, offer) assembled from the claims; each line says how solid it is."""
    by = collections.defaultdict(list)
    for status, items in (("Confirmé", analysis["confirmed"]), ("Incertain", analysis["uncertain"])):
        for c in items:
            by[c["tag"]].append((status, c))

    def pick(tag, n=2):
        return [f"{c['text'].removeprefix('Fréquence : ')} [{st}]" for st, c in by.get(tag, [])[:n]]
    out = []
    visual = [f"{c['text']} [{st}]" for st, c in by.get("visual", []) if c["text"].startswith("Élément visuel")][:2]
    themes = pick("theme", 3) + visual
    out.append("**Angle :** " + (" ".join(themes + pick("collab", 1)) if themes or by.get("collab") else "aucun thème récurrent détecté dans les légendes (peu de texte) : angle non déductible par règles."))
    out.append("**Pitch / structure :** " + (" ".join(pick("structure", 3)) or "non mesurable."))
    out.append("**CTA :** " + (" ".join(pick("cta", 3)) or "non mesurable."))
    out.append("**Fréquence :** " + (" ".join(pick("freq", 2)) or "non mesurable."))
    out.append("**Offre / business :** " + (" ".join(pick("offer", 1)) or "non mesurable."))
    out.append("**Engagement :** " + (" ".join(pick("engagement", 1)) or "non mesurable."))
    return out


def analyze_account(posts, profile=None):
    """Rule-based claims. -> dict(confirmed=[{text, posts}], uncertain=[...], stats={...}). Deterministic."""
    posts = sorted(posts, key=lambda p: (p.get("posted_at") or "", p["id"]), reverse=True)
    n = len(posts)
    conf, unc = [], []

    def claim(text, ps, min_posts=2, force_uncertain=False):
        (conf if len(ps) >= min_posts and not force_uncertain else unc).append({"text": text, "tag": claim_tag(text), "posts": [p["id"] for p in ps], "_posts": ps})

    stats = {"posts": n}
    # frequency
    dated = [p for p in posts if p.get("posted_at")]
    if len(dated) >= 2:
        ts = sorted(datetime.datetime.fromisoformat(p["posted_at"]) for p in dated)
        span = (ts[-1] - ts[0]).total_seconds() / 86400
        gaps = [(b - a).total_seconds() / 86400 for a, b in zip(ts, ts[1:])]
        med = statistics.median(gaps)
        stats.update(span_days=round(span, 1), median_gap_days=round(med, 1))
        txt = (f"Fréquence : {len(dated)} posts datés entre {ts[0].date()} et {ts[-1].date()} (écart médian {med:.1f} j"
               + (f", ~{len(dated) / (span / 7):.1f} posts/semaine" if span >= 7 else "") + "). Échantillon = posts récents exposés, pas tout le compte.")
        claim(txt, dated, min_posts=3)
        if len(dated) >= 3:
            same_day = collections.Counter(d.date() for d in ts)
            burst = [str(d) for d, c in same_day.items() if c >= 2]
            if burst:
                claim(f"Fréquence : publications groupées le même jour : {', '.join(sorted(burst))}.", [p for p in dated if p["posted_at"][:10] in burst], min_posts=2)
    elif dated:
        claim(f"Fréquence : 1 seul post daté ({dated[0]['posted_at'][:10]}) : fréquence non mesurable.", dated, min_posts=99)
    # CTA
    cta_by_type = collections.defaultdict(list)
    for p in posts:
        for t in {c["type"] for c in p.get("ctas", [])}:
            cta_by_type[t].append(p)
    stats["posts_with_cta"] = len({p["id"] for ps in cta_by_type.values() for p in ps})
    labels = {"comment_keyword": "commenter un mot-clé", "dm": "DM", "link_in_bio": "lien en bio", "url_in_caption": "URL dans la légende",
              "follow": "follow/abonnement", "save_share": "sauvegarder/partager/taguer", "lead_magnet": "aimant à prospects (gratuit/waitlist/newsletter)",
              "book_call": "prise de rendez-vous/appel", "comment_prompt": "inviter à commenter", "engagement_question": "question finale d'engagement"}
    if not cta_by_type:
        claim(f"Aucun CTA détecté par les règles dans les {n} légendes analysées.", posts, min_posts=2)
    for t, ps in sorted(cta_by_type.items(), key=lambda kv: (-len(kv[1]), kv[0])):
        kws = sorted({c.get("keyword") for p in ps for c in p["ctas"] if c["type"] == t and c.get("keyword")})
        claim(f"CTA « {labels.get(t, t)} » dans {len(ps)}/{n} posts" + (f" (mots-clés : {', '.join(kws)})" if kws else "") + ".", ps)
    if cta_by_type and n and stats["posts_with_cta"] < n / 2:
        claim(f"Majorité de posts sans CTA détecté ({n - stats['posts_with_cta']}/{n}).", [p for p in posts if not p.get("ctas")], min_posts=2)
    # structure
    empty = [p for p in posts if p["structure"]["empty"] or p["structure"]["emoji_or_symbol_only"]]
    if empty:
        claim(f"Légende vide ou emoji seuls dans {len(empty)}/{n} posts.", empty)
    buckets = collections.defaultdict(list)
    for p in posts:
        buckets[p["structure"]["length_bucket"]].append(p)
    if buckets:
        top = max(buckets.items(), key=lambda kv: (len(kv[1]), kv[0]))
        claim(f"Longueur de légende dominante : {top[0]} ({len(top[1])}/{n}).", top[1])
    q = [p for p in posts if p["structure"]["question_hook"]]
    if q:
        claim(f"Accroche en question dans {len(q)}/{n} posts.", q)
    nums = [p for p in posts if p["structure"]["has_numbers"]]
    if nums:
        claim(f"Chiffres/prix/% dans la légende de {len(nums)}/{n} posts.", nums)
    # themes (captions + hashtags: first-party) vs alt-text/OCR (uncertain)
    first_party, auto_only = collections.defaultdict(set), collections.defaultdict(set)
    own = set(tokens(posts[0]["handle"].replace(".", " ").replace("_", " ") + " " + ((profile or {}).get("full_name") or ""))) if posts else set()
    for p in posts:
        for t in set(tokens(p["caption"] + " " + " ".join(p["hashtags"]))):
            first_party[t].add(p["id"])
        extra = alt_visual_text(p.get("alt_text_auto")) + " " + " ".join((p.get("visual") or {}).get("ocr_lines") or [])
        for t in set(tokens(extra)):
            if len(t) >= 4 and t not in own and not t.isdigit() and (t not in first_party or p["id"] not in first_party[t]):
                auto_only[t].add(p["id"])
    by_id = {p["id"]: p for p in posts}
    for t, ids in sorted(first_party.items(), key=lambda kv: (-len(kv[1]), kv[0]))[:8]:
        if len(ids) >= 2:
            claim(f"Thème « {t} » dans {len(ids)}/{n} légendes/hashtags.", [by_id[i] for i in sorted(ids)])
    for t, ids in sorted(auto_only.items(), key=lambda kv: (-len(kv[1]), kv[0]))[:6]:
        if len(ids) >= 2:
            claim(f"Élément visuel « {t} » (alt-text auto Instagram / OCR) dans {len(ids)}/{n} posts.", [by_id[i] for i in sorted(ids)], force_uncertain=True)
    # collaborators / tagged
    acc = collections.defaultdict(list)
    for p in posts:
        for a in set(p.get("coauthors", []) + p.get("tagged_accounts", []) + p.get("mentions", [])):
            if a and a.lower() != p["handle"]:
                acc[a].append(p)
    for a, ps in sorted(acc.items(), key=lambda kv: (-len(kv[1]), kv[0]))[:5]:
        claim(f"Compte associé @{a} (collab/tag/mention) dans {len(ps)}/{n} posts.", ps)
    # offer signals (the 'sells an AI agent business' hypothesis)
    offer = [p for p in posts if p.get("offer_signal_in_caption")]
    if offer:
        words = sorted({w for p in offer for w in p["offer_signal_in_caption"]})
        claim(f"Vocabulaire d'offre/business dans {len(offer)}/{n} légendes ({', '.join(words)}).", offer)
    else:
        claim(f"Aucun vocabulaire d'offre IA/agent/business détecté dans les {n} légendes analysées.", posts, min_posts=2)
    # engagement
    likes = [p["likes"] for p in posts if isinstance(p.get("likes"), int)]
    cm = [p["comments_count"] for p in posts if isinstance(p.get("comments_count"), int)]
    if likes:
        stats.update(avg_likes=round(statistics.mean(likes), 1), avg_comments=round(statistics.mean(cm), 1) if cm else None)
        foll = (profile or {}).get("followers")
        er = f", taux d'engagement moyen ~{(statistics.mean(likes) + (statistics.mean(cm) if cm else 0)) / foll * 100:.2f}% des {foll} abonnés" if foll else ""
        claim(f"Moyenne {stats['avg_likes']} likes et {stats['avg_comments']} commentaires par post{er}.", [p for p in posts if isinstance(p.get('likes'), int)], min_posts=3)
    # data-quality caveats
    ocr_posts = [p for p in posts if (p.get("visual") or {}).get("ocr_lines")]
    if ocr_posts:
        claim(f"Texte à l'écran lu par OCR sur {len(ocr_posts)}/{n} posts (bruité, à relire).", ocr_posts, force_uncertain=True)
    stats["visual_ok"] = sum((p.get("visual") or {}).get("status") == "ok" for p in posts)
    stats["transcripts_ok"] = sum((p.get("transcript") or {}).get("status") == "ok" for p in posts)
    return {"confirmed": conf, "uncertain": unc, "stats": stats}


def render_summary(handle, posts, analysis, profile, journal_lines, now, tools):
    posts = sorted(posts, key=lambda p: (p.get("posted_at") or "", p["id"]), reverse=True)
    L = [f"# @{handle} : stratégie de contenu (analyse par règles)", "",
         "> Généré par `docs/jarvis/bin/insta_account.py` (lecture seule, sans login, sans LLM). Régénéré à chaque run depuis les fichiers `<id>.json` ; le journal est cumulatif.",
         "> Confirmé = >= 2 posts, champs Instagram de première main (légende, date, compteurs). Incertain = 1 post, OCR, alt-text auto ou échantillon trop petit.", ""]
    if profile:
        L += [f"**Profil (embed public, {profile.get('seen', now[:10])}) :** {profile.get('full_name') or ''} · {profile.get('followers')} abonnés · {profile.get('posts_count')} posts au total.", ""]
    L += [f"**Échantillon :** {len(posts)} posts/reels. Statut visuel : {analysis['stats'].get('visual_ok', 0)} analysés (frames+OCR), transcripts audio : {analysis['stats'].get('transcripts_ok', 0)} (aucun outil de transcription local).", ""]

    L += ["## Stratégie en bref (déduite par règles, à lire avec les sources ci-dessous)", ""] + [f"- {x}" for x in strategy_brief(analysis)] + [""]

    def lines(items):
        return [f"- {c['text']} — sources : {_srcs(c['_posts'])}" for c in items] or ["_(rien)_"]
    L += ["## Confirmé", ""] + lines(analysis["confirmed"]) + ["", "## Incertain", ""] + lines(analysis["uncertain"])
    L += ["", "## Posts analysés", "", "| date | type | post | légende | CTA | visuel |", "|---|---|---|---|---|---|"]
    for p in posts:
        cap = (p["caption"] or "(vide)").replace("\n", " ").replace("|", "/")
        L.append(f"| {(p.get('posted_at') or '?')[:10]} | {p['media_kind']} | [{p['id']}]({p['url']}) | {cap[:80]} | "
                 f"{', '.join(sorted({c['type'] for c in p['ctas']})) or '-'} | {(p.get('visual') or {}).get('status')} |")
    L += ["", "## Limites et non testé", "",
          "- Liste des posts : embed public du profil (quelques posts seulement) ; le profil et `/reels/` renvoient un login wall depuis une IP datacenter (non contourné).",
          "- Pas de transcript audio (aucun modèle ASR local). Pas de description d'image par modèle (aucune clé/modèle fourni) : frames + OCR + alt-text auto seulement, tous Incertain.",
          f"- Outils locaux détectés : ffmpeg={tools.get('ffmpeg')}, tesseract={tools.get('tesseract')} (langues OCR : {tools.get('ocr_lang')}).", "",
          "## Journal", ""]
    for j in journal_lines:
        L += [j.rstrip(), ""]
    return "\n".join(L).rstrip() + "\n"


def parse_journal(md):
    m = re.search(r"^## Journal\n\n(.*)\Z", md or "", re.S | re.M)
    if not m:
        return []
    return [b.strip("\n") for b in re.split(r"\n(?=### )", m.group(1).strip()) if b.strip()]


def write_atomic(path, text):
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(text)
    os.replace(tmp, path)


def load_posts(out_dir):
    posts = {}
    if os.path.isdir(out_dir):
        for fn in sorted(os.listdir(out_dir)):
            if fn.endswith(".json") and not fn.startswith("resume-compte"):
                try:
                    with open(os.path.join(out_dir, fn), encoding="utf-8") as f:
                        d = json.load(f)
                    if d.get("id"):
                        posts[d["id"]] = d
                except (OSError, ValueError):
                    continue
    return posts


# ---------- orchestration ----------
def run(args, env=None, now=None, deps=None):
    env = os.environ if env is None else env
    deps = deps or {}
    try:
        handle = validate_handle(args.handle)
    except ValueError as e:
        print(f"usage: {e}", file=sys.stderr)
        return EXIT_USAGE, None
    limit = max(1, min(args.limit, HARD_MAX_LIMIT))
    refs = []
    try:
        for r in list(args.seed_urls or []) + (read_refs_file(args.urls_file) if args.urls_file else []):
            refs.append(normalize_post_ref(r))
    except (ValueError, OSError) as e:
        print(f"usage: bad post reference or file: {jw.mask(e)}", file=sys.stderr)
        return EXIT_USAGE, None
    refs = list(dict.fromkeys(refs))
    out_dir = os.path.abspath(args.out_dir or os.path.join(DEFAULT_OUT_ROOT, handle))
    mode = "seed-urls" if refs else ("embed hors ligne" if args.from_embed else "embed public du profil")
    tools = deps.get("tools") or detect_tools()
    summary = {"handle": handle, "mode": mode, "limit": limit, "out_dir": out_dir, "dry_run": bool(args.dry_run), "visual": not args.no_visual,
               "tools": tools, "vision_model": vision_status(env), "seed_refs": [c for _, c in refs],
               "embed_url": None if refs or args.from_embed else f"https://www.instagram.com/{handle}/embed/",
               "caps": {"page_mb": args.page_mb, "total_mb": args.max_total_mb, "video_mb": args.max_video_mb, "attempts_per_page": jw.MAX_ATTEMPTS}}
    if args.dry_run:
        summary["note"] = "dry-run: no network, no file written"
        return EXIT_OK, summary
    nowdt = now or datetime.datetime.now().astimezone()
    nowiso, today = nowdt.isoformat(timespec="seconds"), nowdt.date().isoformat()
    log = jw.log_path(args.log)
    budget = Budget(int(args.max_total_mb * 1024 * 1024))
    journal, errors = [], []
    profile, stubs = None, {}
    fetch_page = deps.get("fetch_page")
    own_browser = None
    code = EXIT_OK

    def page(url, wait_ms=4000):
        nonlocal own_browser
        if fetch_page:
            r = fetch_page(url)
            budget.spend(r.get("bytes"))
            return r
        if own_browser is None:
            own_browser = jw.Browser(args.engine, jw.max_page_bytes(args.page_mb), log=args.log, tool="insta_account").start()
        r = jw.browser_fetch_retry(own_browser, url, "insta_account", log, wait_ms=wait_ms, want_text=True)
        budget.spend(r["bytes"])
        return r

    try:
        if args.from_embed:
            with open(args.from_embed, encoding="utf-8", errors="replace") as f:
                profile = parse_profile_embed(f.read())
        elif not refs:
            try:
                r = page(summary["embed_url"], wait_ms=5000)
                if "/accounts/login" in (r.get("final_url") or ""):
                    errors.append("profile embed redirected to login")
                else:
                    profile = parse_profile_embed(r["html"])
                    if profile is None:
                        errors.append("profile embed carried no profile context (private/unknown account or layout change)")
            except jw.AntiBotError as e:
                errors.append(f"profile embed blocked: {jw.mask(e)}")
            except jw.FetchError as e:
                errors.append(f"profile embed error: {jw.mask(e)}")
        if profile:
            if profile["username"].lower() != handle:
                errors.append(f"embed username {profile['username']} != requested handle")
                profile = None
            else:
                profile["seen"] = today
                for s in profile["posts"][:limit]:
                    stubs[s["shortcode"]] = s
                refs = [(s["url"], s["shortcode"]) for s in profile["posts"][:limit]]
                summary["profile"] = {k: profile.get(k) for k in ("username", "full_name", "followers", "posts_count")}
                summary["embed_posts_exposed"] = len(profile["posts"])
        refs = refs[:limit]
        if not refs:
            summary["errors"] = errors
            summary["note"] = "no post to analyse: use --urls-file / --seed-urls with public post URLs"
            return EXIT_BLOCKED, summary

        existing = load_posts(out_dir)
        new_posts, blocked_run, blocked_posts = {}, 0, []
        with tempfile.TemporaryDirectory() as _wd:
            for url, code_ in refs:
                if budget.left <= 0:
                    errors.append("total byte budget exhausted: remaining posts not fetched")
                    break
                res = None
                if blocked_run >= 2:
                    blocked_posts.append(code_)
                else:
                    try:
                        r = page(url)
                        res = ir.build_result(url, r["html"], r.get("text", ""), r.get("status"), r.get("bytes"), r.get("capped"), args.engine)
                        if res["login_wall"] and not res["caption"]:
                            blocked_run += 1
                            blocked_posts.append(code_)
                            res = None
                        else:
                            blocked_run = 0
                    except jw.AntiBotError as e:
                        blocked_run += 1
                        blocked_posts.append(code_)
                        errors.append(f"{code_}: blocked {jw.mask(e)}")
                    except jw.FetchError as e:
                        errors.append(f"{code_}: {jw.mask(e)}")
                if res and res.get("account") and res["account"].lower() != handle:
                    errors.append(f"{code_}: belongs to @{res['account']}, not @{handle}: skipped")
                    continue
                if res is None and code_ not in stubs:
                    continue
                visual = None
                prev = (existing.get(code_) or {}).get("visual") or {}
                if res and not args.no_visual and prev.get("status") == "ok" and not args.refresh_visual:
                    journal.append(f"{code_}: visual already ok, media not downloaded again")
                elif res and not args.no_visual:
                    visual = (deps.get("analyze_media") or analyze_media)(res.get("_media") or [], env, tools, budget,
                                                                         int(args.max_video_mb * 1024 * 1024), log)
                rec = build_post_record(code_, url, handle, res, stubs.get(code_), visual, today)
                if res is None:
                    rec["page_status"] = "embed_only"
                new_posts[code_] = merge_record(existing.get(code_), rec)
    finally:
        if own_browser is not None:
            own_browser.close()

    all_posts = dict(existing)
    all_posts.update(new_posts)
    for cid, rec in new_posts.items():
        write_atomic(os.path.join(out_dir, cid + ".json"), json.dumps(rec, ensure_ascii=False, indent=2, sort_keys=True) + "\n")
    analysis = analyze_account(list(all_posts.values()), profile)
    summary_path = os.path.join(out_dir, "resume-compte.md")
    old_journal = parse_journal(open(summary_path, encoding="utf-8").read()) if os.path.exists(summary_path) else []
    J = [f"### {nowiso}", "", f"- mode : {mode}"]
    if profile:
        J.append(f"- embed : {len(profile['posts'])} posts exposés, {len(refs)} traités (limite {limit})")
    J.append(f"- posts traités : {len(new_posts)} ({sum(1 for p in new_posts.values() if p['page_status'] == 'ok')} page complète, "
             f"{sum(1 for p in new_posts.values() if p['page_status'] == 'embed_only')} embed seul), nouveaux : {len([c for c in new_posts if c not in existing])}")
    J.append(f"- visuel : {sum(1 for p in new_posts.values() if (p.get('visual') or {}).get('status') == 'ok')} ok, "
             f"{sum(1 for p in new_posts.values() if (p.get('visual') or {}).get('status') in ('partial', 'failed'))} partiel/échec ; octets utilisés {budget.used}")
    for e in errors + journal:
        J.append(f"- note : {jw.mask(e)}")
    md = render_summary(handle, list(all_posts.values()), analysis, profile or _stored_profile(out_dir), old_journal + ["\n".join(J)], nowiso, tools)
    write_atomic(summary_path, md)
    clean = {"handle": handle, "updated": nowiso, "stats": analysis["stats"], "profile": profile and {k: profile.get(k) for k in ("username", "full_name", "followers", "posts_count", "seen")},
             "confirmed": [{"text": c["text"], "posts": c["posts"]} for c in analysis["confirmed"]],
             "uncertain": [{"text": c["text"], "posts": c["posts"]} for c in analysis["uncertain"]]}
    write_atomic(os.path.join(out_dir, "resume-compte.json"), json.dumps(clean, ensure_ascii=False, indent=2) + "\n")
    summary.update(posts_processed=len(new_posts), posts_total=len(all_posts), blocked_posts=blocked_posts, errors=errors, bytes_used=budget.used,
                   stats=analysis["stats"], confirmed=len(analysis["confirmed"]), uncertain=len(analysis["uncertain"]), summary_file=summary_path)
    if blocked_posts and not new_posts:
        code = EXIT_BLOCKED
    return code, summary


def _stored_profile(out_dir):
    p = os.path.join(out_dir, "resume-compte.json")
    try:
        with open(p, encoding="utf-8") as f:
            return json.load(f).get("profile")
    except (OSError, ValueError):
        return None


def main(argv=None):
    ap = argparse.ArgumentParser(description="Analyse the recent public posts of one Instagram account (read-only, no login).")
    ap.add_argument("handle", help="instagram handle (validated before any URL is built)")
    ap.add_argument("--limit", type=int, default=DEFAULT_LIMIT, help=f"max posts (default {DEFAULT_LIMIT}, hard max {HARD_MAX_LIMIT})")
    ap.add_argument("--urls-file", metavar="FILE", help="post URLs/shortcodes, one per line (fallback when the profile embed is empty)")
    ap.add_argument("--seed-urls", nargs="*", metavar="URL", help="post URLs/shortcodes given inline")
    ap.add_argument("--from-embed", metavar="FILE", help="offline: parse a saved <handle>/embed/ page")
    ap.add_argument("--no-visual", action="store_true", help="skip media download, frames and OCR")
    ap.add_argument("--refresh-visual", action="store_true", help="redo frames+OCR even for posts already analysed (default: reuse)")
    ap.add_argument("--dry-run", action="store_true", help="print the plan only: no network, no file")
    ap.add_argument("--engine", choices=["camoufox", "patchright"], default="camoufox")
    ap.add_argument("--page-mb", type=float, default=float(os.environ.get("JARVIS_MAX_PAGE_MB") or DEFAULT_PAGE_MB), help="per-page byte cap")
    ap.add_argument("--max-total-mb", type=float, default=DEFAULT_TOTAL_MB, help="total byte cap for the run (pages + media)")
    ap.add_argument("--max-video-mb", type=float, default=DEFAULT_VIDEO_MB, help="per-video download cap")
    ap.add_argument("--out-dir", default=None, help="output dir (default docs/jarvis/inbox/sujets/<handle>)")
    ap.add_argument("--log", default=None, help="JSONL visit log path")
    ap.add_argument("--text", action="store_true", help="human-readable run summary instead of JSON")
    a = ap.parse_args(argv)
    code, summary = run(a)
    if summary is not None:
        if a.text:
            print(f"@{summary['handle']}: {summary.get('posts_processed', 0)} posts traités, {summary.get('confirmed', '-')} confirmés / "
                  f"{summary.get('uncertain', '-')} incertains -> {summary.get('summary_file', summary['out_dir'])}")
            for e in summary.get("errors", []):
                print(f"  note: {e}")
        else:
            print(json.dumps(summary, ensure_ascii=False, indent=2))
    return code


if __name__ == "__main__":
    sys.exit(main())
