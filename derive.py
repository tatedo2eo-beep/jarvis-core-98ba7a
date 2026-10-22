#!/usr/bin/env python3
"""Derive full-book progress for the board, READ-ONLY on every source.

Scope  : /workspace/rw/tami_manifest.json (via /workspace/rw/registry.py): 34 chapters, 885 dishes, 227 book flavours.
Done   : /workspace/public-site/content/recipes/*.json, counted exactly like rw/progress.py:
         a dish is written when a recipe has (dish, flavour="Classic"); a book flavour when (dish, <flavour name>);
         an extra flavour is a recipe with extra_flavour=true.
Names  : /workspace/public-site/src/lib/book-chapters.json (chapter display names).
Stats  : /workspace/public-site/knowledge/*.md (topic files, technique IDs, unique source URLs).
Check  : /workspace/public-site/content/PROGRESS.txt totals are compared and any mismatch is printed (never written).
Writes : only data.json in this folder.

Usage  : python3 derive.py            derive + write
         python3 derive.py --stamp    also set updatedAt (update.sh uses this)
         NO_DERIVE=1 python3 derive.py --stamp   only stamp (keeps data.json formatting compact)
"""
import json, glob, os, re, sys, datetime, zoneinfo, collections
HERE = os.path.dirname(os.path.abspath(__file__))
SITE = "/workspace/public-site"
TZ = zoneinfo.ZoneInfo("Africa/Cairo")
now = lambda: datetime.datetime.now(TZ).replace(microsecond=0).isoformat()

def derive(d):
    sys.path.insert(0, "/workspace/rw")
    from registry import REG                    # reads tami_manifest.json only
    names = {c["key"]: c["name"] for c in json.load(open(f"{SITE}/src/lib/book-chapters.json", encoding="utf-8"))}
    have, extra = set(), collections.Counter()
    recipes = 0
    for f in glob.glob(f"{SITE}/content/recipes/*.json"):
        r = json.load(open(f, encoding="utf-8")); recipes += 1
        if r.get("dish") in REG:
            have.add((r["dish"], r.get("flavour")))
            if r.get("extra_flavour"): extra[r["dish"]] += 1
    chapters, dishes = collections.OrderedDict(), []
    for slug, v in sorted(REG.items(), key=lambda kv: (kv[1]["book_no"], kv[1]["src_id"] if isinstance(kv[1]["src_id"], int) else 0)):
        no, key = v["book_no"], v["book_chapter"]
        c = chapters.setdefault(no, {"no": int(no), "key": key, "name": names.get(key, key.replace("-", " ").title()),
                                     "done": 0, "total": 0, "flavours": {"done": 0, "total": 0}, "extra": 0})
        base = (slug, "Classic") in have
        fl = v["book_flavours"]; fd = sum(1 for x in fl if (slug, x) in have)
        c["total"] += 1; c["done"] += base
        c["flavours"]["total"] += len(fl); c["flavours"]["done"] += fd; c["extra"] += extra[slug]
        dishes.append({"s": slug, "n": v["title"], "c": int(no), "b": int(base), "f": [fd, len(fl)], "x": extra[slug]})
    ch = list(chapters.values())
    tot = {"dishes": [sum(c["done"] for c in ch), sum(c["total"] for c in ch)],
           "flavours": [sum(c["flavours"]["done"] for c in ch), sum(c["flavours"]["total"] for c in ch)],
           "extra": sum(c["extra"] for c in ch)}
    # cross-check against PROGRESS.txt (read-only)
    try:
        t = open(f"{SITE}/content/PROGRESS.txt", encoding="utf-8").read()
        m = re.search(r"dishes (\d+)/(\d+), book flavours (\d+)/(\d+), extra flavours written (\d+)", t)
        if m:
            p = list(map(int, m.groups()))
            mine = [*tot["dishes"], *tot["flavours"], tot["extra"]]
            if p != mine: print(f"note: PROGRESS.txt says {p}, derived {mine} (PROGRESS.txt may be older)")
        om = re.search(r"^Order:\s*(.+?), then", t, re.M)       # e.g. "Order: pasta, cakes, then chapters 01-34"
        order = [w.strip().lower() for w in om.group(1).split(",")] if om else []
    except OSError:
        order = []
    # focus = first unfinished chapter in the PROGRESS.txt writing order, else first unfinished in book order
    unfinished = [c for c in ch if c["done"] < c["total"] or c["flavours"]["done"] < c["flavours"]["total"]]
    focus = None
    for w in order:
        focus = next((c for c in unfinished if c["key"].startswith(w)), None)
        if focus: break
    focus = focus or (unfinished[0] if unfinished else None)

    d["headline"] = {"label": "Dishes written", "done": tot["dishes"][0], "total": tot["dishes"][1]}
    d["flavours"] = {"label": "Book flavours", "done": tot["flavours"][0], "total": tot["flavours"][1]}
    d["extraFlavours"] = {"label": "Extra flavours", "done": tot["extra"]}
    d["chapters"] = ch
    d["dishes"] = dishes
    d["focus"] = focus["name"] if focus else None
    d["derived"] = {"at": now(), "from": "rw/tami_manifest.json + public-site/content (read-only)", "recipesOnSite": recipes,
                    "chaptersComplete": sum(1 for c in ch if c["done"] == c["total"] and c["flavours"]["done"] == c["flavours"]["total"])}

    # knowledge base stats
    kfiles = [f for f in glob.glob(f"{SITE}/knowledge/*.md") if not re.search(r"(INDEX|CHECKLIST|SOURCES-LOCKED)\.md$", f)]
    urls, techs = set(), 0
    for f in kfiles:
        t = open(f, encoding="utf-8").read()
        urls |= {u.rstrip(").,>]*`'\"") for u in re.findall(r"https?://[^\s)>\]]+", t)}
        techs += len(set(re.findall(r"^#{2,4}\s*\(?([A-Z]{1,2}\d{1,2})\b", t, re.M)))
    d.setdefault("knowledge", {})["stats"] = {"files": len(kfiles), "techniques": techs, "sources": len(urls)}

    # history keeps every old point with its own total; new points use the full-book total
    hist = d.setdefault("history", [])
    last = hist[-1] if hist else {}
    pt = {"t": now(), "recipes": tot["dishes"][0], "total": tot["dishes"][1], "flavours": tot["flavours"][0], "extra": tot["extra"], "metric": "dishes"}
    if (last.get("recipes"), last.get("total"), last.get("flavours"), last.get("extra")) != (pt["recipes"], pt["total"], pt["flavours"], pt["extra"]):
        hist.append(pt)
    # newest log entry first (entries were sometimes appended at the end)
    def lk(e):
        m = re.match(r"([A-Z][a-z]{2}) (\d{1,2})(?: (\d\d):(\d\d))?", e.get("t", ""))
        if not m: return (0, 0)
        mo = "JanFebMarAprMayJunJulAugSepOctNovDec".index(m.group(1)) // 3 + 1
        return (mo * 100 + int(m.group(2)), int(m.group(3) or 0) * 60 + int(m.group(4) or 0))
    d["log"] = sorted(d.get("log", []), key=lk, reverse=True)
    print(f"derived: dishes {tot['dishes'][0]}/{tot['dishes'][1]} · book flavours {tot['flavours'][0]}/{tot['flavours'][1]}"
          f" · extra {tot['extra']} · {len(ch)} chapters · focus {d['focus']} · knowledge {len(kfiles)}/{techs}/{len(urls)}")

def dump(d, p):
    """indent=2, but each dish on one line so data.json stays small."""
    dishes = d.pop("dishes", None)
    txt = json.dumps(d, ensure_ascii=False, indent=2)
    if dishes is not None:
        body = ",\n    ".join(json.dumps(x, ensure_ascii=False, separators=(",", ":")) for x in dishes)
        txt = txt[:-2] + ',\n  "dishes": [\n    ' + body + "\n  ]\n}"
        d["dishes"] = dishes
    open(p, "w", encoding="utf-8").write(txt + "\n")

if __name__ == "__main__":
    p = os.path.join(HERE, "data.json")
    d = json.load(open(p, encoding="utf-8"))
    if os.environ.get("NO_DERIVE", "0") != "1": derive(d)
    if "--stamp" in sys.argv: d["updatedAt"] = now(); print("updatedAt =", d["updatedAt"])
    dump(d, p); json.load(open(p, encoding="utf-8"))   # re-validate
