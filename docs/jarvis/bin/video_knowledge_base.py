#!/usr/bin/env python3
"""video-knowledge-base: from ONE base YouTube video, find similar quality videos, summarise the retained ones,
and write/complete a Markdown fiche: docs/jarvis/inbox/video-kb/yt-<video-id>.md  (same Confirmé/Incertain format as sujets/).

Usage:
  video_knowledge_base.py <base-url> --list-only [--seed-urls U1 U2 ...]     candidates only, NO transcript download
  video_knowledge_base.py <base-url> [--min-score 50] [--max-videos 5] [--seed-urls ...]   full run + fiche
  video_knowledge_base.py <base-url> --dry-run                                plan only: no network, no file

Fiche file: docs/jarvis/inbox/video-kb/yt-<video-id>.md (the id, not the title: YouTube A/B-tests titles, so a title slug
would not be stable between runs). --subject "..." forces a human slug instead.

Candidate discovery:
  - env YOUTUBE_API_KEY set: YouTube Data API v3 search.list (100 quota units/query; --max-queries default 2, max 4)
    + videos.list/channels.list (1 unit per 50). Key only from env, masked in logs/errors/fiches.
  - otherwise: --seed-urls only (videos you or Théo picked); each is read from its public watch page, keyless.
  - neither: usage error. Nothing is invented.

Rules (no LLM, no external API beyond the above), all deterministic:
  KEYWORDS  tokens (plural-folded, >=3 chars, base channel name excluded, not stopword FR/EN/boilerplate, not URL, not number <4 digits); weight title x3, tags x2,
            #hashtags x2, description x1, transcript x1; bigrams of adjacent tokens (title/tags/description) get x1.5;
            top --keywords (default 8), a unigram inside a kept bigram is dropped.
  SCORE     0-100 = quality of source. components: subs = clamp(40*(log10(subscribers)-3)/3, 0, 40)  (1k->0, 1M->40);
            age = clamp(20*channel_age_years/8, 0, 20)  (API only: channel creation date);
            views = clamp(40*(log10(views)-3)/3, 0, 40)  (1k->0, 1M->40).
            score = 100 * points / max_points of the KNOWN components (unknown ones excluded, listed in score_basis).
  RETAIN    score >= --min-score (default 50: a DECISION POINT, not validated) AND keyword overlap with the base
            >= --min-overlap (default 2; plural folding sneakers~sneaker). --trust-seeds exempts --seed-urls from the overlap gate.
  SUMMARY   extractive: sentences (transcript, else description; boilerplate such as affiliate/subscribe/social lines, <6 words
            and zero-keyword sentences dropped) ranked by keyword weight / sqrt(length) (+10% for the
            first tenth), top --summary-sentences (default 5) kept in original order, near-duplicates dropped.
  CONFIRMÉ  platform metadata (kind meta) or a theme/keyword found in videos of >= 2 distinct channels; the rest Incertain.

--list-only: lists title, channel, link, score, retained flag, WITHOUT downloading any transcript (base included) and
without writing any file, so a human validates the list before a full run.

Read-only (GET only), caps (JARVIS_MAX_PAGE_MB per page, 1 MB per transcript, <= 3 attempts, none on 401/403/429),
SSRF refusal, StockX/GOAT never involved, JSONL visit log without content (JARVIS_WEB_LOG).
Exit codes: 0 ok | 1 error | 2 usage / nothing to do | 3 base video blocked or API key refused.
"""
import argparse
import datetime
import json
import math
import os
import re
import sys

import jarvis_web as jw
import subject_research as sr
import youtube_video as yv

EXIT_OK, EXIT_ERR, EXIT_USAGE, EXIT_AUTH = 0, 1, 2, 3
DEFAULT_OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "inbox", "video-kb")
HARD_MAX_QUERIES, HARD_MAX_CANDIDATES, HARD_MAX_VIDEOS = 4, 25, 10
DEFAULT_MIN_SCORE, DEFAULT_MIN_OVERLAP = 50.0, 2

STOP_EN = set("""the and for are but not you your with this that these those from have has had was were will would can could should
about into over than then them they their there here what when where which who whom how why all any each more most other some such
only own same too very just also its our out off per via got get let like make made one two see say said its been being does did doing
because while after before above below between through during again further once both few him her his hers she he we us me my mine
yourself myself itself ours theirs whose""".split())
STOP_FR = set("""le la les un une des du de et en au aux ce ces cet cette ces mon ton son sa ses mes tes nos vos leurs leur notre votre
je tu il elle on nous vous ils elles qui que quoi dont où pour par avec sans sous sur dans chez vers entre contre depuis pendant
mais ou donc or ni car si comme plus moins très trop aussi encore déjà toujours jamais fait faire être avoir est sont était étaient
sera seront ont avait avaient ai as avons avez peut peuvent pas non oui tout tous toute toutes autre autres même mêmes quand
comment pourquoi alors ainsi cela ça celui celle ceux celles voici voilà y a c'est j'ai qu'il d'un d'une l'on""".split())
STOP_BOILER = set("""video vidéo videos vidéos youtube subscribe abonnez abonne abonnés like likes comment comments commentaires follow
instagram tiktok twitter facebook discord link links lien liens http https www com ch fr bit channel chaîne chaine click here
watch today new now check out join business email contact sponsor sponsored ad ads code merci thanks thank please""".split())
STOP = STOP_EN | STOP_FR | STOP_BOILER
TOKEN_RE = re.compile(r"[^\W_][\w'’-]*", re.UNICODE)
URL_RE = re.compile(r"https?://\S+|www\.\S+", re.I)


# ---------- keywords ----------
def _stem(t):
    """Naive plural folding (sneakers -> sneaker, stores -> store); words ending in ss/us/is are left alone."""
    return t[:-1] if len(t) > 4 and t.endswith("s") and not t.endswith(("ss", "us", "is")) else t


def _tokens(text):
    text = URL_RE.sub(" ", text or "").lower()
    return [_stem(re.sub(r"['’]s$", "", t.strip("'’-"))) for t in TOKEN_RE.findall(text)]


def _keep(t):
    if len(t) < 3 or t in STOP:
        return False
    if t.isdigit() and len(t) < 4:
        return False
    return True


def extract_keywords(title, description="", tags=(), transcript="", k=8, exclude=()):
    """-> list of (keyword, weight) best first. Rules in the module docstring."""
    uni, bi = {}, {}

    skip = {_stem(x.lower()) for x in exclude if x}

    def feed(text, w, bigrams=True):
        toks = [t for t in _tokens(text) if t not in skip]
        for t in toks:
            if _keep(t):
                uni[t] = uni.get(t, 0) + w
        if bigrams:
            for a, b in zip(toks, toks[1:]):
                if _keep(a) and _keep(b):
                    bi[f"{a} {b}"] = bi.get(f"{a} {b}", 0) + w
    feed(title, 3)
    for tag in tags or []:
        feed(tag, 2)
    desc = description or ""
    for tag in re.findall(r"#(\w{3,})", desc):
        feed(tag, 2, bigrams=False)
    feed(desc, 1)
    feed(transcript, 1, bigrams=False)
    cand = [(w, 1.0 * s) for w, s in uni.items()]
    cand += [(w, 1.5 * s) for w, s in bi.items() if s >= 2]
    cand.sort(key=lambda x: (-x[1], x[0]))
    out, used = [], set()
    for w, s in cand:
        parts = w.split()
        if len(parts) == 1 and w in used:
            continue
        out.append((w, round(s, 2)))
        used.update(parts)
        if len(out) >= k:
            break
    return out


def keyword_in(text_norm, kw):
    return re.search(r"(?<![\w])" + re.escape(kw) + r"(?![\w])", text_norm) is not None


def norm_text(*parts):
    return " ".join(" ".join(_tokens(p)) for p in parts if p)


def overlap(rec, keywords):
    blob = norm_text(rec.get("title"), rec.get("description"), " ".join(rec.get("tags") or []))
    return sum(keyword_in(blob, kw) for kw, _ in keywords)


# ---------- score ----------
def _clamp(x, lo, hi):
    return max(lo, min(hi, x))


def score_video(rec, today=None):
    """-> (score 0-100, components dict, basis str). Unknown components are excluded, never guessed."""
    comp, mx = {}, {}
    subs, views = rec.get("subscribers"), rec.get("views")
    if subs:
        comp["subs"], mx["subs"] = _clamp(40 * (math.log10(max(subs, 1)) - 3) / 3, 0, 40), 40
    if rec.get("channel_created"):
        try:
            d = datetime.date.fromisoformat(rec["channel_created"])
            years = max(0.0, ((today or datetime.date.today()) - d).days / 365.25)
            comp["age"], mx["age"] = _clamp(20 * years / 8, 0, 20), 20
        except ValueError:
            pass
    if views:
        comp["views"], mx["views"] = _clamp(40 * (math.log10(max(views, 1)) - 3) / 3, 0, 40), 40
    if not mx:
        return 0.0, {}, "no data"
    score = 100 * sum(comp.values()) / sum(mx.values())
    return round(score, 1), {k: round(v, 1) for k, v in comp.items()}, "+".join(sorted(mx))


# ---------- summary ----------
BOILER_RE = re.compile(r"affiliate|commission|disclosure|disclaimer|subscribe|abonne|follow me|follow us|instagram|tiktok|discord|sponsor|"
                       r"no additional cost|shop my|my gear|business inquir|contact me|copyright|all rights|promo code|use code|link in|liens? ci", re.I)


def split_sentences(text):
    text = URL_RE.sub(" ", text or "")
    text = re.sub(r"#\w+", " ", text)
    parts = [p.strip() for p in re.split(r"(?<=[.!?…])\s+|\n+", text) if p.strip()]
    out = []
    for p in parts:
        words = p.split()
        if len(words) > 60:  # unpunctuated auto-captions: chunk by ~30 words
            out += [" ".join(words[i:i + 30]) for i in range(0, len(words), 30)]
        else:
            out.append(p)
    cleaned = []
    for s in out:
        s = re.sub(r"^[^\w\"'(]+", "", s).strip()
        if 25 <= len(s) <= 400 and len(s.split()) >= 6 and sum(c.isalpha() for c in s) > 15 and not BOILER_RE.search(s):
            cleaned.append(s)
    return cleaned


def summarize(text, keywords, n=5):
    """Extractive summary: top-n sentences by keyword weight / sqrt(len), original order, near-duplicates dropped."""
    sents = split_sentences(text)
    if not sents:
        return []
    weights = {}
    for kw, w in keywords:
        for part in kw.split():
            weights[part] = max(weights.get(part, 0), w)
    scored = []
    for i, s in enumerate(sents):
        toks = [t for t in _tokens(s) if _keep(t)]
        if not toks:
            continue
        sc = sum(weights.get(t, 0) for t in toks) / math.sqrt(len(toks))
        if sc <= 0:
            continue
        if i < max(1, len(sents) // 10):
            sc *= 1.1
        scored.append((sc, i, s))
    scored.sort(key=lambda x: (-x[0], x[1]))
    picked = []
    for sc, i, s in scored:
        ts = set(_tokens(s))
        if any(len(ts & set(_tokens(p[2]))) / max(1, len(ts | set(_tokens(p[2])))) > 0.8 for p in picked):
            continue
        picked.append((sc, i, s))
        if len(picked) >= n:
            break
    return [s for _, _, s in sorted(picked, key=lambda x: x[1])]


# ---------- facts ----------
def sig2(n):
    return int(float(f"{n:.1e}")) if n else 0


def vfact(kind, key, text, rec, today, via):
    f = sr.mk_fact(kind, key, text, rec["url"], rec.get("title") or "", today, via)
    f["domain"] = jw.slugify(rec.get("channel_name") or rec.get("channel_id") or "chaine-inconnue", 40)
    return f


def video_facts(rec, kws, today, via, summary=None, summary_src="description"):
    out = []
    ch = rec.get("channel_name") or "chaîne inconnue"
    bits = [f"chaîne {ch}"]
    if rec.get("subscribers"):
        bits.append(f"{rec['subscribers']} abonnés")
    if rec.get("views") is not None:
        bits.append(f"{rec['views']} vues")
    if rec.get("published_at"):
        bits.append(f"publiée {rec['published_at']}")
    if rec.get("duration_seconds"):
        bits.append(f"durée {rec['duration_seconds'] // 60} min")
    out.append(vfact("meta", f"meta:video:{rec['video_id']}:{sig2(rec.get('views'))}", f"Vidéo « {rec.get('title')} » — " + ", ".join(bits),
                     rec, today, via))
    if rec.get("subscribers") or rec.get("channel_created"):
        cid = re.sub(r"[^A-Za-z0-9_-]+", "-", rec.get("channel_id") or jw.slugify(ch))
        parts = [f"{rec['subscribers']} abonnés" if rec.get("subscribers") else "", f"créée {rec['channel_created']}" if rec.get("channel_created") else ""]
        out.append(vfact("meta", f"meta:channel:{cid}:{sig2(rec.get('subscribers'))}", f"Chaîne {ch} : " + ", ".join(p for p in parts if p),
                         rec, today, via))
    blob = norm_text(rec.get("title"), rec.get("description"), " ".join(rec.get("tags") or []), (rec.get("transcript") or {}).get("text"))
    for kw, _ in kws:
        if keyword_in(blob, kw):
            out.append(vfact("topic", f"topic:{jw.slugify(kw, 40)}", f"Thème récurrent : « {kw} »", rec, today, via))
    for s in summary or []:
        out.append(vfact("summary", f"sum:{rec['video_id']}:{jw.slugify(s, 40)}", f"Résumé extractif ({summary_src}) : « {s} »", rec, today, via))
    return out


PREAMBLE = [
    "> Fiche générée par `docs/jarvis/bin/video_knowledge_base.py` (lecture seule, sans LLM). Re-lancer la même vidéo de base complète cette fiche.",
    "> Confirmé = métadonnées plateforme (YouTube) ou thème retrouvé dans les vidéos d'au moins 2 chaînes différentes ; sinon Incertain.",
    "> Chaque fait : lien de la vidéo, chaîne (libellé du lien), date de vue. Résumés = phrases extraites, pas une paraphrase.",
]


# ---------- candidates ----------
def make_candidate(rec, origin, keywords, today):
    sc, comp, basis = score_video(rec, datetime.date.fromisoformat(today) if isinstance(today, str) else today)
    return {"video_id": rec["video_id"], "url": rec["url"], "title": rec.get("title"), "channel": rec.get("channel_name"),
            "channel_id": rec.get("channel_id"), "subscribers": rec.get("subscribers"), "channel_created": rec.get("channel_created"),
            "published_at": rec.get("published_at"), "views": rec.get("views"), "origin": origin, "overlap": overlap(rec, keywords),
            "score": sc, "components": comp, "score_basis": basis, "_rec": rec}


def search_plan(base, kws, max_queries):
    top = [k for k, _ in kws]
    title = " ".join(_tokens(base.get("title") or ""))[:70]
    plan = [" ".join(top[:4]), title, " ".join(top[2:6])]
    seen, out = set(), []
    for q in plan:
        q = q.strip()
        if q and q not in seen:
            seen.add(q)
            out.append(q)
    return out[:max(0, min(max_queries, HARD_MAX_QUERIES))]


def run(args, env=None, now=None, deps=None):
    env = os.environ if env is None else env
    deps = deps or {}
    get_video = deps.get("get_video", yv.get_video)
    ensure_tr = deps.get("ensure_transcript", yv.ensure_transcript)
    a_search = deps.get("search", None)
    a_videos = deps.get("videos", None)
    a_channels = deps.get("channels", None)
    try:
        base_id, base_url = yv.parse_video_url(args.url)
    except ValueError as e:
        print(f"usage: {e}", file=sys.stderr)
        return EXIT_USAGE, None
    key = env.get("YOUTUBE_API_KEY") or ""
    seeds = []
    for s in args.seed_urls or []:
        try:
            vid, canon = yv.parse_video_url(s)
        except ValueError:
            print(f"ignored seed (not a YouTube video url): {jw.safe_log_url(s)}", file=sys.stderr)
            continue
        if vid != base_id and canon not in seeds:
            seeds.append(canon)
    max_q = max(0, min(args.max_queries, HARD_MAX_QUERIES))
    max_c = max(0, min(args.max_candidates, HARD_MAX_CANDIDATES))
    max_v = max(0, min(args.max_videos, HARD_MAX_VIDEOS))
    mode = "youtube-data-api" if key else ("seed-urls (YOUTUBE_API_KEY absente)" if seeds else "aucune source de candidats")
    summary = {"base": base_url, "mode": mode, "youtube_api_key_present": bool(key), "list_only": bool(args.list_only),
               "dry_run": bool(args.dry_run), "min_score": args.min_score, "min_overlap": args.min_overlap, "max_queries": max_q if key else 0,
               "max_candidates": max_c, "max_videos": max_v, "seed_urls": seeds}
    if args.dry_run:
        summary["slug"] = jw.slugify(args.subject) if args.subject else f"yt-{base_id.lower()}"
        summary["note"] = "dry-run: no network, no file written"
        return EXIT_OK, summary
    if not key and not seeds:
        print("neither YOUTUBE_API_KEY (env) nor --seed-urls: no candidate source (use --dry-run to preview)", file=sys.stderr)
        return EXIT_USAGE, None
    log = jw.log_path(args.log)
    nowdt = now or datetime.datetime.now().astimezone()
    nowiso, today = nowdt.isoformat(timespec="seconds"), nowdt.date().isoformat()
    errors, queries, pages = [], [], []
    langs = tuple(x.strip().lower() for x in args.lang.split(",") if x.strip())

    try:
        base = get_video(base_url, env=env, want_transcript=not args.list_only, langs=langs, log=log)
    except (jw.AntiBotError, jw.FetchError) as e:
        print(f"base video unreadable: {jw.mask(e, extra=[key])}", file=sys.stderr)
        return (EXIT_AUTH if isinstance(e, jw.AntiBotError) else EXIT_ERR), None
    kws = extract_keywords(base.get("title") or "", base.get("description") or "", base.get("tags") or [],
                           (base.get("transcript") or {}).get("text", ""), args.keywords,
                           exclude=[re.sub(r"\W+", "", base.get("channel_name") or "")])
    summary["base_video"] = {k: base.get(k) for k in ("video_id", "title", "channel_name", "subscribers", "views", "published_at", "source")}
    summary["keywords"] = [k for k, _ in kws]
    code = EXIT_OK

    cands = {}
    for s in seeds[:max_c]:
        try:
            rec = get_video(s, env=env, want_transcript=False, langs=langs, log=log)
            cands[rec["video_id"]] = make_candidate(rec, "seed", kws, today)
        except (jw.AntiBotError, jw.FetchError) as e:
            pages.append({"url": s, "outcome": "échec: " + sr.one_line(jw.mask(e, extra=[key]), 100)})
    if key:
        try:
            search = a_search or (lambda q, n: yv.api_search(q, key, max_results=n, lang=langs[0] if langs else "fr"))
            ids = []
            for q in search_plan(base, kws, max_q):
                got = [i for i in search(q, min(10, max_c)) if i != base_id]
                queries.append({"engine": "youtube.search", "q": q, "results": len(got)})
                jw.log_visit(log, "video_knowledge_base", yv.API_BASE + "search", engine="api", q=q, results=len(got), outcome="ok")
                ids += got
            ids = [i for i in dict.fromkeys(ids) if i not in cands][:max(0, max_c - len(cands))]
            if ids:
                vids = (a_videos or (lambda x: yv.api_videos(x, key)))(ids)
                chans = (a_channels or (lambda x: yv.api_channels(x, key)))(
                    [v["snippet"]["channelId"] for v in vids.values() if (v.get("snippet") or {}).get("channelId")])
                for vid, item in vids.items():
                    rec = {"video_id": vid, "url": f"https://www.youtube.com/watch?v={vid}", "tags": [], "transcript": {"text": ""}}
                    rec.update(yv.video_from_api(item, chans.get((item.get("snippet") or {}).get("channelId"))))
                    cands[vid] = make_candidate(rec, "search", kws, today)
        except yv.ApiAuthError as e:
            errors.append(jw.mask(e, extra=[key]))
            queries.append({"engine": "youtube.search", "q": "(arrêt)", "results": 0, "error": "refusé"})
            code = EXIT_AUTH
        except jw.FetchError as e:
            errors.append(jw.mask(e, extra=[key]))
            code = EXIT_ERR

    for c in cands.values():
        gate = (args.trust_seeds and c["origin"] == "seed") or c["overlap"] >= args.min_overlap
        c["retained"] = bool(c["score"] >= args.min_score and gate)
    ranked = sorted(cands.values(), key=lambda c: (-c["score"], -(c["views"] or 0)))
    public = [{k: v for k, v in c.items() if not k.startswith("_")} for c in ranked]
    summary.update(candidates=public, retained=sum(c["retained"] for c in ranked), errors=errors)
    if args.list_only:
        summary["note"] = "list-only: no transcript downloaded, no file written"
        return code, summary

    facts, extra = [], []
    base_sum, src = [], "description"
    tr = base.get("transcript") or {}
    text = tr.get("text") if tr.get("status") == "ok" else (base.get("description") or "")
    src = "transcript" if tr.get("status") == "ok" else "description"
    base_sum = summarize(text, kws, args.summary_sentences)
    via = "vidéo de base"
    facts += video_facts(base, kws, today, via, base_sum, src)
    extra.append(f"- vidéo de base : {base_url} (source métadonnées : {base.get('source')}, transcript : {tr.get('status')}"
                 + (f" — {tr.get('reason')}" if tr.get("reason") else "") + ")")
    extra.append("- mots-clés : " + ", ".join(k for k, _ in kws))
    done = 0
    for c in ranked:
        rec = c["_rec"]
        line = f"- candidate {c['url']} « {sr.one_line(c['title'], 80)} » ({c['channel']}) score {c['score']} [{c['score_basis']}], recouvrement {c['overlap']}"
        if not c["retained"]:
            extra.append(line + " : non retenue")
            continue
        if done >= max_v:
            extra.append(line + " : retenue mais au-delà de --max-videos")
            continue
        done += 1
        t = ensure_tr(rec, langs, log)
        txt, src = (t["text"], "transcript") if t.get("status") == "ok" else (rec.get("description") or "", "description")
        sm = summarize(txt, kws, args.summary_sentences)
        facts += video_facts(rec, kws, today, f"candidate ({c['origin']})", sm, src)
        extra.append(line + f" : retenue, transcript {t.get('status')}" + (f" ({t.get('reason')})" if t.get("reason") else "") + f", résumé sur {src}")
        pages.append({"url": c["url"], "outcome": "retenue"})

    subject = sr.clean_subject(args.subject or base.get("title") or base_id)
    slug = jw.slugify(args.subject) if args.subject else f"yt-{base_id.lower()}"  # titles can be A/B tested by YouTube: id = stable key
    path = sr.doc_path(os.path.abspath(args.out_dir), slug)
    exists = os.path.exists(path)
    doc = sr.parse_doc(open(path, encoding="utf-8").read()) if exists else sr.new_doc(subject, slug, nowiso)
    if not doc["slug"]:
        doc["slug"] = slug
    doc["title_prefix"], doc["preamble"] = "Vidéo de base", PREAMBLE
    info = {"mode": mode, "subject_input": subject, "queries": queries, "pages": [], "errors": errors, "extra": extra}
    stats = sr.merge_run(doc, facts, nowiso, info)
    sr.write_atomic(path, sr.render_doc(doc))
    summary.update(stats, path=path, slug=slug, exists=True, runs=doc["runs"])
    return code, summary


def render_list_text(s):
    L = [f"base: {s['base']}  mode: {s['mode']}", "mots-clés: " + ", ".join(s.get("keywords", [])), ""]
    for c in s.get("candidates", []):
        L.append(f"[{'RETENUE' if c['retained'] else 'rejetée'}] score {c['score']:>5} ({c['score_basis']}) recouvr. {c['overlap']}  {c['title']} — {c['channel']} — {c['url']}")
    if not s.get("candidates"):
        L.append("(aucune candidate)")
    return "\n".join(L)


def main(argv=None):
    ap = argparse.ArgumentParser(description="Build a video knowledge fiche from a base YouTube video (read-only, no LLM).")
    ap.add_argument("url", help="base YouTube video url")
    ap.add_argument("--seed-urls", nargs="*", metavar="URL", help="candidate videos to evaluate (works without YOUTUBE_API_KEY)")
    ap.add_argument("--list-only", action="store_true", help="list candidates with scores; no transcript, no file")
    ap.add_argument("--dry-run", action="store_true", help="print the plan only: no network, no file")
    ap.add_argument("--min-score", type=float, default=DEFAULT_MIN_SCORE, help=f"retain score >= this (default {DEFAULT_MIN_SCORE}, to validate)")
    ap.add_argument("--min-overlap", type=int, default=DEFAULT_MIN_OVERLAP, help="keywords shared with the base for API search hits")
    ap.add_argument("--trust-seeds", action="store_true", help="seed urls skip the keyword-overlap gate (score still applies)")
    ap.add_argument("--max-queries", type=int, default=2, help=f"YouTube search queries (default 2, hard max {HARD_MAX_QUERIES}; 100 quota units each)")
    ap.add_argument("--max-candidates", type=int, default=10, help=f"candidates evaluated (default 10, hard max {HARD_MAX_CANDIDATES})")
    ap.add_argument("--max-videos", type=int, default=5, help=f"retained videos summarised (default 5, hard max {HARD_MAX_VIDEOS})")
    ap.add_argument("--keywords", type=int, default=8)
    ap.add_argument("--summary-sentences", type=int, default=5)
    ap.add_argument("--lang", default="fr,en", help="preferred transcript/search languages")
    ap.add_argument("--subject", default=None, help="override fiche subject (default: base video title)")
    ap.add_argument("--out-dir", default=DEFAULT_OUT, help="fiche directory (default docs/jarvis/inbox/video-kb)")
    ap.add_argument("--log", default=None, help="JSONL visit log path")
    ap.add_argument("--text", action="store_true", help="human-readable output instead of JSON")
    a = ap.parse_args(argv)
    code, summary = run(a)
    if summary is not None:
        if a.text and a.list_only:
            print(render_list_text(summary))
        elif a.text:
            print(f"{summary.get('slug')}: {summary.get('new_facts', 0)} nouveaux faits, {summary.get('confirmed_total', '-')} confirmés / "
                  f"{summary.get('uncertain_total', '-')} incertains -> {summary.get('path')}")
        else:
            print(json.dumps(summary, ensure_ascii=False, indent=2))
    return code


if __name__ == "__main__":
    sys.exit(main())
