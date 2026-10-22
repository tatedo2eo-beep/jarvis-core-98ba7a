#!/usr/bin/env python3
"""Post work-status events to Jarvis Board v4 from Python (public ntfy.sh topic in config.json).

    from post import post
    post("recipe-writer", "step", "Drafting cakes batch 7", progress=0.3, region="drafting")
    post("recipe-writer", "done", "Cakes batch 7 published", progress=1, value=6, label="recipes", link="https://...")

CLI: python3 post.py AGENT TYPE "TEXT" [--progress 0.3] [--value 6] [--link URL] [--region ID] [--label TEXT]
Only work-status text. Never secrets or private data: the topic is public."""
import json, os, re, sys, urllib.request
HERE = os.path.dirname(os.path.abspath(__file__))
TYPES = ("start", "step", "done", "metric", "say")
SECRET = re.compile(r"(ghp_|gho_|github_pat_|sk-[A-Za-z0-9]{8}|AKIA[0-9A-Z]{12}|password|passwd|secret|token=|BEGIN [A-Z ]*PRIVATE KEY)", re.I)

def _cfg(name): return json.load(open(os.path.join(HERE, name), encoding="utf-8"))

def post(agent, type, text, progress=None, value=None, link=None, region=None, label=None):
    if type not in TYPES: raise ValueError(f"type must be one of {TYPES}")
    ids = {a["id"] for a in _cfg("agents.json")["agents"]}
    if agent not in ids: raise ValueError(f"unknown agent {agent!r}; known: {sorted(ids)}")
    ev = {"agent": agent, "type": type, "text": str(text)}
    if progress is not None: ev["progress"] = max(0.0, min(1.0, float(progress)))
    for k, v in (("value", value), ("link", link), ("region", region), ("label", label)):
        if v is not None: ev[k] = v
    body = json.dumps(ev, ensure_ascii=False)
    if SECRET.search(body): raise ValueError("refused: event looks like it contains a secret")
    c = _cfg("config.json")
    req = urllib.request.Request(c["ntfyServer"].rstrip("/") + "/" + c["topic"], data=body.encode(),
                                 headers={"Title": "jarvis-board"}, method="POST")
    with urllib.request.urlopen(req, timeout=15) as r: r.read()
    return ev

if __name__ == "__main__":
    import argparse
    p = argparse.ArgumentParser(description="Post an event to Jarvis Board v4")
    p.add_argument("agent"); p.add_argument("type", choices=TYPES); p.add_argument("text")
    p.add_argument("--progress", type=float); p.add_argument("--value", type=float)
    p.add_argument("--link"); p.add_argument("--region"); p.add_argument("--label")
    a = p.parse_args()
    v = a.value if a.value is None or not float(a.value).is_integer() else int(a.value)
    print("posted:", json.dumps(post(a.agent, a.type, a.text, a.progress, v, a.link, a.region, a.label), ensure_ascii=False))
