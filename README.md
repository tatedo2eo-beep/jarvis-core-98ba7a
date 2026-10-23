# Jarvis Board v4 — Jarvis Core

A live command centre for Joe's AI agents (the recipe-website crew). It is an original design: reference videos were used for mood and layout ideas only, and nothing was copied.

**Live:** https://tatedo2eo-beep.github.io/jarvis-core-98ba7a/ (`noindex, nofollow`)

## Views
- **Core (default):** a 3D neural "dandelion" (three.js) with thousands of hair fibres, GPU particles and node webs. It has one colour sector per agent around a dark-blue core with a cyan rim.
  - **Agent sectors.** Each agent owns a sector. Its brightness and particle speed follow the agent's **real** status: live, waiting, idle or planned. A real event pulses the sector.
  - **Labels and panels.** Floating label boxes show one real stat per agent. The right panel (*Neural link / Cortex status*) lists agents with LIVE / WAITING / IDLE / PLANNED badges and the real draft-worker queue.
  - **Left panel.** It stays hidden when idle and slides in on `say` and `done` events, cycling titled data blocks: the book, the queue, 7-day and 24-hour commit charts, and the site. Click the top pill to open it by hand.
  - **Say events.** A `say` event lights a vertical beam while the subtitle types.
  - **Header.** The top pill shows `last real event … ago`, ticking every second.
- **Inside an agent:** click a label or a list row. The camera flies into that sector, which shows real stats and that agent's real event feed. Press `Esc` or *Back to core* to leave.
- **Flow:** a draggable node graph of how work moves. Your layout is saved in your browser. Cards show only real values.

Rotation, fibres and particles are decorative motion. **No number on the page is random or simulated.** Every number changes only when its real source changes (see the table). Elements that could not be backed by real data (the old "firing %", fake counters) were removed.

## Where every number comes from
| UI text | Source |
|---|---|
| Book dishes written `261/885`, flavours `85/227`, extra flavours, chapters complete `7/34`, "now writing" | `derive.py` (read-only) on the book recipe files. Computed live by `reporter.py` (cached by recipes-folder mtime and site commit) and sent in every heartbeat. `data.json` (`derive4.py`) is the fallback. |
| Recipes live on the site | Recipe pages listed in the **public test site's `sitemap.xml`** (what visitors can open), fetched by `reporter.py` every 20 s; `derive4.py` (`real.livePages`) is the fallback. |
| Recipe files in the build | `content/recipes/*.json` in the site working copy, counted every 1.5 s. This includes recipes written but not yet published. |
| Recipes written tonight, batches, per-batch rows | `rw/manual_progress.log` (one line `HH:MM:SS batch N` per finished batch), re-read by `reporter.py` whenever the file changes. |
| Draft batches done · all time / queued | `runq` logs and the queue files of the draft workers (`reporter.py` probe). |
| Queue rows (batch, chapter, dishes, `limit · retry HH:MM`, `drafting m:ss`, `list x/y`) | Running `runq2.sh` processes: their argument list, `sleep` child and outline files. |
| Claude processes, session-limit reset time | `ps` count of Claude Code processes; the reset time is parsed from the worker's limit message. |
| Techniques, sources, knowledge files | The research knowledge-base files (`derive4.py`). |
| 7-day / 24-hour charts | **Git commit timestamps** of the test-site repo (`derive4.py`, `real.chart`). |
| Latest site commit, site commits today, publish list | `git log` of the site repo (last 5 commits, and commits since 00:00 Cairo), live in every heartbeat. |
| Last real event / heartbeat ago, clock | Timestamps of received ntfy messages; Cairo time. |
| Real events · 30 min / 12 h | Count of real events received from the two topics. |

## Live feed — two public ntfy topics
- **Live channel** (heartbeat every 6 s plus every event): `https://ntfy.envs.net/jarvis-v4-live-no6j144aue080rgcgb9ue7hzd7`
- **Milestones** (12 h history plus a fallback): `https://ntfy.sh/jarvis-v4-ynemhypj7av5ov3hozqijgawzzn5`

The page subscribes to both (SSE, with a backfill poll on connect and auto-reconnect) and de-duplicates by event id.

> **Note:** both topic names are in the public page source, so anyone can read or post to them. This is accepted for a non-sensitive work-status feed. **Only work-status text is posted. Never post secrets, tokens, passwords or private data.** `post.sh`, `post.py` and `reporter.py` drop anything that looks like a secret.

**Why two servers (ntfy limits):**
- ntfy.sh's free tier allows about **250 messages/day per IP**, with bursts of 60 refilling at 1 per 5 s. A 5–6 s heartbeat (14,400/day) is impossible there.
- The heartbeat therefore goes to **ntfy.envs.net** (17,280/day anonymous, CORS open). The reporter rate-limits itself to at most 1 message per 6 s, with a burst of 5, and batches events into the next heartbeat.
- Milestones go to ntfy.sh within a self-imposed budget of 120/day, always keeping 60 in reserve, and are checked against `/v1/account`.
- Messages are capped well under 4096 bytes.
- MQTT was not possible: this box only has outbound 80/443.

## Posting events
```bash
./post.sh jarvis say "Batch m4 resumes at 4:20am when the Claude limit resets."
./post.sh recipe-writer done "Batch r3 drafted · 5 dishes · Rice" 1 value=5 label="dishes drafted"
./post.sh research metric "Techniques indexed" value=74 label=techniques
python3 post.py recipe-checker step "Checking oven temperatures" --progress 0.6
```
- Types: `start | step | done | metric | say`.
- Agents: `jarvis, recipe-writer, recipe-checker, claude-code, research, planner, social-media, video-maker, video-editor`.
- `post.sh` posts to the milestone topic.

## Live reporter (`reporter.py`)
`reporter.py` polls every **1.5 s**, using read-only probes of processes, the runq log, site pages, git and book files. It posts an event on every real change:
- a batch started or drafted
- a session limit
- recipe pages +N
- book dishes changed
- a new site commit
- a change in the Claude process count
- the research worker starting or stopping

It sends a heartbeat with a full status snapshot every 6 s.

```bash
./start-reporter.sh           # idempotent: starts it under nohup unless already running
./start-reporter.sh --watch   # also starts a watchdog that re-checks every 30 s (idempotent)
./start-reporter.sh --stop    # stops watchdog and reporter
tail -f reporter.log          # rotated above 5 MB
```

## Performance
- **Rendering.** One merged `LineSegments` buffer with all fibre motion in a GPU vertex shader, and GPU particles.
- **Bloom.** Half-resolution bloom.
- **Resolution.** DPR is capped at 1.5 on desktop and 1 on phones.
- **Adaptive quality.** fps is measured for the first 2–4 s. If it is below 55, the board steps down: fewer fibres, then no bloom. Force a level with `?q=0|1|2`, or disable adapting with `?adaptive=0`.
- **Hidden tabs.** The board pauses when the tab is hidden.

## Data and publishing
`./publish.sh` runs `derive4.py`, which writes `data.json`, then commits and pushes **to this repo only** using GH_TOKEN via `gh`.

Built with three.js r169 and GSAP, vendored. Fonts: Inter and JetBrains Mono (OFL).

## v7: outside / inside views + orbit controls
- OUTSIDE (first screen): saturated neon burst (deep blue, white-cyan hot core, long neon fibres).
- INSIDE (tap/click the core, or "Enter core"): the v6 dot-brain look from commit 5613e14 (same fibres, tips, background, bloom, brain colours, grey glass panels). "Outside" or Esc goes back. The two looks cross-fade during a smooth camera zoom.
- Orbit controls in both views (three.js OrbitControls, as in v3 fcd8240): drag/touch to rotate freely, pinch/scroll to zoom, damped glide, gentle auto-rotate when idle (pauses while dragging, resumes after 3.5 s). Labels on the far side of the brain dim.
- `tools_fps2.py` measures fps idle and while actively dragging (desktop mouse, phone CDP touch at 4x CPU throttle), both views. Results in shots/fps_rotate.json.

## v8: three levels

1. **Outside**: a glowing core with coloured tendrils. The glow is always on; bloom is never switched off. Slow devices only lose dots, tendrils and resolution. The colours drift in slow waves through one shared cyclic palette (`wpal` in the shaders).
2. **Inside**: the dot brain from v7, unchanged.
3. **Deeper**: tap an agent, or pick it from the list, to fly into its own dot cloud.
   - Each cluster is one real task, labelled with its real count (for example `sp5 · 7 recipes`). Dots are capped at 90 per cluster for speed; the label always shows the true count.
   - Tap a cluster, or its row in the side sheet, to open it. It lists the real recipe names, files or chapters where they were recorded.
   - The breadcrumb at the top, the back button or Esc go up one level.
   - Agents with no tasks show "Nothing running".

   Where each agent's tasks come from:

   | Agent | Source |
   |---|---|
   | Recipe Writer | live worker processes plus the logged batches |
   | Recipe Checker | site publishes |
   | Research | knowledge files |
   | Planner | chapters by state |
   | Claude Code | live processes |
   | Jarvis | real events from the last 12 h, grouped by agent |

Panels: frosted sheets, thin Inter type with JetBrains Mono for numbers, hairline rows, and a glowing dot plus a word for status.

The ntfy topic names are still in the public page source. That is accepted for this non-sensitive work-status feed, which posts only work-status text and never secrets or private data.

## v9 (Oct 23, 2026)
- Readability: capped core blowout (lower bloom/burst), labels get dark halos, are pushed outside the core radius and de-overlapped.
- Outside: denser thin tendrils with tip nodes and tags; left metrics card and bottom subtitle line (desktop), real values only.
- Inside: top-view two-hemisphere dot brain with a clear fissure and sulci; agent regions mapped onto the top surface.
- Flow: glass node cards, thin gradient curved links with particle flow (speed from real live status/events), staggered eased entry, parallax, wider layout (Joe above Jarvis), colliding link labels hidden. Saved layouts reset (key v9).
