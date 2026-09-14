import { createGame } from './core/game.js';
import { createRenderer } from './render/renderer.js';
import { createAudio } from './game/audio.js';
import { createInput } from './game/input.js';
import { createUI } from './game/ui.js';
import { loadSave, persist } from './game/storage.js';
import { getCharacter, CHARACTERS } from './core/characters.js';
import { trainState } from './core/rows.js';
import { RAIL } from './core/constants.js';

const canvas = document.getElementById('game');
const save = loadSave();
const audio = createAudio();
audio.setMuted(save.muted);

const renderer = createRenderer(canvas, { character: save.selected, shadows: save.shadows });
let paused = false;
let runCoins = 0;

const game = createGame({ onEvent: handleEvent });

const ui = createUI({
  onPlay: startRun,
  onOpenShop: () => ui.showShop(save),
  onCloseShop: () => (game.state.phase === 'over' ? ui.showOver(lastResult, save) : ui.showTitle()),
  onChoose: chooseCharacter,
  onToggleSound: () => {
    save.muted = !save.muted;
    audio.setMuted(save.muted);
    persist(save);
    ui.refresh(save);
  },
  onPause: () => setPaused(true),
  onResume: () => setPaused(false),
  onQuit: quitToMenu,
});

let lastResult = { score: 0, coins: 0, cause: null, newBest: false };

// --- events from the simulation -------------------------------------------

function handleEvent(type, payload) {
  switch (type) {
    case 'start':
      ui.setHint(false);
      break;
    case 'hop':
      audio.play('hop');
      break;
    case 'land':
      audio.play('land');
      break;
    case 'bump':
      audio.play('bump');
      break;
    case 'score':
      ui.setScore(payload.score);
      break;
    case 'coin':
      runCoins = payload.total;
      audio.play('coin');
      ui.setCoins(save.coins + runCoins);
      break;
    case 'eagle':
      audio.play('eagle');
      break;
    case 'death':
      onDeath(payload);
      break;
    case 'gameover':
      finishRun(payload);
      break;
    default:
      break;
  }
}

function onDeath({ cause }) {
  const p = game.state.player;
  if (cause === 'water' || cause === 'offscreen') {
    audio.play('splash');
    renderer.triggerSplash(p.x, p.z);
  } else if (cause === 'eagle') {
    /* the screech already played when it committed */
  } else {
    audio.play('crash');
    renderer.shake();
    ui.flash();
  }
}

function finishRun({ score, coins }) {
  const newBest = score > save.best;
  if (newBest) save.best = score;
  save.coins += coins;
  save.plays += 1;
  persist(save);
  runCoins = 0;
  lastResult = { score, coins, cause: game.state.death.cause, newBest };
  audio.play('gameover');
  ui.refresh(save);
  ui.showOver(lastResult, save);
}

// --- run control -----------------------------------------------------------

function startRun() {
  audio.resume();
  runCoins = 0;
  paused = false;
  game.reset();
  renderer.clearRows();
  renderer.render(game.state, 0);
  ui.hideAll();
  ui.setScore(0);
  ui.setCoins(save.coins);
  ui.setHint(true);
  trainsSounding.clear();
}

function quitToMenu() {
  paused = false;
  game.reset();
  renderer.clearRows();
  ui.setScore(0);
  ui.setHint(false);
  ui.refresh(save);
  ui.showTitle();
}

function setPaused(value) {
  if (game.state.phase !== 'playing' && value) return;
  paused = value;
  if (value) ui.showPause();
  else ui.hideAll();
}

function chooseCharacter(id) {
  const spec = getCharacter(id);
  if (!save.unlocked.includes(id)) {
    if (save.coins < spec.price) {
      audio.play('bump');
      return;
    }
    save.coins -= spec.price;
    save.unlocked.push(id);
    audio.play('unlock');
  }
  save.selected = id;
  persist(save);
  renderer.setCharacter(id);
  ui.refresh(save);
  ui.showShop(save);
}

// --- input -----------------------------------------------------------------

const input = createInput({
  target: canvas,
  onMove: (direction) => {
    if (paused || ui.isOverlayOpen()) return;
    audio.resume();
    game.queueMove(direction);
  },
  onConfirm: () => {
    if (game.state.phase === 'ready' || game.state.phase === 'over') startRun();
    else if (paused) setPaused(false);
  },
  onPause: () => setPaused(!paused),
});

for (const button of document.querySelectorAll('.dpad button')) {
  input.bindButton(button, button.dataset.dir);
}

window.addEventListener('keydown', (event) => {
  if (event.code === 'KeyM') {
    save.muted = !save.muted;
    audio.setMuted(save.muted);
    persist(save);
    ui.refresh(save);
  }
});

const markTouch = () => document.body.classList.add('touch');
window.addEventListener('touchstart', markTouch, { once: true, passive: true });
if (navigator.maxTouchPoints > 0 && !matchMedia('(pointer: fine)').matches) markTouch();

document.addEventListener('visibilitychange', () => {
  if (document.hidden && game.state.phase === 'playing') setPaused(true);
});
window.addEventListener('blur', () => {
  if (game.state.phase === 'playing') setPaused(true);
});

// --- train horns -----------------------------------------------------------
// Rail rows only make noise when the player is close enough to care.

const trainsSounding = new Set();
function updateTrainAudio() {
  const state = game.state;
  const here = Math.round(state.player.rowFloat ?? state.player.row);
  for (let r = here - 2; r <= here + 7; r++) {
    const row = state.terrain.rows.get(r);
    if (!row || row.type !== RAIL) continue;
    const active = trainState(row, state.time).active;
    if (active && !trainsSounding.has(r)) {
      trainsSounding.add(r);
      audio.play('train');
    } else if (!active) {
      trainsSounding.delete(r);
    }
  }
}

// --- main loop -------------------------------------------------------------

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (!paused) {
    game.update(dt);
    updateTrainAudio();
    if (game.state.phase === 'playing' && game.state.player.row > 0) ui.setHint(false);
  }
  renderer.render(game.state, paused ? 0 : dt);
  requestAnimationFrame(frame);
}

ui.refresh(save);
ui.showTitle();
requestAnimationFrame(frame);

// Expose a tiny handle for debugging / automated screenshots.
window.__crossy = { game, renderer, save, ui, CHARACTERS, startRun, jumpTo };

/** Debug helper: drop the player straight onto a distant row. */
function jumpTo(row, seed) {
  if (seed !== undefined) game.reset(seed >>> 0);
  game.start();
  // Land on the nearest safe row so the drop-in does not count as a death.
  game.state.terrain.ensure(row - 4, row + 24);
  while (game.state.terrain.get(row).type !== 'forest') row += 1;
  const p = game.state.player;
  p.row = row; p.rowFloat = row; p.tile = 0; p.x = 0; p.z = -row * 42;
  game.state.camera.row = row + 2.2;
  game.state.maxRow = row;
  game.state.score = row;
  game.state.terrain.ensure(row - 10, row + 24);
  ui.setScore(row);
  ui.hideAll();
  ui.setHint(false);
}

// ?start=1 begins a run immediately, ?row= & ?seed= jump the camera somewhere
// interesting -- used by the screenshot harness, harmless otherwise.
const params = new URLSearchParams(location.search);
if (params.has('start') || params.has('row')) {
  const seed = params.has('seed') ? Number(params.get('seed')) : undefined;
  jumpTo(Number(params.get('row') ?? 0), seed);
}
if (params.has('char')) { save.selected = params.get('char'); renderer.setCharacter(save.selected); }
