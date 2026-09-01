#!/usr/bin/env python3
"""Download product HTML via curl subprocess (no proxy env)."""
from __future__ import annotations

import os
import subprocess
import sys
import time
from pathlib import Path

UA = "SupplierViabilityPOC/1.0"


def curl_get(url: str, dest: Path) -> int:
    env = {
        k: v
        for k, v in os.environ.items()
        if k.lower()
        not in {
            "http_proxy",
            "https_proxy",
            "all_proxy",
            "socks_proxy",
            "socks5_proxy",
            "git_http_proxy",
            "git_https_proxy",
        }
    }
    dest.parent.mkdir(parents=True, exist_ok=True)
    proc = subprocess.run(
        [
            "curl",
            "-sL",
            "--max-time",
            "40",
            "-A",
            UA,
            "-o",
            str(dest),
            "-w",
            "%{http_code}",
            url,
        ],
        capture_output=True,
        text=True,
        env=env,
    )
    try:
        return int(proc.stdout.strip() or "0")
    except ValueError:
        return 0


def main() -> int:
    if len(sys.argv) < 4:
        print("usage: download_batch.py <url_list> <outdir> <limit>")
        return 2
    url_list = Path(sys.argv[1])
    outdir = Path(sys.argv[2])
    limit = int(sys.argv[3])
    urls = [u.strip() for u in url_list.read_text().splitlines() if u.strip()][:limit]
    ok = 0
    for i, url in enumerate(urls):
        dest = outdir / f"p_{i:04d}.html"
        code = curl_get(url, dest)
        print(f"{i} {code}", flush=True)
        if code == 200 and dest.stat().st_size > 500:
            ok += 1
        else:
            # keep file for debugging but mark tiny
            pass
        time.sleep(0.4)
    print(f"DONE ok={ok}/{len(urls)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
