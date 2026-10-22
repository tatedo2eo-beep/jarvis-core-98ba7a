#!/usr/bin/env python3
"""Board v4 data. Runs derive3.py (-> derive.py), all READ-ONLY on /workspace/rw and /workspace/public-site,
then writes a clean 'real' block into ./data.json. The page shows ONLY numbers from this block or from live
reporter events; nothing is invented, simulated or animated.

real.book        dishes / book flavours / extra flavours / chapters complete  (manifest + recipe JSON on the site)
real.pages       recipe pages live = every content/recipes/*.json (dishes + flavours + extras)
real.knowledge   knowledge/*.md stats (techniques, unique source URLs)
real.chart       recipe pages first added per Cairo day (7 d) and per hour (24 h), from public-site git history
real.commits     newest public-site commits (time + subject)
real.livePages   recipe pages in the PUBLIC test site sitemap.xml (what visitors can open)
real.tonight     rw/manual_progress.log ("HH:MM:SS batch N" per finished batch)
Usage: python3 derive4.py"""
import json, os, subprocess, sys, datetime, zoneinfo, collections
HERE = os.path.dirname(os.path.abspath(__file__)); SITE = "/workspace/public-site"
TZ = zoneinfo.ZoneInfo("Africa/Cairo")
subprocess.run([sys.executable, os.path.join(HERE, "derive3.py")], check=True)
p = os.path.join(HERE, "data.json"); d = json.load(open(p, encoding="utf-8"))

def git(*a): return subprocess.run(["git", "-C", SITE, *a], capture_output=True, text=True, check=True).stdout
# first time each recipe file appeared in git history
first = {}
for line_block in git("log", "--reverse", "--diff-filter=A", "--name-only", "--format=@%ct", "--", "content/recipes").split("@")[1:]:
    lines = [l for l in line_block.strip().splitlines() if l.strip()]
    t = int(lines[0])
    for f in lines[1:]:
        if f.endswith(".json") and f not in first and os.path.exists(os.path.join(SITE, f)): first[f] = t
now = datetime.datetime.now(TZ)
days = [(now - datetime.timedelta(days=i)).date() for i in range(6, -1, -1)]
dayc = collections.Counter(datetime.datetime.fromtimestamp(t, TZ).date() for t in first.values())
hour0 = now.replace(minute=0, second=0, microsecond=0)
hours = [hour0 - datetime.timedelta(hours=i) for i in range(23, -1, -1)]
hourc = collections.Counter(datetime.datetime.fromtimestamp(t, TZ).replace(minute=0, second=0, microsecond=0) for t in first.values())
commits = [dict(zip(("t", "s"), l.split("\t", 1))) for l in git("log", "-8", "--format=%ct\t%s").splitlines()]
for c in commits: c["t"] = int(c["t"]); c["s"] = c["s"][:90]
ch = d["chapters"]
d["real"] = {
    "at": now.replace(microsecond=0).isoformat(),
    "book": {"dishes": [d["headline"]["done"], d["headline"]["total"]],
             "flavours": [d["flavours"]["done"], d["flavours"]["total"]],
             "extra": d["extraFlavours"]["done"],
             "chapters": [d["derived"]["chaptersComplete"], len(ch)],
             "focus": d.get("focus")},
    "pages": d.get("recipeFiles"),
    "pagesInGit": len(first),
    "knowledge": d["knowledge"]["stats"],
    "chart": {"days": [{"d": x.isoformat(), "n": dayc.get(x, 0)} for x in days],
              "hours": [{"h": x.strftime("%H"), "t": int(x.timestamp()), "n": hourc.get(x, 0)} for x in hours],
              "source": "public-site git history: first commit that added each content/recipes/*.json (Cairo time)"},
    "commits": commits,
    "commitCount": int(git("rev-list", "--count", "HEAD").strip()),
    "site": d.get("site", {}).get("url"),
}
import urllib.request, re
try:
    x = urllib.request.urlopen("https://tatedo2eo-beep.github.io/stack-site-5fa39e/sitemap.xml?b=%d" % now.timestamp(), timeout=15).read().decode("utf-8", "replace")
    d["real"]["livePages"] = len(set(re.findall(r"<loc>[^<]*/recipes/([^/<]+)/?</loc>", x)))
except Exception as e: print("sitemap failed", e); d["real"]["livePages"] = None
rows = []
try:
    for line in open("/workspace/rw/manual_progress.log", encoding="utf-8", errors="replace"):
        m = re.match(r"\s*(\d\d:\d\d(?::\d\d)?)\s+(\S+)\s+(\d+)\s*$", line)
        if m: rows.append((m.group(1)[:5], m.group(2)[:20], int(m.group(3))))
except OSError: pass
d["real"]["tonight"] = {"n": sum(r[2] for r in rows), "batches": len(rows), "first": rows[0][0] if rows else None,
                        "last": rows[-1][0] if rows else None, "recent": [list(r) for r in rows[-6:]][::-1]}
sys.path.insert(0, HERE); from derive import dump
dump(d, p); json.load(open(p, encoding="utf-8"))
r = d["real"]; print("real:", r["book"], "live", r["livePages"], "tonight", r["tonight"]["n"], "pages", r["pages"], "git", r["pagesInGit"], "7d", [x["n"] for x in r["chart"]["days"]], "24h sum", sum(x["n"] for x in r["chart"]["hours"]))
