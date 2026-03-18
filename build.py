#!/usr/bin/env python3
"""
build.py — pre-deploy script for Configurator Pro
----------------------------------------------------
1. Rewrites <script src="..."> and <link href="..."> tags in index.html
   to append ?v=VERSION so browsers always fetch fresh files after a deploy.
2. Rewrites the loadSeedData() call to point at the remote shared JSON URL.

Usage:
  python build.py                         # version = today YYYYMMDD
  python build.py --version 11            # explicit version string
  python build.py --data-url https://...  # override remote JSON URL

Set DATA_URL below to your permanent remote JSON location (GitHub raw,
Cloudflare R2 public URL, etc.) so you don't need to pass it every time.
"""

import re
import sys
import datetime

# ── Configuration ─────────────────────────────────────────────────────────────

# Paste your remote JSON URL here once you have it, e.g.:
#   https://raw.githubusercontent.com/your-org/your-repo/main/data/Buckets_1.json
#   https://pub-xxxxxxxxxxxx.r2.dev/Buckets_1.json
DATA_URL = "https://raw.githubusercontent.com/varunlanga-glitch/daequip-config-tool/main/data/buckets_1.json"

INPUT_FILE  = "index.html"
OUTPUT_FILE = "index.html"  # overwrites in-place

# ── CLI args (simple, no argparse dependency) ─────────────────────────────────

version  = datetime.date.today().strftime("%Y%m%d")
data_url = DATA_URL

args = sys.argv[1:]
for i, arg in enumerate(args):
    if arg == "--version"  and i + 1 < len(args): version  = args[i + 1]
    if arg == "--data-url" and i + 1 < len(args): data_url = args[i + 1]

if not data_url:
    print("ERROR: DATA_URL is not set.")
    print("  Either edit DATA_URL at the top of build.py")
    print("  or pass --data-url https://your-remote-url/Buckets_1.json")
    sys.exit(1)

# ── Read ──────────────────────────────────────────────────────────────────────

with open(INPUT_FILE, "r", encoding="utf-8") as f:
    html = f.read()

original = html

# ── Fix 1: stamp ?v=VERSION on all local script/link assets ──────────────────
# Matches: src="js/foo.js" or src="js/foo.js?v=old" → src="js/foo.js?v=VERSION"
# Also handles: href="styles/main.css"

def stamp(m):
    """Strip any existing ?v=... then append the new version."""
    attr  = m.group(1)          # 'src' or 'href'
    path  = m.group(2)          # the URL value, without quotes
    path  = re.sub(r'\?v=[^"\']+', '', path)  # strip old stamp
    return f'{attr}="{path}?v={version}"'

html = re.sub(
    r'(src|href)="((?:js|styles)/[^"]+)"',
    stamp,
    html
)

# ── Fix 2: replace local seed path with remote URL ───────────────────────────

html = re.sub(
    r"loadSeedData\('[^']+'\)",
    f"loadSeedData('{data_url}')",
    html
)

# ── Write ─────────────────────────────────────────────────────────────────────

with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
    f.write(html)

changed = html != original
print(f"build.py done  —  version={version}  data_url={data_url}")
print(f"  {'index.html updated' if changed else 'no changes (index.html already up-to-date)'}")
