#!/usr/bin/env bash
# Post one work-status event to Jarvis Board v3 (public ntfy.sh topic from config.json).
# Usage: ./post.sh AGENT TYPE "TEXT" [PROGRESS 0..1] [value=N] [link=URL] [region=ID] [label=TEXT]
#   TYPE: start | step | done | metric | say
#   ./post.sh jarvis say "Evening Joe. Six agents online."
#   ./post.sh recipe-writer start "Cakes batch 7" 0
#   ./post.sh recipe-writer step "Drafting cakes batch 7" 0.3 region=drafting
#   ./post.sh recipe-writer done "Cakes batch 7 published" 1 value=6 label="recipes" link=https://example.com
# Only post work-status text. Never secrets, tokens, passwords or private data: the topic is public.
set -euo pipefail
cd "$(dirname "$0")"
[ $# -ge 3 ] || { sed -n '2,10p' "$0"; exit 1; }
JSON=$(python3 - "$@" <<'PY'
import json, re, sys
a = sys.argv[1:]; agent, typ, text = a[0], a[1], a[2]; rest = a[3:]
if typ not in ("start","step","done","metric","say"): sys.exit("type must be start|step|done|metric|say")
ids = {x["id"] for x in json.load(open("agents.json"))["agents"]}
if agent not in ids: sys.exit(f"unknown agent '{agent}'. Known: {', '.join(sorted(ids))}")
ev = {"agent": agent, "type": typ, "text": text}
if rest and "=" not in rest[0]:
    ev["progress"] = max(0.0, min(1.0, float(rest.pop(0))))
for kv in rest:
    k, _, v = kv.partition("=")
    if k not in ("value","link","region","label"): sys.exit(f"unknown option {k}")
    if k == "value":
        try: v = float(v); v = int(v) if v.is_integer() else v
        except ValueError: pass
    ev[k] = v
blob = json.dumps(ev, ensure_ascii=False)
if re.search(r"(ghp_|gho_|github_pat_|sk-[A-Za-z0-9]{8}|AKIA[0-9A-Z]{12}|password|passwd|secret|token=|BEGIN [A-Z ]*PRIVATE KEY)", blob, re.I):
    sys.exit("refused: event looks like it contains a secret")
if len(blob) > 3500: sys.exit("refused: event too long")
print(blob)
PY
)
URL=$(python3 -c 'import json;c=json.load(open("config.json"));print(c["ntfyServer"].rstrip("/")+"/"+c["topic"])')
curl -fsS -m 15 -H "Title: jarvis-board" -d "$JSON" "$URL" -o /dev/null && echo "posted: $JSON"
