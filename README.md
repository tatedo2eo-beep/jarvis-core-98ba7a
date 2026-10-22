# Jarvis Board v3 — Jarvis Core

A live sci-fi command centre for Team Joe's AI agents (the recipe-website crew).

**Live:** https://tatedo2eo-beep.github.io/jarvis-core-98ba7a/ (noindex, nofollow)

## Views
- **Core (outside):** a glowing 3D core, with an orbital ring of agent nodes and beams of data flowing to each one. It stays dim when idle and erupts when an event arrives: kinetic numbers, word-by-word subtitles, a shockwave and sparks. The left panel holds the 7-day / 24-hour output graph and metrics. The right panel lists the agents with status dots, success rings, a 12-hour activity heatmap and the event stream.
- **Flow:** a node graph of how work moves between agents (Joe → Jarvis → Research / Planner / Claude Code → Recipe Writer → Recipe Checker → Test site → Social / Video). Drag nodes to rearrange them; the layout is saved in your browser. Edges animate, and they light up when an event touches either end. Double-click a node to enter its brain. Press `F` or use the CORE/FLOW switch.
- **Brain (inside):** click any node to fly into that agent's particle brain. It shows coloured regions with live "firing %", the current task and progress, a live step feed and results with links. Drag to rotate and scroll to zoom. Press `Esc` or click "Back to core" to leave. The "Feed the brain…" box only filters the on-screen feed. It also takes the commands `/region drafting`, `/clear`, `/flow` and `/back`. It sends nothing anywhere.

Planned agents (Social Media, Video Maker, Video Editor) show as dim standby nodes. The board respects `prefers-reduced-motion` and uses fewer particles on mobile, where the panels stack.

## Live events (ntfy.sh)
The page subscribes to `https://ntfy.sh/<topic>/sse`. On each connect it backfills with `json?poll=1&since=12h`, and it reconnects automatically with backoff. It also reloads `data.json` every 5 minutes.

The topic lives in **`config.json`**.

> **Note:** the topic name is in the public page source, so anyone can read or post to it. That is accepted because this is a non-sensitive work-status feed. **Only post work-status text. Never post secrets, tokens, passwords or private data.** `post.sh` / `post.py` refuse anything that looks like a secret.

Event JSON: `{"agent","type":"start|step|done|metric|say","text","value","progress","link","region","label"}`

```bash
./post.sh jarvis say "Evening Joe. Three agents on shift."
./post.sh recipe-writer start "Cakes batch 7: 6 layer cakes" 0.05
./post.sh recipe-writer step "Drafting Victoria sponge" 0.4 region=drafting
./post.sh recipe-writer done "Cakes batch 7 published" 1 value=6 label=recipes link=https://example.com/
./post.sh research metric "Techniques indexed" value=74 label=techniques
python3 post.py recipe-checker step "Checking oven temps" --progress 0.6
```
Agent ids: `jarvis, recipe-writer, recipe-checker, claude-code, research, planner, social-media, video-maker, video-editor`.

## Data
- `data.json` comes from `derive3.py`. It wraps the v2 `derive.py`, which is read-only on the book and site folders, and adds the newest recipe links. Book counts, chapters, flavours, pipeline, milestones, knowledge and recent recipes are **real**.
- Live events are real when an agent posts them. Brain region "firing %" is derived from recent events plus a gentle idle shimmer, so it is illustrative.
- `./publish.sh` re-derives the data and pushes it to this repo only.

Built with three.js (bloom post-processing) and GSAP, vendored locally. It is an original design; other dashboards were used for ideas only.
