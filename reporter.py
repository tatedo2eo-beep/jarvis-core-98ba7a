#!/usr/bin/env python3
"""Jarvis Board live reporter. Polls REAL work every 1.5 s (read-only) and publishes work-status only.

Sources (all read-only):  /workspace/rw/runq.log, raw_*.done, raw_*_limit.txt, outline_*.txt, queue.txt
                          runq2.sh / claude / claude_research.py processes (ps)
                          /workspace/public-site/content/recipes/*.json count and git commits
Channels:
  live       ntfy.envs.net  (config.json live.*): heartbeat snapshot + every real event, token bucket 1 msg / 6 s
             (anonymous limit there is 17,280 msgs/day = 1 per 5 s; we stay at <= 14,400/day). Events are batched
             into the next message, so nothing is dropped.
  milestone  ntfy.sh (config.json topic): only batch finished / limit hit / pages published / queue empty,
             max MILESTONE_BUDGET per Cairo day, and never when ntfy.sh says < RESERVE messages remain for this IP
             (ntfy.sh free tier = 250 msgs/day per IP, shared with post.sh and anything else on this box).
Run via ./start-reporter.sh (idempotent). Log: reporter.log. State: reporter_state.json."""
import json, os, re, glob, time, subprocess, urllib.request, datetime, zoneinfo, secrets, sys, collections, threading, queue as Q
HERE = os.path.dirname(os.path.abspath(__file__))
RW, SITE = "/workspace/rw", "/workspace/public-site"
TZ = zoneinfo.ZoneInfo("Africa/Cairo")
POLL, LIVE_EVERY, BUCKET = 1.5, 6.0, 5
MILESTONE_BUDGET, RESERVE = 120, 60
SECRET = re.compile(r"(ghp_|gho_|github_pat_|sk-[A-Za-z0-9]{8}|AKIA[0-9A-Z]{12}|password|passwd|secret|token=|BEGIN [A-Z ]*PRIVATE KEY)", re.I)
CFG = json.load(open(os.path.join(HERE, "config.json")))
LIVE_URL = CFG["live"]["server"].rstrip("/") + "/" + CFG["live"]["topic"]
MS_URL = CFG["ntfyServer"].rstrip("/") + "/" + CFG["topic"]
STATE_P = os.path.join(HERE, "reporter_state.json")

def log(*a): print(datetime.datetime.now(TZ).strftime("%H:%M:%S"), *a, flush=True)
def clean(s): s = str(s); return "[filtered]" if SECRET.search(s) else s[:300]

# ---------- read-only probes ----------
def ps():
    out = subprocess.run(["ps", "-eo", "pid=,ppid=,etimes=,args="], capture_output=True, text=True).stdout
    rows = []
    for l in out.splitlines():
        p = l.split(None, 3)
        if len(p) == 4: rows.append((int(p[0]), int(p[1]), int(p[2]), p[3]))
    return rows

_outline = {}
def batch_info(b):
    if b in _outline: return _outline[b]
    try: txt = open(f"{RW}/outline_{b}.txt", encoding="utf-8").read()
    except OSError: txt = ""
    slugs = re.findall(r"^### slug: (\S+)", txt, re.M)
    ch = None
    try:
        sys.path.insert(0, RW); from registry import REG
        names = {c["key"]: c["name"] for c in json.load(open(f"{SITE}/src/lib/book-chapters.json", encoding="utf-8"))}
        bytitle = {v["title"]: v["book_chapter"] for v in REG.values()}
        cs = collections.Counter(names.get(bytitle[t], bytitle[t]) for t in re.findall(r"\(dish: (.+?), flavour:", txt) if t in bytitle)
        ch = cs.most_common(1)[0][0] if cs else None
    except Exception: pass
    _outline[b] = {"n": len(slugs), "ch": ch}; return _outline[b]

def probe():
    now = time.time(); rows = ps(); kids = collections.defaultdict(list)
    for r in rows: kids[r[1]].append(r)
    workers, tracked = [], []
    for pid, ppid, et, args in rows:
        if "runq2.sh" not in args or "bash" not in args: continue
        q = args.split("runq2.sh", 1)[1].split()
        tracked += q
        cur = next((b for b in q if not os.path.exists(f"{RW}/raw_{b}.done")), None)
        st, since = "idle", None
        for k in kids[pid]:
            if "claude" in k[3]: st, since = "running", now - k[2]
            elif k[3].startswith("sleep"):
                st, since = "waiting", now - k[2]
                try:
                    if cur and os.path.getmtime(f"{RW}/raw_{cur}_limit.txt") > now - 1500: st = "limit"
                except OSError: pass
                try: slp = int(k[3].split()[1])
                except Exception: slp = 0
                wake = now - k[2] + slp if slp else None
        w = {"pid": pid, "batch": cur, "state": st, "since": int(since) if since else None,
             "done": sum(os.path.exists(f"{RW}/raw_{b}.done") for b in q), "total": len(q)}
        if st in ("waiting", "limit") and wake: w["wake"] = int(wake)
        if cur: w.update(batch_info(cur))
        workers.append(w)
    try: tracked += open(f"{RW}/queue.txt").read().split()
    except OSError: pass
    tracked = list(dict.fromkeys(tracked))
    done_files = {os.path.basename(f)[4:-5] for f in glob.glob(f"{RW}/raw_*.done")}
    claude = sum(1 for r in rows if re.search(r"(^|/)claude(\s|$)", r[3]))
    research = any("claude_research.py" in r[3] for r in rows)
    limit_txt = None
    lims = sorted(glob.glob(f"{RW}/raw_*_limit.txt"), key=os.path.getmtime)
    if lims and os.path.getmtime(lims[-1]) > now - 1500:
        m = re.search(r"resets ([0-9:apm]+)", open(lims[-1], encoding="utf-8", errors="replace").read())
        limit_txt = m.group(1) if m else "soon"
    pages = len(glob.glob(f"{SITE}/content/recipes/*.json"))
    try:
        c = subprocess.run(["git", "-C", SITE, "log", "-1", "--format=%H\t%ct\t%s"], capture_output=True, text=True).stdout.strip().split("\t")
        commit = {"h": c[0][:8], "t": int(c[1]), "s": clean(c[2])[:100]}
    except Exception: commit = None
    return {"workers": workers, "batches": {"tracked": len(tracked), "done": sum(b in done_files for b in tracked),
            "left": sum(b not in done_files for b in tracked)}, "draftsDone": len(done_files), "pages": pages,
            "commit": commit, "claude": claude, "research": research, "limitResets": limit_txt}

_book = {"key": None, "v": None}
def book(pages, commit):
    """Book progress exactly as derive.py counts it (read-only), recomputed only when the site changes."""
    try: key = (pages, os.stat(f"{SITE}/content/recipes").st_mtime, (commit or {}).get("h"))
    except OSError: key = (pages, None, None)
    if key == _book["key"]: return _book["v"]
    try:
        import io, contextlib; sys.path.insert(0, HERE); import derive
        d = {}
        with contextlib.redirect_stdout(io.StringIO()): derive.derive(d)
        _book["v"] = {"dishes": [d["headline"]["done"], d["headline"]["total"]], "flavours": [d["flavours"]["done"], d["flavours"]["total"]],
                      "extra": d["extraFlavours"]["done"], "chapters": [d["derived"]["chaptersComplete"], len(d["chapters"])], "focus": d["focus"]}
        _book["key"] = key
    except Exception as e:
        log("book derive failed:", repr(e))
    return _book["v"]

# ---------- publishing ----------
def http_post(url, body, title="jarvis-board"):
    req = urllib.request.Request(url, data=body.encode(), headers={"Title": title}, method="POST")
    with urllib.request.urlopen(req, timeout=15) as r: r.read()

class Live(threading.Thread):
    """token bucket: 1 message per LIVE_EVERY s, burst BUCKET; pending events are batched into the next message."""
    def __init__(s): super().__init__(daemon=True); s.recent = load_state().get("recent", []); s.pend = []; s.lock = threading.Lock(); s.tokens = BUCKET; s.last = 0; s.snap = None; s.sent = 0
    def add(s, ev):
        with s.lock: s.pend.append(ev); s.pend = s.pend[-20:]
    def run(s):
        while True:
            time.sleep(0.5); now = time.time()
            s.tokens = min(BUCKET, s.tokens + 0.5 / LIVE_EVERY)
            with s.lock: has = bool(s.pend)
            due = has or (now - s.last >= LIVE_EVERY)
            if not due or s.tokens < 1 or s.snap is None: continue
            with s.lock: evs, s.pend = s.pend, []
            s.recent = (getattr(s, "recent", []) + evs)[-10:]
            rec = list(s.recent)
            while True:   # ntfy turns messages > 4096 bytes into attachments: keep well under
                msg = {"k": "hb", "t": int(now), "snap": s.snap, "ev": evs, "recent": [e for e in rec if e not in evs]}
                body = json.dumps(msg, ensure_ascii=False, separators=(",", ":"))
                if len(body.encode()) < 3800 or not (rec or evs): break
                if rec: rec.pop(0)
                else: evs = evs[1:]
            if SECRET.search(body): log("refused live message (secret-like)"); continue
            try: http_post(LIVE_URL, body); s.tokens -= 1; s.last = now; s.sent += 1
            except Exception as e:
                log("live post failed:", e); s.tokens -= 1
                with s.lock: s.pend = (evs + s.pend)[-20:]
                time.sleep(5)

def load_state():
    try: return json.load(open(STATE_P))
    except Exception: return {}
def save_state(st): json.dump(st, open(STATE_P + ".tmp", "w")); os.replace(STATE_P + ".tmp", STATE_P)

_ms_check = {"t": 0, "ok": True}
def milestone(ev, st):
    day = datetime.datetime.now(TZ).date().isoformat()
    if st.get("msDay") != day: st["msDay"], st["msCount"] = day, 0
    if st["msCount"] >= MILESTONE_BUDGET: return
    if time.time() - _ms_check["t"] > 300:
        try:
            a = json.load(urllib.request.urlopen("https://ntfy.sh/v1/account", timeout=10))
            _ms_check["ok"] = a["stats"]["messages_remaining"] > RESERVE
        except Exception: pass
        _ms_check["t"] = time.time()
    if not _ms_check["ok"]: return
    body = json.dumps(ev, ensure_ascii=False)
    if SECRET.search(body): return
    try: http_post(MS_URL, body); st["msCount"] += 1
    except Exception as e: log("milestone post failed:", e)

# ---------- main loop ----------
def main():
    live = Live(); live.start(); st = load_state()
    prev = None; logpos = st.get("logpos")
    try: size = os.path.getsize(f"{RW}/runq.log")
    except OSError: size = 0
    if logpos is None or logpos > size: logpos = size          # never replay old lines as new
    lastEv = st.get("lastEv"); prev_workers = {}
    log("reporter up · live", LIVE_URL, "· milestones", MS_URL)
    def emit(agent, typ, text, ms=False, **kw):
        nonlocal lastEv
        ev = {"id": secrets.token_hex(5), "agent": agent, "type": typ, "text": clean(text), "t": int(time.time()), **kw}
        live.add(ev); lastEv = ev["t"]; log("event", agent, typ, text)
        if ms: milestone(ev, st)
    while True:
        t0 = time.time()
        try:
            snap = probe(); snap["book"] = book(snap["pages"], snap["commit"])
            # runq.log new lines
            try:
                with open(f"{RW}/runq.log", encoding="utf-8", errors="replace") as f:
                    f.seek(logpos); new = f.read(); logpos = f.tell()
            except OSError: new = ""
            for line in new.splitlines():
                m = re.match(r"(\d\d:\d\d:\d\d) (\S+) exit=(\d+) bytes=(\d+)", line)
                if m:
                    b, rc, by = m.group(2), int(m.group(3)), int(m.group(4)); bi = batch_info(b)
                    if rc == 0 and by >= 2000:
                        emit("recipe-writer", "done", f"Batch {b} drafted · {bi['n']} dishes" + (f" · {bi['ch']}" if bi["ch"] else ""), ms=True, value=bi["n"], label="dishes drafted")
                    elif by < 600: pass   # a limit line follows
                    else: emit("recipe-writer", "step", f"Batch {b} attempt failed (exit {rc}), retrying")
                    continue
                m = re.match(r"(\d\d:\d\d:\d\d) (\S+) limit, sleeping (\d+)s", line)
                if m:
                    emit("claude-code", "metric", f"Claude Code session limit · batch {m.group(2)} waits {int(m.group(3))//60} min" + (f" · resets {snap['limitResets']}" if snap["limitResets"] else ""), ms=True)
                    continue
                if "queue empty" in line: emit("recipe-writer", "done", "Draft queue empty · all batches finished", ms=True)
            if prev:
                # worker transitions (batch started)
                for w in snap["workers"]:
                    pw = prev_workers.get(w["pid"])
                    if w["state"] == "running" and (not pw or pw["state"] != "running" or pw["batch"] != w["batch"]):
                        emit("recipe-writer", "start", f"Drafting batch {w['batch']} · {w.get('n', '?')} dishes" + (f" · {w['ch']}" if w.get("ch") else ""), progress=0)
                if snap["draftsDone"] != prev["draftsDone"]:
                    emit("recipe-writer", "metric", f"Draft batches done: {snap['draftsDone']}", value=snap["draftsDone"], label="draft batches done")
                if snap["pages"] != prev["pages"]:
                    d = snap["pages"] - prev["pages"]
                    emit("recipe-checker", "done", f"{'+' if d > 0 else ''}{d} recipe pages · {snap['pages']} live on the test site", ms=True, value=snap["pages"], label="recipe pages live")
                if snap["book"] and prev.get("book") and snap["book"]["dishes"] != prev["book"]["dishes"]:
                    b = snap["book"]; d = b["dishes"][0] - prev["book"]["dishes"][0]
                    emit("recipe-checker", "metric", f"Book dishes written: {b['dishes'][0]}/{b['dishes'][1]} ({'+' if d > 0 else ''}{d})", value=b["dishes"][0], label="book dishes written")
                if snap["commit"] and prev["commit"] and snap["commit"]["h"] != prev["commit"]["h"]:
                    emit("recipe-checker", "step", f"Site commit: {snap['commit']['s']}")
                if snap["claude"] != prev["claude"]:
                    emit("claude-code", "metric", f"Claude Code processes running: {snap['claude']}", value=snap["claude"], label="claude processes")
                if snap["research"] != prev["research"]:
                    emit("research", "start" if snap["research"] else "done", "Research worker running" if snap["research"] else "Research worker finished")
            prev_workers = {w["pid"]: w for w in snap["workers"]}
            prev = snap; snap["lastEv"] = lastEv; snap["at"] = int(time.time()); live.snap = snap
            st["logpos"], st["lastEv"], st["recent"] = logpos, lastEv, live.recent; save_state(st)
        except Exception as e:
            log("poll error:", repr(e))
        time.sleep(max(0.2, POLL - (time.time() - t0)))

if __name__ == "__main__": main()
