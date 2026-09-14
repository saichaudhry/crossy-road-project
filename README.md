# Crossy Road

> **▶ Play it:** https://saichaudhry.github.io/crossy-road-project/

<!-- ══════════════════════════════════════════════════════════════════════
     WRITE THIS PARAGRAPH YOURSELF — the assignment says not to use AI for it.
     1–2 sentences: what the game is, and how it differs from stock Crossy Road.
     ══════════════════════════════════════════════════════════════════════ -->
_[Your 1–2 sentences here.]_

## How to play

| Input | Action |
| --- | --- |
| `↑ ← ↓ →` or `W A S D` | Hop one tile |
| Tap / swipe (touch) | Hop |
| `Space` / `Enter` | Start, or play again |
| `Esc` / `P` | Pause |
| `M` | Mute |

**Scoring.** Every new row you reach is one point; your score is the furthest row you've ever stood on, so backtracking never costs you. Coins on the grass are banked when a run ends and buy characters in the **Characters** menu. Your best score and coins are saved in the browser.

**Losing.** Cars, vans and trucks squash you. Trains flatten you — a signal blinks before every one. On rivers you must land on a log or lily pad, or you drown; ride a log off the edge of the screen and you're swept away. And the screen keeps scrolling forward on its own: stand still and it carries you to the bottom edge, where the eagle takes you. Once it has committed there is no hopping out from under it.

## AI tools used

Built with **Claude Code** (the CLI) in auto mode — **Claude Opus 5** for the initial build, then **Claude Fable 5.1** for debugging and finishing. In class I used **Kiro**. <!-- EDIT: adjust if that's not right -->

**Strategy** <!-- EDIT — this is a draft of what actually happened; put it in your own words -->: one broad kickoff prompt asking for the full game built from scratch, then short, specific bug reports written the way I'd describe them to a person ("it should still scroll up if I'm not moving", "eagle does not come ever"). The AI kept the game logic separate from the Three.js rendering so it could unit-test the rules in Node, and it screenshotted its own work in headless Chrome to catch visual bugs the tests couldn't.

## Running it

It's a static page — open the folder over any web server and it runs. Nothing to install and no build step: Three.js is committed into `vendor/` and wired up with an import map in `index.html`.

```bash
# any static server works, e.g.
python3 -m http.server 8000     # then open http://localhost:8000/
```

(`file://` won't work because the game uses ES modules; that's a browser rule, not a build step. GitHub Pages serves over https, so it's fine there.)

`npm install && npm test` runs the 27 tests over the game logic — optional, only for development.

## What's in the world

Terrain is generated one row at a time in short clusters — a two-lane road, a three-log river — so the map reads as a landscape. Difficulty ramps with distance: traffic speeds up, gaps tighten, and trains start after row 12. A guaranteed-open corridor drifts across forest rows so trees can never seal you in.

Everything on screen is built from boxes and low-poly cylinders in code; there are no image, model or audio files. Sound effects are synthesised with the Web Audio API.

## How it's put together

```
index.html         page, HUD and menus; import map for Three.js
src/
  core/            the game — pure JavaScript, no rendering, no DOM
    constants.js     grid, timings, tuning knobs
    rng.js           seeded PRNG (a run is reproducible from its seed)
    rows.js          terrain generation and traffic
    game.js          movement, collisions, camera scroll, the eagle
    characters.js    playable characters as colour palettes
  render/          Three.js — reads the core's state, writes meshes
    models.js        every voxel model
    rowViews.js      one view per terrain row, streamed in and out
    renderer.js      scene, camera fitting, animation
  game/            browser glue: input, Web Audio, UI, localStorage
  main.js          wiring and the frame loop
vendor/            three.module.js + three.core.js (r186) and its licence
test/              27 Node tests over src/core
tools/shoot.mjs    screenshots the game in headless Chrome (development only)
```

Two decisions carry most of the design: **the game logic knows nothing about Three.js**, which is what makes it testable; and **traffic is stateless** — a vehicle's position is a pure function of the clock, so nothing drifts, wrapping is exact, and off-screen rows cost nothing.

## Known issues / unfinished

- Not yet customised — this is still a faithful clone. (See "Make It Yours" in the brief.)
- The character portraits in the shop are CSS approximations, not the 3D models.
- On a slow machine the game drops shadows automatically after a couple of seconds of low frame rate; that's intended, but it's a visible change.
- No music, only sound effects.
- Rows are 11 tiles wide, so on a phone in portrait you see many more rows than on a laptop; the width is what sets the zoom.

## Files for the assignment

- `README.md` — this file
- `prompt_log.md` — models/tools used and the prompts, verbatim
- `REFLECTION.md` — not needed; the game is finished
