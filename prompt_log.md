# Prompt log — Night Crossing

**Tools and models**

The whole project was built in one Claude Code session (CLI, auto mode). The model started as **Claude Opus 5 (1M context)** and was switched with `/model` to **Claude Fable 5.1** before the debugging prompts. This log is complete — every prompt that shaped the game is here.

Prompts below are reproduced **verbatim**, typos included. The notes under each one are a short factual record of what the AI did in response, added afterwards so the log reads as a development process rather than a transcript dump.

---

## Prompts

### 1. Opus 5 — the kickoff prompt

> i watn to fully recreate crossy road https://github.com/hydroshiba/crossy-clone , this is one example but you need to build it from scratch

**What happened:** Claude scaffolded a Vite + Three.js project and wrote the whole first version from scratch in one turn (~1,900 lines): a pure-JS simulation core (seeded terrain generator, stateless traffic, hop/collision/river-riding logic, eagle), a Three.js renderer with procedurally built voxel models, Web Audio sound synthesis, HUD/menus/character shop, and 18 Node tests. It then drove headless Chrome over the DevTools Protocol to screenshot the result and fixed four bugs it saw in the screenshots — the camera fitting was using the moving camera as its own reference frame, an asymmetric frustum fit that zoomed the game out to 20 rows, a sign-extended bit shift producing negative array indices, and (from a failing test) trains that could arrive before their warning light.

### 2. Opus 5

> keep running on caffeinate

**What happened:** Started `caffeinate` in the background so the Mac wouldn't sleep during the long build. (It was later killed by macOS for memory pressure twice and relaunched detached with `nohup`.)

### 3. Fable 5.1 — first bug report

> need to impraove logic on dying it has some bugs right now, go through it and make some more changes as well thingk the scroll issue isn't the best

**What happened:** Claude re-read the death and camera code and identified: mid-hop hits flattened the chicken in mid-air; the next row's traffic could hit you ~28% into a hop (the ease-out is front-loaded); landing from a log onto grass could land off-grid; buffered moves fired after death; and the camera followed the player backwards then clamped, while the movement limit lived in a different module, so you could walk off the bottom of the screen. It moved the camera into the simulation as a forward-only scroll, tied the back-hop limit to the visible screen edge, made hits only count when you're actually over that row, and added tests for each.

### 4. Fable 5.1 — mid-turn

> ALSO NO dying from the eagle logic

**What happened:** Claude misread this as "remove the eagle" and deleted it everywhere. (It was actually a bug report: the eagle never triggered. See prompt 6.)

### 5. Fable 5.1

> scroll issue is bad, it should still scroll up if i am not moving

**What happened:** Added a constant forward creep to the camera (0.45 rows/s) that scrolls on its own when the player stops, never moves backwards, and parks with the player at the bottom edge rather than pushing them off screen.

### 6. Fable 5.1

> eagle does not ocme ever

**What happened:** Claude realised prompt 4 had been a bug report, apologised, and restored the eagle — now driven by the scroll: once the creep has parked you at the bottom edge for 0.7s it commits (≈5.5s of standing still), input is refused from that moment, the view holds, and the eagle dives in from off-screen and carries the character away. 27 tests passing.

### 7. Fable 5.1 — finishing for submission

> how far are we finish all of this right now The In-Class Challenge (30 minutes) …

_(followed by the full assignment brief pasted in)_

**What happened:** Converted the project to run with no build step for GitHub Pages (Three.js committed into `vendor/` with an import map, verified headlessly), and wrote this log and the assignment README.

### 8. Fable 5.1

> post it here https://github.com/saichaudhry/crossy-road-project

**What happened:** Initialised git, committed, pushed to the empty repo, enabled GitHub Pages from `main`, and loaded the live URL in headless Chrome to confirm the game actually ran there (not just that it returned 200).

### 9. Fable 5.1

> you make all thi sand push it, finish up everything left rom above to finsih the project

and, mid-turn:

> you have done everything write it and iwill edit it , all the prompts cmae thorugh here

**What happened:** Claude first flagged that the brief asks for the README's "what is it" sentences to be student-written; I told it to draft them for me to edit. It then did the rest: a "make it yours" customisation — the run fades from day to night with distance, with headlight beams, glowing windows and tail-lights — renamed the game Night Crossing, finished the README and this log, added the project to the portfolio site, and pushed everything.

---
