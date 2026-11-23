#!/usr/bin/env python3
"""Read-only Search Console query. Service-account key stays in ~/secrets (never printed).
Usage: gsc_sites.py            -> list sites
       gsc_sites.py top 7      -> top 10 queries, last N days"""
import base64, json, os, subprocess, sys, tempfile, time, urllib.parse, urllib.request, datetime

KEY = os.environ.get("GSC_KEY_FILE", os.path.expanduser("~/secrets/gsc-cloudsearch.json"))
SITE = os.environ.get("GSC_SITE", "sc-domain:resell-lausanne.ch")

def token():
    d = json.load(open(KEY))
    b = lambda x: base64.urlsafe_b64encode(x).rstrip(b"=")
    n = int(time.time())
    h = b(json.dumps({"alg": "RS256", "typ": "JWT"}).encode())
    c = b(json.dumps({"iss": d["client_email"], "scope": "https://www.googleapis.com/auth/webmasters.readonly",
                      "aud": "https://oauth2.googleapis.com/token", "iat": n, "exp": n + 3000}).encode())
    with tempfile.NamedTemporaryFile("w", suffix=".pem") as f:
        os.chmod(f.name, 0o600); f.write(d["private_key"]); f.flush()
        s = subprocess.run(["openssl", "dgst", "-sha256", "-sign", f.name], input=h + b"." + c, capture_output=True, check=True).stdout
    jwt = (h + b"." + c + b"." + b(s)).decode()
    body = urllib.parse.urlencode({"grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer", "assertion": jwt}).encode()
    return json.load(urllib.request.urlopen(urllib.request.Request("https://oauth2.googleapis.com/token", body)))["access_token"]

def api(url, t, payload=None):
    req = urllib.request.Request(url, json.dumps(payload).encode() if payload else None,
                                 {"Authorization": "Bearer " + t, "content-type": "application/json"})
    return json.load(urllib.request.urlopen(req))

t = token()
if len(sys.argv) > 1 and sys.argv[1] == "top":
    days = int(sys.argv[2]) if len(sys.argv) > 2 else 7
    end = datetime.date.today() - datetime.timedelta(days=2)
    start = end - datetime.timedelta(days=days)
    r = api(f"https://www.googleapis.com/webmasters/v3/sites/{urllib.parse.quote(SITE, safe='')}/searchAnalytics/query", t,
            {"startDate": str(start), "endDate": str(end), "dimensions": ["query"], "rowLimit": 10})
    print(f"gsc {SITE} {start}..{end}")
    for row in r.get("rows", []):
        print(row["keys"][0], int(row["clicks"]), int(row["impressions"]))
else:
    for s in api("https://www.googleapis.com/webmasters/v3/sites", t).get("siteEntry", []):
        print("gsc_site", s["siteUrl"], s["permissionLevel"])
