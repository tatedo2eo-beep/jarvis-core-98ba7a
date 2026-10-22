#!/usr/bin/env python3
"""Board v3 data: runs the v2 derive.py (READ-ONLY on /workspace/rw and /workspace/public-site; writes only
./data.json), then adds a 'recent' list (newest recipe files + their public test-site links) for the
Recipe Writer's results panel. Usage: python3 derive3.py"""
import json, glob, os, subprocess, sys, datetime, zoneinfo
HERE = os.path.dirname(os.path.abspath(__file__)); SITE = "/workspace/public-site"
TZ = zoneinfo.ZoneInfo("Africa/Cairo")
subprocess.run([sys.executable, os.path.join(HERE, "derive.py"), "--stamp"], check=True)
p = os.path.join(HERE, "data.json"); d = json.load(open(p, encoding="utf-8"))
base = d.get("site", {}).get("url", "").rstrip("/")
files = sorted(glob.glob(f"{SITE}/content/recipes/*.json"), key=os.path.getmtime, reverse=True)
rec = []
for f in files[:14]:
    r = json.load(open(f, encoding="utf-8"))
    rec.append({"title": r.get("title"), "chapter": r.get("chapter"), "flavour": r.get("flavour"),
                "url": f"{base}/recipes/{r.get('slug')}/",
                "t": datetime.datetime.fromtimestamp(os.path.getmtime(f), TZ).replace(microsecond=0).isoformat()})
d["recent"] = rec
d["recipeFiles"] = len(files)
sys.path.insert(0, HERE); from derive import dump
dump(d, p); json.load(open(p, encoding="utf-8")); print("recent:", len(rec), "files:", len(files))
