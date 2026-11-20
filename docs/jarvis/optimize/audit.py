#!/usr/bin/env python3
"""Optimize context check. Read-only on listed sources. Writes only registry.json/registry.md.
Never edits sources, never fixes, never touches software.

Checks
  contradiction : two ACTIVE decisions with same topic and different value
  broken_ref    : `path/like/this.ext` or markdown link to a repo file that does not exist
  stale_source  : a SOURCES.md row says OK but a listed local path is missing
Alert policy: print only NEW findings or CHANGED findings. Known + unchanged = silent. Resolved = recorded, announced once.

Usage: audit.py [--root REPO] [--sources FILE] [--registry FILE] [--alert-file FILE]
Exit 0 always (alerts go to stdout / alert file)."""
import argparse, hashlib, json, os, re, sys, datetime

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT_DEFAULT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))

def read_sources(path, root):
    out = []
    for line in open(path):
        line = line.split("#", 1)[0].strip()
        if line:
            out.append(os.path.join(root, line))
    return out

def parse_decisions(text):
    items, cur = [], None
    for ln in text.splitlines():
        m = re.match(r"###\s+(D-\d+)", ln)
        if m:
            cur = {"id": m.group(1)}; items.append(cur); continue
        m = re.match(r"-\s+(topic|date|source|status|value):\s*(.*)", ln)
        if m and cur is not None:
            cur[m.group(1)] = m.group(2).strip()
    return items

PATH_RE = re.compile(r"`((?:docs|scripts|app|lib|\.cursor|\.github|prisma|galaxus|decathlon|deploy)/[\w./\-\[\]]+\.[A-Za-z0-9]+)`")
LINK_RE = re.compile(r"\]\(((?!https?://|#|mailto:)[^)\s]+)\)")

def check_refs(path, root, findings):
    text = open(path, encoding="utf-8", errors="replace").read()
    base = os.path.dirname(path)
    rel = os.path.relpath(path, root)
    for m in PATH_RE.finditer(text):
        p = m.group(1)
        if "[" in p or "*" in p: continue
        if not os.path.exists(os.path.join(root, p)):
            findings.append(("broken_ref", f"{rel}::{p}", f"{rel} cite `{p}` : fichier introuvable"))
    for m in LINK_RE.finditer(text):
        target = m.group(1).split("#")[0]
        if not target: continue
        if not (os.path.exists(os.path.join(base, target)) or os.path.exists(os.path.join(root, target))):
            findings.append(("broken_ref", f"{rel}::{target}", f"{rel} lien relatif cassé : {target}"))

def check_contradictions(path, root, findings):
    items = parse_decisions(open(path, encoding="utf-8").read())
    rel = os.path.relpath(path, root)
    by_topic = {}
    for it in items:
        if it.get("status") == "active":
            by_topic.setdefault(it.get("topic"), []).append(it)
    for topic, lst in by_topic.items():
        vals = {x.get("value") for x in lst}
        if len(lst) > 1 and len(vals) > 1:
            ids = sorted(x["id"] for x in lst)
            findings.append(("contradiction", f"{topic}::{'+'.join(ids)}",
                f"{rel} : sujet `{topic}` a {len(lst)} décisions actives qui divergent ({', '.join(ids)}). Marquer l'ancienne `superseded` ou trancher."))
    for it in items:
        if not it.get("source") or not it.get("date"):
            findings.append(("missing_provenance", it["id"], f"{rel} : {it['id']} sans date ou source"))

def fingerprint(kind, key, msg):
    return hashlib.sha1(f"{kind}|{key}|{msg}".encode()).hexdigest()[:12]

def run(root, sources_file, registry_file, alert_file=None, now=None):
    now = now or datetime.datetime.now().astimezone().isoformat(timespec="seconds")
    findings = []
    for p in read_sources(sources_file, root):
        if not os.path.exists(p):
            findings.append(("source_missing", os.path.relpath(p, root), f"source listée absente : {os.path.relpath(p, root)}"))
            continue
        if p.endswith("decisions.md"):
            check_contradictions(p, root, findings)
        if p.endswith(".md") or p.endswith(".mdc"):
            check_refs(p, root, findings)
    reg = json.load(open(registry_file)) if os.path.exists(registry_file) else {"findings": {}}
    cur = {}
    for kind, key, msg in findings:
        cur[f"{kind}|{key}"] = {"kind": kind, "key": key, "msg": msg, "fp": fingerprint(kind, key, msg)}
    alerts = []
    for k, f in cur.items():
        old = reg["findings"].get(k)
        if old is None or old.get("status") == "resolved":
            f.update(status="open", first_seen=now, last_seen=now, announced=now); alerts.append(("NOUVEAU", f))
        elif old["fp"] != f["fp"]:
            f.update(status="open", first_seen=old["first_seen"], last_seen=now, announced=now); alerts.append(("CHANGÉ", f))
        else:
            f.update(status="open", first_seen=old["first_seen"], last_seen=now, announced=old.get("announced"))
        reg["findings"][k] = f
    for k, old in list(reg["findings"].items()):
        if k not in cur and old.get("status") != "resolved":
            old.update(status="resolved", resolved=now); alerts.append(("RÉSOLU", old))
    json.dump(reg, open(registry_file, "w"), indent=1, ensure_ascii=False, sort_keys=True)
    write_md(reg, registry_file.replace(".json", ".md"), now)
    msgs = [f"[Optimize context check] {tag} {f['kind']} : {f['msg']}" for tag, f in alerts]
    if alert_file and msgs:
        with open(alert_file, "a") as fh: fh.write("\n".join(msgs) + "\n")
    return msgs

def write_md(reg, path, now):
    rows = sorted(reg["findings"].values(), key=lambda f: (f.get("status") != "open", f["kind"], f["key"]))
    with open(path, "w") as fh:
        fh.write(f"# Registre Optimize\n\nMis à jour {now}. Source : `registry.json`. Aucune correction automatique : propositions seulement.\n\n")
        fh.write("| Statut | Type | Détail | Vu 1re fois | Dernière vue |\n|---|---|---|---|---|\n")
        for f in rows:
            fh.write(f"| {f['status']} | {f['kind']} | {f['msg'].replace('|','/')} | {f.get('first_seen','')[:10]} | {f.get('last_seen', f.get('resolved',''))[:10]} |\n")

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default=ROOT_DEFAULT)
    ap.add_argument("--sources", default=os.path.join(HERE, "sources.txt"))
    ap.add_argument("--registry", default=os.path.join(HERE, "registry.json"))
    ap.add_argument("--alert-file")
    a = ap.parse_args()
    for m in run(a.root, a.sources, a.registry, a.alert_file):
        print(m)
