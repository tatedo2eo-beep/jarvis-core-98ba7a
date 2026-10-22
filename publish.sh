#!/usr/bin/env bash
# Refresh data.json and push Board v3 to its own GitHub Pages repo (never the v2 board repo).
# Uses gh's credential helper (GH_TOKEN in the environment); no token is stored in the repo.
set -euo pipefail
cd "$(dirname "$0")"
[ "${1:-}" = "--no-derive" ] || python3 derive3.py
git add -A
git diff --cached --quiet || git commit -qm "board v3 update $(TZ=Africa/Cairo date '+%F %H:%M') Cairo"
git -c credential.helper= -c credential.helper='!gh auth git-credential' push -q origin main
echo "pushed: https://tatedo2eo-beep.github.io/jarvis-core-98ba7a/"
