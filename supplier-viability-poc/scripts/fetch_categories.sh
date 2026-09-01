#!/bin/bash
set -euo pipefail
ROOT="/Users/resell-lausanne/Projects/shopify-fulfillment-dashboard/supplier-viability-poc"
UA='SupplierViabilityPOC/1.0 (+read-only research)'
mkdir -p "$ROOT/_raw/berry" "$ROOT/_raw/pollin" "$ROOT/_raw/farnell" "$ROOT/_raw/buerklin"

echo "== BerryBase categories =="
for cat in raspberry-pi arduino sensoren netzteile werkzeuge gehaeuse displays kabel-stecker bauelemente/aktive-bauelemente/leds; do
  safe=$(echo "$cat" | tr '/' '_')
  code=$(curl -sL -A "$UA" --max-time 35 -o "$ROOT/_raw/berry/cat_${safe}.html" -w '%{http_code}' "https://www.berrybase.de/${cat}/" || echo 000)
  echo "cat $cat -> $code"
  sleep 1
done

echo "== Pollin sitemap =="
curl -sL -A "$UA" --max-time 60 -o "$ROOT/_raw/pollin/sitemap.xml" -w 'sitemap=%{http_code}\n' 'https://www.pollin.de/sitemap.xml' || true
sleep 1

# first product sitemap from index if present
python3 - <<'PY'
from pathlib import Path
import re
root=Path("/Users/resell-lausanne/Projects/shopify-fulfillment-dashboard/supplier-viability-poc/_raw/pollin")
sm=(root/"sitemap.xml").read_text(errors="ignore")
locs=re.findall(r"<loc>(.*?)</loc>", sm)
Path(root/"sitemap_locs.txt").write_text("\n".join(locs))
print("pollin_sitemap_locs", len(locs))
for u in locs[:3]:
    print(u)
PY

echo "== Farnell / Buerklin probe =="
curl -sL -A "$UA" --max-time 25 -o "$ROOT/_raw/farnell/home.html" -w 'farnell=%{http_code}\n' 'https://ch.farnell.com/' || true
sleep 1
curl -sL -A "$UA" --max-time 25 -o "$ROOT/_raw/buerklin/home.html" -w 'buerklin=%{http_code}\n' 'https://www.buerklin.com/' || true

echo DONE
